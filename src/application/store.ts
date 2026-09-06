import type { StudySnapshot } from "../domain/types";
import {
  createRevisionChannel,
  RecoveryReplacementRequiredError,
  RecoveryWriteConflictError,
  recoveryKeyForSnapshot,
  RevisionConflictError,
  StudyRepository,
  type RevisionChannel
} from "../adapters/indexeddb";
import {
  createTrustedModuleValidationContext,
  validateSnapshot,
  validateTrustedProgressSnapshot,
  type TrustedModuleValidationContext,
  type ValidationResult
} from "../domain/validation";

export type StudyStoreMode = "persistent" | "volatile" | "stale";

export interface StudyStoreState {
  snapshot: StudySnapshot | null;
  recoveryKey: string | null;
  mode: StudyStoreMode;
  warning: string | null;
  lastPersistedRevision: number | null;
  lastPersistedWriteToken: number | null;
}

export type StudyMutation = (snapshot: StudySnapshot) => StudySnapshot;
export type StudyStoreSubscriber = (state: Readonly<StudyStoreState>) => void;
export type StudySnapshotValidator = (value: unknown) => ValidationResult;

export class StaleStudyStateError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number | null;

  constructor(expectedRevision: number, actualRevision: number | null) {
    super("Otra pestaña modificó esta recuperación. Recargala o exportá esta copia antes de continuar.");
    this.name = "StaleStudyStateError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function cloneSnapshot(snapshot: StudySnapshot): StudySnapshot {
  if (typeof structuredClone === "function") return structuredClone(snapshot);
  return JSON.parse(JSON.stringify(snapshot)) as StudySnapshot;
}

const deeplyFrozen = new WeakSet<object>();

function freezeSnapshot(snapshot: StudySnapshot): StudySnapshot {
  const visiting = new WeakSet<object>();
  const freezeGraph = (value: unknown): void => {
    if (!value || typeof value !== "object" || deeplyFrozen.has(value) || visiting.has(value)) return;
    visiting.add(value);
    for (const key of Reflect.ownKeys(value)) freezeGraph(Reflect.get(value, key));
    Object.freeze(value);
    deeplyFrozen.add(value);
    visiting.delete(value);
  };
  freezeGraph(snapshot);
  return snapshot;
}

function assertValidCandidate(candidate: StudySnapshot, validator: StudySnapshotValidator): void {
  const validation = validator(candidate);
  if (!validation.ok) {
    const detail = validation.errors
      .slice(0, 3)
      .map((error) => `${error.path}: ${error.message}`)
      .join("; ");
    throw new TypeError(`La mutación produjo un estado inválido. ${detail}`);
  }
}

function assertCandidate(previous: StudySnapshot, candidate: StudySnapshot): void {
  if (candidate.module !== previous.module || candidate.questions !== previous.questions) {
    throw new TypeError("Una mutación no puede cambiar los metadatos ni las preguntas del módulo.");
  }
  if (candidate.progress.stateRevision !== previous.progress.stateRevision + 1) {
    throw new RangeError("Cada mutación debe incrementar stateRevision exactamente una vez.");
  }
  if (
    !Number.isSafeInteger(candidate.progress.stateRevision) ||
    candidate.progress.stateRevision > Number.MAX_SAFE_INTEGER - 1
  ) {
    throw new RangeError("stateRevision excede el rango de enteros seguros.");
  }
}

function persistenceWarning(error: unknown): string {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
  return `No se pudo guardar localmente.${detail} Los cambios siguen en esta pestaña; reintentá, exportá o descartalos.`;
}

/**
 * Single application state owner. Same-tab intents are FIFO and bind their
 * expected revision only when dequeued. Failed persistence preserves the
 * accepted mutation in explicit volatile mode.
 */
export class StudyStore {
  readonly repository: StudyRepository;

  private currentState!: StudyStoreState;
  private readonly subscribers = new Set<StudyStoreSubscriber>();
  private readonly revisionChannel: RevisionChannel;
  private readonly validator: StudySnapshotValidator;
  private readonly trustedValidationContexts = new WeakMap<object, TrustedModuleValidationContext>();
  private failedInstallFallback: StudyStoreState | null = null;
  private failedInstallExpectedWriteToken: number | null | undefined;
  private queue: Promise<void> = Promise.resolve();

  private get state(): StudyStoreState {
    return this.currentState;
  }

  private set state(value: StudyStoreState) {
    this.currentState = Object.freeze(value);
  }

  constructor(
    repository: StudyRepository,
    revisionChannel?: RevisionChannel,
    validator: StudySnapshotValidator = validateSnapshot
  ) {
    this.repository = repository;
    this.validator = validator;
    this.state = {
      snapshot: null,
      recoveryKey: null,
      mode: repository.isPersistent ? "persistent" : "volatile",
      warning: repository.warning,
      lastPersistedRevision: null,
      lastPersistedWriteToken: null
    };
    this.revisionChannel = revisionChannel ?? createRevisionChannel((message) => {
      const snapshot = this.state.snapshot;
      const comparisonRevision = this.state.mode === "volatile" && this.state.lastPersistedRevision !== null
        ? this.state.lastPersistedRevision
        : snapshot?.progress.stateRevision;
      const comparisonWriteToken = this.state.lastPersistedWriteToken;
      if (
        !snapshot ||
        this.state.recoveryKey !== message.recoveryKey ||
        comparisonRevision === undefined ||
        (comparisonWriteToken !== null
          ? message.writeToken <= comparisonWriteToken
          : message.stateRevision <= comparisonRevision)
      ) return;
      this.state = {
        ...this.state,
        mode: "stale",
        warning: "Otra pestaña guardó cambios en este módulo. Esta copia quedó en modo de solo lectura."
      };
      this.notify();
    });
  }

  getState(): Readonly<StudyStoreState> {
    return this.state;
  }

  subscribe(subscriber: StudyStoreSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.state);
    return () => this.subscribers.delete(subscriber);
  }

  private notify(): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(this.state);
      } catch (error) {
        console.error("Falló un suscriptor de StudyStore.", error);
      }
    }
  }

  private publishRevision(recoveryKey: string, stateRevision: number, writeToken: number | null): void {
    if (writeToken === null) return;
    try {
      this.revisionChannel.publish({ recoveryKey, stateRevision, writeToken });
    } catch (error) {
      // Local persistence already committed. CAS still protects the next write
      // when cross-tab notification is unavailable or unexpectedly fails.
      console.warn("No se pudo anunciar la revisión a otras pestañas.", error);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private trustedContextFor(snapshot: StudySnapshot): TrustedModuleValidationContext {
    const cached = this.trustedValidationContexts.get(snapshot.questions);
    if (cached?.module === snapshot.module) return cached;
    const context = createTrustedModuleValidationContext(snapshot);
    this.trustedValidationContexts.set(snapshot.questions, context);
    return context;
  }

  async load(recoveryKey: string): Promise<StudySnapshot> {
    return this.enqueue(async () => {
      const snapshot = freezeSnapshot(await this.repository.load(recoveryKey));
      assertValidCandidate(snapshot, this.validator);
      if (this.validator === validateSnapshot) this.trustedContextFor(snapshot);
      this.failedInstallFallback = null;
      this.failedInstallExpectedWriteToken = undefined;
      const persistent = this.repository.isPersistent;
      this.state = {
        snapshot,
        recoveryKey,
        mode: persistent ? "persistent" : "volatile",
        warning: persistent ? null : this.repository.warning,
        lastPersistedRevision: persistent ? snapshot.progress.stateRevision : null,
        lastPersistedWriteToken: persistent ? this.repository.getKnownWriteToken(recoveryKey) : null
      };
      this.notify();
      return snapshot;
    });
  }

  async install(snapshot: StudySnapshot, expectedWriteToken?: number | null): Promise<string> {
    return this.enqueue(async () => {
      const installed = freezeSnapshot(cloneSnapshot(snapshot));
      assertValidCandidate(installed, this.validator);
      if (this.validator === validateSnapshot) this.trustedContextFor(installed);
      const fallback = this.state;
      let key: string;
      try {
        key = await this.repository.install(installed, expectedWriteToken);
      } catch (error) {
        if (
          error instanceof RevisionConflictError ||
          error instanceof RecoveryReplacementRequiredError ||
          error instanceof RecoveryWriteConflictError
        ) throw error;
        key = recoveryKeyForSnapshot(installed);
        this.failedInstallFallback = fallback;
        this.failedInstallExpectedWriteToken = expectedWriteToken;
        this.state = {
          snapshot: installed,
          recoveryKey: key,
          mode: "volatile",
          warning: persistenceWarning(error),
          lastPersistedRevision: null,
          lastPersistedWriteToken: expectedWriteToken ?? null
        };
        this.notify();
        return key;
      }
      this.failedInstallFallback = null;
      this.failedInstallExpectedWriteToken = undefined;
      const persistent = this.repository.isPersistent;
      this.state = {
        snapshot: installed,
        recoveryKey: key,
        mode: persistent ? "persistent" : "volatile",
        warning: persistent ? null : this.repository.warning,
        lastPersistedRevision: persistent ? installed.progress.stateRevision : null,
        lastPersistedWriteToken: persistent ? this.repository.getKnownWriteToken(key) : null
      };
      this.notify();
      if (persistent) this.publishRevision(key, installed.progress.stateRevision, this.state.lastPersistedWriteToken);
      return key;
    });
  }

  async commitMutation(mutation: StudyMutation): Promise<StudySnapshot> {
    return this.enqueue(async () => {
      const current = this.state.snapshot;
      const recoveryKey = this.state.recoveryKey;
      if (!current || !recoveryKey) throw new Error("No hay un módulo cargado.");
      if (this.state.mode === "stale") {
        throw new StaleStudyStateError(current.progress.stateRevision, null);
      }

      // This revision is deliberately read at dequeue, not at UI-event time.
      const expectedRevision = current.progress.stateRevision;
      const candidate = mutation(current);
      if (candidate.progress.stateRevision === expectedRevision) return current;
      assertCandidate(current, candidate);
      if (this.validator === validateSnapshot) {
        const context = this.trustedContextFor(current);
        assertValidCandidate(candidate, (value) => validateTrustedProgressSnapshot(value, context));
      } else {
        assertValidCandidate(candidate, this.validator);
      }
      freezeSnapshot(candidate);

      if (this.state.mode === "volatile") {
        this.state = { ...this.state, snapshot: candidate };
        this.notify();
        return candidate;
      }

      try {
        const nextWriteToken = await this.repository.saveSnapshot(
          candidate,
          expectedRevision,
          this.state.lastPersistedWriteToken
        );
        this.state = {
          snapshot: candidate,
          recoveryKey,
          mode: "persistent",
          warning: null,
          lastPersistedRevision: candidate.progress.stateRevision,
          lastPersistedWriteToken: nextWriteToken
        };
        this.notify();
        this.publishRevision(recoveryKey, candidate.progress.stateRevision, this.state.lastPersistedWriteToken);
        return candidate;
      } catch (error) {
        if (error instanceof RevisionConflictError || error instanceof RecoveryWriteConflictError) {
          this.state = {
            ...this.state,
            mode: "stale",
            warning: "Otra pestaña guardó cambios en este módulo. Esta copia quedó en modo de solo lectura."
          };
          this.notify();
          throw error instanceof RevisionConflictError
            ? new StaleStudyStateError(error.expectedRevision, error.actualRevision)
            : new StaleStudyStateError(expectedRevision, null);
        }

        this.state = {
          snapshot: candidate,
          recoveryKey,
          mode: "volatile",
          warning: persistenceWarning(error),
          lastPersistedRevision: expectedRevision,
          lastPersistedWriteToken: this.state.lastPersistedWriteToken
        };
        this.notify();
        return candidate;
      }
    });
  }

  async retryPersistence(): Promise<StudySnapshot> {
    return this.enqueue(async () => {
      const current = this.state.snapshot;
      const key = this.state.recoveryKey;
      const baseRevision = this.state.lastPersistedRevision;
      const baseWriteToken = this.state.lastPersistedWriteToken;
      if (!current || !key) throw new Error("No hay un módulo cargado.");
      if (this.state.mode !== "volatile" || !this.repository.isPersistent) {
        throw new Error("No hay un guardado local pendiente que pueda reintentarse.");
      }

      if (baseRevision === null) {
        try {
          await this.repository.install(current, this.failedInstallExpectedWriteToken ?? null);
        } catch (error) {
          if (
            error instanceof RevisionConflictError ||
            error instanceof RecoveryReplacementRequiredError ||
            error instanceof RecoveryWriteConflictError
          ) {
            const actualRevision = error instanceof RevisionConflictError
              ? error.actualRevision
              : error instanceof RecoveryReplacementRequiredError
                ? error.actualWriteToken
                : error.actualWriteToken;
            this.state = {
              ...this.state,
              mode: "stale",
              warning: "Apareció una recuperación para este módulo. Exportá esta copia o descartala antes de elegir."
            };
            this.notify();
            throw new StaleStudyStateError(current.progress.stateRevision, actualRevision);
          }
          this.state = { ...this.state, warning: persistenceWarning(error) };
          this.notify();
          throw error;
        }
        this.failedInstallFallback = null;
        this.failedInstallExpectedWriteToken = undefined;
        this.state = {
          snapshot: current,
          recoveryKey: key,
          mode: "persistent",
          warning: null,
          lastPersistedRevision: current.progress.stateRevision,
          lastPersistedWriteToken: this.repository.getKnownWriteToken(key)
        };
        this.notify();
        this.publishRevision(key, current.progress.stateRevision, this.state.lastPersistedWriteToken);
        return current;
      }

      const persisted = await this.repository.load(key);
      const persistedWriteToken = this.repository.getKnownWriteToken(key);
      if (
        persisted.progress.stateRevision !== baseRevision ||
        persistedWriteToken !== baseWriteToken
      ) {
        this.state = {
          ...this.state,
          mode: "stale",
          warning: "La base guardada cambió. Solo podés exportar esta copia o descartarla y recargar."
        };
        this.notify();
        throw new StaleStudyStateError(baseRevision, persisted.progress.stateRevision);
      }

      try {
        const nextWriteToken = await this.repository.saveSnapshot(
          current,
          baseRevision,
          baseWriteToken
        );
        this.state = {
          snapshot: current,
          recoveryKey: key,
          mode: "persistent",
          warning: null,
          lastPersistedRevision: current.progress.stateRevision,
          lastPersistedWriteToken: nextWriteToken
        };
      } catch (error) {
        if (error instanceof RevisionConflictError || error instanceof RecoveryWriteConflictError) {
          this.state = {
            ...this.state,
            mode: "stale",
            warning: "La base guardada cambió. Solo podés exportar esta copia o descartarla y recargar."
          };
          this.notify();
          throw error instanceof RevisionConflictError
            ? new StaleStudyStateError(error.expectedRevision, error.actualRevision)
            : new StaleStudyStateError(baseRevision, null);
        }
        this.state = { ...this.state, warning: persistenceWarning(error) };
        this.notify();
        throw error;
      }
      this.notify();
      this.publishRevision(key, current.progress.stateRevision, this.state.lastPersistedWriteToken);
      return current;
    });
  }

  async discardAndReload(): Promise<StudySnapshot | null> {
    const key = this.state.recoveryKey;
    if (!key) throw new Error("No hay una recuperación para recargar.");
    if (this.state.mode === "volatile" && this.state.lastPersistedRevision === null) {
      const fallback = this.failedInstallFallback ?? {
        snapshot: null,
        recoveryKey: null,
        mode: this.repository.isPersistent ? "persistent" as const : "volatile" as const,
        warning: this.repository.warning,
        lastPersistedRevision: null,
        lastPersistedWriteToken: null
      };
      this.failedInstallFallback = null;
      this.failedInstallExpectedWriteToken = undefined;
      this.state = fallback;
      this.notify();
      return fallback.snapshot;
    }
    return this.load(key);
  }

  close(): void {
    this.revisionChannel.close();
    this.repository.close();
    this.subscribers.clear();
  }
}

export async function createStudyStore(repository?: StudyRepository): Promise<StudyStore> {
  return new StudyStore(repository ?? await StudyRepository.open());
}

import type {
  ActiveRun,
  CompletedRun,
  ModuleMetadata,
  PriorRunSummary,
  QuestionProgress,
  StudySnapshot
} from "../domain/types";

export const DATABASE_NAME = "estudio-interactivo-v1";
export const DATABASE_VERSION = 1;

const STORE_NAMES = [
  "modules",
  "stateMeta",
  "activeRuns",
  "questionProgress",
  "completedRuns",
  "priorSummaries",
  "exportReceipts"
] as const;

type StoreName = (typeof STORE_NAMES)[number];

interface ModuleRecord {
  key: string;
  module: ModuleMetadata;
  questions: StudySnapshot["questions"];
}

interface StateMetaRecord {
  key: string;
  moduleId: string;
  contentRevision: number;
  title: string;
  subject: string;
  questionCount: number;
  stateRevision: number;
  updatedAt: string;
  hasActiveRun: boolean;
  writeToken: number;
}

interface ActiveRunRecord {
  key: string;
  run: ActiveRun;
}

interface QuestionProgressRecord {
  recoveryKey: string;
  questionId: string;
  progress: QuestionProgress;
}

interface CompletedRunRecord {
  recoveryKey: string;
  completedStateRevision: number;
  run: CompletedRun;
}

interface PriorSummaryRecord {
  key: string;
  summary: PriorRunSummary;
}

export type ExportReceiptStatus = "attempted" | "confirmed";

export interface ExportReceiptInput {
  recoveryKey?: string;
  snapshotHash: string;
  stateRevision: number;
  status: ExportReceiptStatus;
  at?: string;
  fileName?: string;
}

export interface ExportReceipt {
  key: string;
  recoveryKey: string | null;
  snapshotHash: string;
  stateRevision: number;
  status: ExportReceiptStatus;
  at: string;
  fileName: string | null;
}

export interface RecoverySummary {
  key: string;
  moduleId: string;
  contentRevision: number;
  title: string;
  subject: string;
  questionCount: number;
  stateRevision: number;
  updatedAt: string;
  hasActiveRun: boolean;
  corrupt: boolean;
  writeToken: number;
}

export interface RepositoryOpenOptions {
  indexedDB?: IDBFactory | null;
  databaseName?: string;
}

export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number | null;

  constructor(expectedRevision: number, actualRevision: number | null) {
    super(
      actualRevision === null
        ? `No existe una recuperación para la revisión esperada ${expectedRevision}.`
        : `La revisión guardada es ${actualRevision}; se esperaba ${expectedRevision}.`
    );
    this.name = "RevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class RecoveryNotFoundError extends Error {
  readonly recoveryKey: string;

  constructor(recoveryKey: string) {
    super(`No existe la recuperación ${recoveryKey}.`);
    this.name = "RecoveryNotFoundError";
    this.recoveryKey = recoveryKey;
  }
}

export class RecoveryReplacementRequiredError extends Error {
  readonly recoveryKey: string;
  readonly actualWriteToken: number;

  constructor(recoveryKey: string, actualWriteToken: number) {
    super(`La recuperación ${recoveryKey} ya existe; el reemplazo requiere su token local de escritura.`);
    this.name = "RecoveryReplacementRequiredError";
    this.recoveryKey = recoveryKey;
    this.actualWriteToken = actualWriteToken;
  }
}

export class RecoveryWriteConflictError extends Error {
  readonly expectedWriteToken: number | null;
  readonly actualWriteToken: number | null;

  constructor(expectedWriteToken: number | null, actualWriteToken: number | null) {
    super(`El token local guardado es ${actualWriteToken ?? "ninguno"}; se esperaba ${expectedWriteToken ?? "ninguno"}.`);
    this.name = "RecoveryWriteConflictError";
    this.expectedWriteToken = expectedWriteToken;
    this.actualWriteToken = actualWriteToken;
  }
}

export function recoveryKeyForSnapshot(snapshot: StudySnapshot): string {
  return `${snapshot.module.id}@${snapshot.module.contentRevision}`;
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falló una operación de IndexedDB."));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("La transacción de IndexedDB fue cancelada."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Falló una transacción de IndexedDB."));
  });
}

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(databaseName, DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) throw new Error("IndexedDB no entregó una transacción de actualización.");

      if (!database.objectStoreNames.contains("modules")) {
        database.createObjectStore("modules", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("stateMeta")) {
        database.createObjectStore("stateMeta", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("activeRuns")) {
        database.createObjectStore("activeRuns", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("questionProgress")) {
        const store = database.createObjectStore("questionProgress", {
          keyPath: ["recoveryKey", "questionId"]
        });
        store.createIndex("byRecovery", "recoveryKey", { unique: false });
      }
      if (!database.objectStoreNames.contains("completedRuns")) {
        const store = database.createObjectStore("completedRuns", {
          keyPath: ["recoveryKey", "completedStateRevision"]
        });
        store.createIndex("byRecovery", "recoveryKey", { unique: false });
      }
      if (!database.objectStoreNames.contains("priorSummaries")) {
        database.createObjectStore("priorSummaries", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("exportReceipts")) {
        const store = database.createObjectStore("exportReceipts", { keyPath: "key" });
        store.createIndex("byRecovery", "recoveryKey", { unique: false });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      if (blockedTimer !== null) clearTimeout(blockedTimer);
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => {
      if (blockedTimer !== null) clearTimeout(blockedTimer);
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
    };
    request.onblocked = () => {
      if (blockedTimer !== null || settled) return;
      blockedTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("La apertura de IndexedDB sigue bloqueada por otra pestaña."));
      }, 1500);
    };
  });
}

function assertInstallExpectation(
  recoveryKey: string,
  actualWriteToken: number | null,
  expectedWriteToken: number | null | undefined
): void {
  if (actualWriteToken === null) {
    if (typeof expectedWriteToken === "number") {
      throw new RecoveryWriteConflictError(expectedWriteToken, null);
    }
    return;
  }
  if (expectedWriteToken === undefined) {
    throw new RecoveryReplacementRequiredError(recoveryKey, actualWriteToken);
  }
  if (actualWriteToken !== expectedWriteToken) {
    throw new RecoveryWriteConflictError(expectedWriteToken, actualWriteToken);
  }
}

function deleteRecordsForRecovery(store: IDBObjectStore, recoveryKey: string): void {
  const index = store.index("byRecovery");
  const request = index.openKeyCursor(recoveryKey);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    store.delete(cursor.primaryKey);
    cursor.continue();
  };
}

function metaFromSnapshot(key: string, snapshot: StudySnapshot, writeToken: number): StateMetaRecord {
  return {
    key,
    moduleId: snapshot.module.id,
    contentRevision: snapshot.module.contentRevision,
    title: snapshot.module.title,
    subject: snapshot.module.subject,
    questionCount: snapshot.questions.length,
    stateRevision: snapshot.progress.stateRevision,
    updatedAt: snapshot.progress.updatedAt,
    hasActiveRun: snapshot.progress.activeRun !== null,
    writeToken
  };
}

function summaryFromMeta(meta: StateMetaRecord, completeKeys: Set<string>): RecoverySummary {
  return {
    key: meta.key,
    moduleId: meta.moduleId,
    contentRevision: meta.contentRevision,
    title: meta.title,
    subject: meta.subject,
    questionCount: meta.questionCount,
    stateRevision: meta.stateRevision,
    updatedAt: meta.updatedAt,
    hasActiveRun: meta.hasActiveRun,
    corrupt: !completeKeys.has(meta.key),
    writeToken: meta.writeToken ?? 0
  };
}

function compareRecoveries(left: RecoverySummary, right: RecoverySummary): number {
  if (left.corrupt !== right.corrupt) return left.corrupt ? 1 : -1;
  if (left.stateRevision !== right.stateRevision) return right.stateRevision - left.stateRevision;
  if (left.title !== right.title) return left.title < right.title ? -1 : 1;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

/**
 * Partitioned local recovery repository. `open()` deliberately degrades to an
 * in-memory implementation when IndexedDB is missing or cannot be opened.
 */
export class StudyRepository {
  readonly isPersistent: boolean;
  readonly warning: string | null;

  private readonly database: IDBDatabase | null;
  private readonly memorySnapshots = new Map<string, StudySnapshot>();
  private readonly memoryReceipts = new Map<string, ExportReceipt>();
  private readonly memoryWriteTokens = new Map<string, number>();
  private readonly knownWriteTokens = new Map<string, number>();

  private constructor(database: IDBDatabase | null, warning: string | null) {
    this.database = database;
    this.isPersistent = database !== null;
    this.warning = warning;
  }

  static async open(options: RepositoryOpenOptions = {}): Promise<StudyRepository> {
    const hasFactoryOverride = Object.prototype.hasOwnProperty.call(options, "indexedDB");
    const factory = hasFactoryOverride
      ? (options.indexedDB ?? null)
      : (typeof globalThis.indexedDB === "undefined" ? null : globalThis.indexedDB);
    const databaseName = options.databaseName ?? DATABASE_NAME;

    if (!factory) {
      return new StudyRepository(
        null,
        "El almacenamiento local no está disponible. Los cambios viven solo en esta pestaña; exportá el módulo antes de cerrarla."
      );
    }

    try {
      return new StudyRepository(await openDatabase(factory, databaseName), null);
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
      return new StudyRepository(
        null,
        `No se pudo abrir el almacenamiento local${detail}. Los cambios viven solo en esta pestaña; exportá el módulo antes de cerrarla.`
      );
    }
  }

  close(): void {
    this.database?.close();
  }

  async listRecoveries(): Promise<RecoverySummary[]> {
    if (!this.database) {
      return [...this.memorySnapshots.entries()]
        .map(([key, snapshot]) => ({
          ...summaryFromMeta(metaFromSnapshot(key, snapshot, this.memoryWriteTokens.get(key) ?? 0), new Set([key])),
          corrupt: false
        }))
        .sort(compareRecoveries);
    }

    const transaction = this.database.transaction(["stateMeta", "modules", "priorSummaries"], "readonly");
    const done = transactionResult(transaction);
    const metaRequest = requestResult<StateMetaRecord[]>(transaction.objectStore("stateMeta").getAll());
    const moduleRequest = requestResult<IDBValidKey[]>(transaction.objectStore("modules").getAllKeys());
    const summaryRequest = requestResult<PriorSummaryRecord[]>(transaction.objectStore("priorSummaries").getAll());
    const [metaRecords, moduleKeysRaw, summaryRecords] = await Promise.all([metaRequest, moduleRequest, summaryRequest]);
    await done;
    const moduleKeys = new Set(moduleKeysRaw.filter((key): key is string => typeof key === "string"));
    const summaryKeys = new Set(summaryRecords.map((record) => record.key));
    const completeKeys = new Set([...moduleKeys].filter((key) => summaryKeys.has(key)));
    return metaRecords.map((meta) => summaryFromMeta(meta, completeKeys)).sort(compareRecoveries);
  }

  async load(key: string): Promise<StudySnapshot> {
    if (!this.database) {
      const snapshot = this.memorySnapshots.get(key);
      if (!snapshot) throw new RecoveryNotFoundError(key);
      this.knownWriteTokens.set(key, this.memoryWriteTokens.get(key) ?? 0);
      return cloneValue(snapshot);
    }

    const transaction = this.database.transaction(
      ["modules", "stateMeta", "activeRuns", "questionProgress", "completedRuns", "priorSummaries"],
      "readonly"
    );
    const done = transactionResult(transaction);
    const modulePromise = requestResult<ModuleRecord | undefined>(transaction.objectStore("modules").get(key));
    const metaPromise = requestResult<StateMetaRecord | undefined>(transaction.objectStore("stateMeta").get(key));
    const activePromise = requestResult<ActiveRunRecord | undefined>(transaction.objectStore("activeRuns").get(key));
    const questionPromise = requestResult<QuestionProgressRecord[]>(
      transaction.objectStore("questionProgress").index("byRecovery").getAll(key)
    );
    const runsPromise = requestResult<CompletedRunRecord[]>(
      transaction.objectStore("completedRuns").index("byRecovery").getAll(key)
    );
    const priorPromise = requestResult<PriorSummaryRecord | undefined>(transaction.objectStore("priorSummaries").get(key));

    const [moduleRecord, meta, active, questionRecords, runRecords, prior] = await Promise.all([
      modulePromise,
      metaPromise,
      activePromise,
      questionPromise,
      runsPromise,
      priorPromise
    ]);
    await done;

    if (!moduleRecord || !meta || !prior) throw new RecoveryNotFoundError(key);
    const questions = Object.create(null) as Record<string, QuestionProgress>;
    for (const record of questionRecords) questions[record.questionId] = record.progress;
    const runs = runRecords
      .map((record) => record.run)
      .sort((left, right) => left.completedStateRevision - right.completedStateRevision);

    this.knownWriteTokens.set(key, meta.writeToken ?? 0);
    return {
      schemaVersion: 1,
      module: moduleRecord.module,
      questions: moduleRecord.questions,
      progress: {
        updatedAt: meta.updatedAt,
        stateRevision: meta.stateRevision,
        questions,
        runs,
        priorRunSummary: prior.summary,
        activeRun: active?.run ?? null
      }
    };
  }

  async getWriteToken(key: string): Promise<number | null> {
    if (!this.database) {
      const token = this.memorySnapshots.has(key) ? (this.memoryWriteTokens.get(key) ?? 0) : null;
      if (token === null) this.knownWriteTokens.delete(key);
      else this.knownWriteTokens.set(key, token);
      return token;
    }
    const transaction = this.database.transaction("stateMeta", "readonly");
    const done = transactionResult(transaction);
    const meta = await requestResult<StateMetaRecord | undefined>(transaction.objectStore("stateMeta").get(key));
    await done;
    const token = meta ? (meta.writeToken ?? 0) : null;
    if (token === null) this.knownWriteTokens.delete(key);
    else this.knownWriteTokens.set(key, token);
    return token;
  }

  getKnownWriteToken(key: string): number | null {
    return this.knownWriteTokens.get(key) ?? null;
  }

  async install(snapshot: StudySnapshot, expectedWriteToken?: number | null): Promise<string> {
    const key = recoveryKeyForSnapshot(snapshot);
    const installed = cloneValue(snapshot);
    if (!this.database) {
      const actualWriteToken = this.memorySnapshots.has(key) ? (this.memoryWriteTokens.get(key) ?? 0) : null;
      assertInstallExpectation(key, actualWriteToken, expectedWriteToken);
      this.memorySnapshots.set(key, installed);
      const nextWriteToken = (actualWriteToken ?? 0) + 1;
      this.memoryWriteTokens.set(key, nextWriteToken);
      this.knownWriteTokens.set(key, nextWriteToken);
      return key;
    }

    const transaction = this.database.transaction(
      ["modules", "stateMeta", "activeRuns", "questionProgress", "completedRuns", "priorSummaries"],
      "readwrite"
    );
    const done = transactionResult(transaction);
    const modules = transaction.objectStore("modules");
    const meta = transaction.objectStore("stateMeta");
    const active = transaction.objectStore("activeRuns");
    const progress = transaction.objectStore("questionProgress");
    const runs = transaction.objectStore("completedRuns");
    const summaries = transaction.objectStore("priorSummaries");

    // Capture old primary keys before enqueueing any replacement writes. A
    // cursor that continued after `put` could otherwise delete the new record.
    const [existingMeta, oldProgressKeys, oldRunKeys] = await Promise.all([
      requestResult<StateMetaRecord | undefined>(meta.get(key)),
      requestResult<IDBValidKey[]>(progress.index("byRecovery").getAllKeys(key)),
      requestResult<IDBValidKey[]>(runs.index("byRecovery").getAllKeys(key))
    ]);
    try {
      const actualWriteToken = existingMeta ? (existingMeta.writeToken ?? 0) : null;
      assertInstallExpectation(key, actualWriteToken, expectedWriteToken);
    } catch (error) {
      transaction.abort();
      try {
        await done;
      } catch {
        // The explicit replacement/CAS error below is more useful.
      }
      throw error;
    }
    for (const oldKey of oldProgressKeys) progress.delete(oldKey);
    for (const oldKey of oldRunKeys) runs.delete(oldKey);
    modules.put({ key, module: installed.module, questions: installed.questions } satisfies ModuleRecord);
    const nextWriteToken = (existingMeta?.writeToken ?? 0) + 1;
    meta.put(metaFromSnapshot(key, installed, nextWriteToken));
    if (installed.progress.activeRun) {
      active.put({ key, run: installed.progress.activeRun } satisfies ActiveRunRecord);
    } else {
      active.delete(key);
    }
    for (const [questionId, questionProgress] of Object.entries(installed.progress.questions)) {
      progress.put({ recoveryKey: key, questionId, progress: questionProgress } satisfies QuestionProgressRecord);
    }
    for (const run of installed.progress.runs) {
      runs.put({ recoveryKey: key, completedStateRevision: run.completedStateRevision, run } satisfies CompletedRunRecord);
    }
    summaries.put({ key, summary: installed.progress.priorRunSummary } satisfies PriorSummaryRecord);
    await done;
    this.knownWriteTokens.set(key, nextWriteToken);
    return key;
  }

  async saveSnapshot(snapshot: StudySnapshot, expectedRevision: number): Promise<void> {
    const key = recoveryKeyForSnapshot(snapshot);
    // IndexedDB clones every value it stores. Avoid cloning a multi-megabyte
    // immutable bank on every answer; memory fallback still needs detachment.
    const candidate = this.database ? snapshot : cloneValue(snapshot);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new RangeError("La revisión esperada debe ser un entero seguro no negativo.");
    }
    if (
      !Number.isSafeInteger(candidate.progress.stateRevision) ||
      candidate.progress.stateRevision > Number.MAX_SAFE_INTEGER - 1 ||
      candidate.progress.stateRevision <= expectedRevision
    ) {
      throw new RangeError("La nueva revisión debe ser un entero seguro mayor que la revisión esperada.");
    }

    if (!this.database) {
      const current = this.memorySnapshots.get(key);
      const actualRevision = current?.progress.stateRevision ?? null;
      if (actualRevision !== expectedRevision) throw new RevisionConflictError(expectedRevision, actualRevision);
      const actualWriteToken = this.memorySnapshots.has(key) ? (this.memoryWriteTokens.get(key) ?? 0) : null;
      const expectedWriteToken = this.knownWriteTokens.get(key) ?? null;
      if (!this.knownWriteTokens.has(key) || actualWriteToken !== expectedWriteToken) {
        throw new RecoveryWriteConflictError(expectedWriteToken, actualWriteToken);
      }
      this.memorySnapshots.set(key, candidate);
      const nextWriteToken = (actualWriteToken ?? 0) + 1;
      this.memoryWriteTokens.set(key, nextWriteToken);
      this.knownWriteTokens.set(key, nextWriteToken);
      return;
    }

    const transaction = this.database.transaction(
      ["stateMeta", "activeRuns", "questionProgress", "completedRuns", "priorSummaries"],
      "readwrite"
    );
    const done = transactionResult(transaction);
    const metaStore = transaction.objectStore("stateMeta");
    const current = await requestResult<StateMetaRecord | undefined>(metaStore.get(key));
    const actualRevision = current?.stateRevision ?? null;
    if (actualRevision !== expectedRevision) {
      transaction.abort();
      try {
        await done;
      } catch {
        // The explicit conflict below is more useful than AbortError.
      }
      throw new RevisionConflictError(expectedRevision, actualRevision);
    }
    const actualWriteToken = current?.writeToken ?? 0;
    const expectedWriteToken = this.knownWriteTokens.get(key) ?? null;
    if (!this.knownWriteTokens.has(key) || actualWriteToken !== expectedWriteToken) {
      transaction.abort();
      try {
        await done;
      } catch {
        // The explicit local-token conflict below is more useful.
      }
      throw new RecoveryWriteConflictError(expectedWriteToken, actualWriteToken);
    }

    const active = transaction.objectStore("activeRuns");
    const progress = transaction.objectStore("questionProgress");
    const runs = transaction.objectStore("completedRuns");
    const summaries = transaction.objectStore("priorSummaries");
    const nextWriteToken = actualWriteToken + 1;
    metaStore.put(metaFromSnapshot(key, candidate, nextWriteToken));
    if (candidate.progress.activeRun) {
      active.put({ key, run: candidate.progress.activeRun } satisfies ActiveRunRecord);
    } else {
      active.delete(key);
    }

    const isVolatileCatchUp = candidate.progress.stateRevision > expectedRevision + 1;
    const completedRunNow = candidate.progress.runs.find(
      (run) => run.completedStateRevision === candidate.progress.stateRevision
    );
    if (isVolatileCatchUp || completedRunNow) {
      // Answer/navigation/start/abandon touch metadata and the active run only.
      // Submission and volatile catch-up reconcile aggregate partitions.
      const candidateRunRevisions = new Set<number>();
      for (const run of candidate.progress.runs) candidateRunRevisions.add(run.completedStateRevision);
      if (isVolatileCatchUp) {
        for (const [questionId, questionProgress] of Object.entries(candidate.progress.questions)) {
          progress.put({ recoveryKey: key, questionId, progress: questionProgress } satisfies QuestionProgressRecord);
        }
        for (const run of candidate.progress.runs) {
          runs.put({ recoveryKey: key, completedStateRevision: run.completedStateRevision, run } satisfies CompletedRunRecord);
        }
      } else if (completedRunNow) {
        const changedQuestionIds = new Set(completedRunNow.items.map((item) => item.questionId));
        for (const questionId of changedQuestionIds) {
          if (!Object.prototype.hasOwnProperty.call(candidate.progress.questions, questionId)) {
            transaction.abort();
            try {
              await done;
            } catch {
              // The aggregate error below is the actionable failure.
            }
            throw new Error(`Falta el progreso agregado de ${questionId}.`);
          }
          const questionProgress = candidate.progress.questions[questionId] as QuestionProgress;
          progress.put({ recoveryKey: key, questionId, progress: questionProgress } satisfies QuestionProgressRecord);
        }
        runs.put({
          recoveryKey: key,
          completedStateRevision: completedRunNow.completedStateRevision,
          run: completedRunNow
        } satisfies CompletedRunRecord);
      }
      const cursorRequest = runs.index("byRecovery").openCursor(key);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const record = cursor.value as CompletedRunRecord;
        if (!candidateRunRevisions.has(record.completedStateRevision)) cursor.delete();
        cursor.continue();
      };
      summaries.put({ key, summary: candidate.progress.priorRunSummary } satisfies PriorSummaryRecord);
    }
    await done;
    this.knownWriteTokens.set(key, nextWriteToken);
  }

  async remove(key: string): Promise<void> {
    if (!this.database) {
      this.memorySnapshots.delete(key);
      this.memoryWriteTokens.delete(key);
      this.knownWriteTokens.delete(key);
      for (const [receiptKey, receipt] of this.memoryReceipts) {
        if (receipt.recoveryKey === key) this.memoryReceipts.delete(receiptKey);
      }
      return;
    }

    const transaction = this.database.transaction([...STORE_NAMES], "readwrite");
    const done = transactionResult(transaction);
    transaction.objectStore("modules").delete(key);
    transaction.objectStore("stateMeta").delete(key);
    transaction.objectStore("activeRuns").delete(key);
    transaction.objectStore("priorSummaries").delete(key);
    deleteRecordsForRecovery(transaction.objectStore("questionProgress"), key);
    deleteRecordsForRecovery(transaction.objectStore("completedRuns"), key);
    deleteRecordsForRecovery(transaction.objectStore("exportReceipts"), key);
    await done;
    this.knownWriteTokens.delete(key);
  }

  async recordExportReceipt(input: ExportReceiptInput): Promise<ExportReceipt> {
    if (!Number.isSafeInteger(input.stateRevision) || input.stateRevision < 0) {
      throw new RangeError("La revisión del recibo debe ser un entero seguro no negativo.");
    }
    if (!input.snapshotHash) throw new TypeError("El hash del snapshot es obligatorio.");
    if (input.status !== "attempted" && input.status !== "confirmed") {
      throw new TypeError("El estado del recibo debe ser attempted o confirmed.");
    }
    const key = `${input.snapshotHash}:${input.stateRevision}`;
    const receipt: ExportReceipt = {
      key,
      recoveryKey: input.recoveryKey ?? null,
      snapshotHash: input.snapshotHash,
      stateRevision: input.stateRevision,
      status: input.status,
      at: input.at ?? new Date().toISOString(),
      fileName: input.fileName ?? null
    };

    if (!this.database) {
      const prior = this.memoryReceipts.get(key);
      if (prior?.status === "confirmed" && receipt.status === "attempted") return cloneValue(prior);
      this.memoryReceipts.set(key, cloneValue(receipt));
      return receipt;
    }

    const transaction = this.database.transaction("exportReceipts", "readwrite");
    const done = transactionResult(transaction);
    const store = transaction.objectStore("exportReceipts");
    const prior = await requestResult<ExportReceipt | undefined>(store.get(key));
    if (prior?.status === "confirmed" && receipt.status === "attempted") {
      await done;
      return prior;
    }
    store.put(receipt);
    await done;
    return receipt;
  }

  async listExportReceipts(recoveryKey?: string): Promise<ExportReceipt[]> {
    let receipts: ExportReceipt[];
    if (!this.database) {
      receipts = [...this.memoryReceipts.values()]
        .filter((receipt) => recoveryKey === undefined || receipt.recoveryKey === recoveryKey)
        .map(cloneValue);
    } else {
      const transaction = this.database.transaction("exportReceipts", "readonly");
      const done = transactionResult(transaction);
      const store = transaction.objectStore("exportReceipts");
      receipts = recoveryKey === undefined
        ? await requestResult<ExportReceipt[]>(store.getAll())
        : await requestResult<ExportReceipt[]>(store.index("byRecovery").getAll(recoveryKey));
      await done;
    }
    return receipts.sort((left, right) => {
      if (left.stateRevision !== right.stateRevision) return right.stateRevision - left.stateRevision;
      return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
    });
  }
}

export interface RevisionAnnouncement {
  recoveryKey: string;
  stateRevision: number;
  writeToken: number;
}

export interface RevisionChannel {
  readonly supported: boolean;
  publish(message: RevisionAnnouncement): void;
  close(): void;
}

export function createRevisionChannel(
  callback: (message: RevisionAnnouncement) => void,
  channelName = "estudio-interactivo-revisions-v1"
): RevisionChannel {
  if (typeof BroadcastChannel === "undefined") {
    return {
      supported: false,
      publish: () => undefined,
      close: () => undefined
    };
  }

  const channel = new BroadcastChannel(channelName);
  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    const value = event.data;
    if (!value || typeof value !== "object") return;
    const candidate = value as Partial<RevisionAnnouncement>;
    if (
      typeof candidate.recoveryKey !== "string" ||
      !Number.isSafeInteger(candidate.stateRevision) ||
      (candidate.stateRevision ?? -1) < 0 ||
      !Number.isSafeInteger(candidate.writeToken) ||
      (candidate.writeToken ?? -1) < 0
    ) return;
    callback({
      recoveryKey: candidate.recoveryKey,
      stateRevision: candidate.stateRevision as number,
      writeToken: candidate.writeToken as number
    });
  });

  return {
    supported: true,
    publish(message) {
      channel.postMessage(message);
    },
    close() {
      channel.close();
    }
  };
}

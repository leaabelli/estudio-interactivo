import { describe, expect, test } from "bun:test";
import {
  createRevisionChannel,
  RecoveryNotFoundError,
  RecoveryReplacementRequiredError,
  RecoveryWriteConflictError,
  RevisionConflictError,
  StudyRepository,
  recoveryKeyForSnapshot,
  type RevisionChannel
} from "../../src/adapters/indexeddb";
import {
  StaleStudyStateError,
  StudyStore,
  type StudySnapshotValidator
} from "../../src/application/store";
import type { StudySnapshot } from "../../src/domain/types";
import { createActiveRun } from "../../src/domain/runs";
import { requiresSeparateExistingBackup } from "../../src/ui/app";
import { makeSnapshot } from "../unit/fixtures";

function nextRevision(snapshot: StudySnapshot, marker: string): StudySnapshot {
  return {
    ...snapshot,
    progress: {
      ...snapshot.progress,
      stateRevision: snapshot.progress.stateRevision + 1,
      updatedAt: `2026-02-01T00:00:${marker.padStart(2, "0")}.000Z`
    }
  };
}

function silentChannel(): RevisionChannel {
  return { supported: false, publish: () => undefined, close: () => undefined };
}

const acceptingValidator: StudySnapshotValidator = (value) => ({
  ok: true,
  value: value as StudySnapshot
});

describe("StudyRepository memory fallback", () => {
  test("installs, lists, loads, compare-and-swaps, and removes recoveries", async () => {
    const repository = await StudyRepository.open({ indexedDB: null });
    const first = makeSnapshot();
    const second = makeSnapshot();
    second.module.id = "another.module";
    second.module.title = "Otro módulo";
    second.progress.stateRevision = 4;
    second.progress.updatedAt = "2026-02-01T00:00:04.000Z";

    expect(repository.isPersistent).toBe(false);
    expect(repository.warning).toContain("solo en esta pestaña");
    const firstKey = await repository.install(first);
    const secondKey = await repository.install(second);
    expect(firstKey).toBe("test.module@1");
    expect((await repository.listRecoveries()).map(({ key }) => key)).toEqual([secondKey, firstKey]);

    const candidate = nextRevision(await repository.load(firstKey), "01");
    await repository.saveSnapshot(candidate, 0, repository.getKnownWriteToken(firstKey));
    expect((await repository.load(firstKey)).progress.stateRevision).toBe(1);
    candidate.progress.stateRevision = 2;
    await expect(
      repository.saveSnapshot(candidate, 0, repository.getKnownWriteToken(firstKey))
    ).rejects.toBeInstanceOf(RevisionConflictError);

    const detached = await repository.load(firstKey);
    detached.module.title = "Mutación externa";
    expect((await repository.load(firstKey)).module.title).toBe("Módulo de prueba");

    await repository.remove(secondKey);
    expect((await repository.listRecoveries()).map(({ key }) => key)).toEqual([firstKey]);
    repository.close();
  });

  test("keeps export receipts local and never downgrades confirmed to attempted", async () => {
    const repository = await StudyRepository.open({ indexedDB: null });
    const snapshot = makeSnapshot();
    const recoveryKey = await repository.install(snapshot);
    const base = {
      recoveryKey,
      snapshotHash: "a".repeat(64),
      stateRevision: 0,
      at: "2026-02-01T00:00:00.000Z",
      fileName: "test.study.json"
    };
    await repository.recordExportReceipt({ ...base, status: "confirmed" });
    await repository.recordExportReceipt({ ...base, status: "attempted", at: "2026-02-02T00:00:00.000Z" });

    expect(await repository.listExportReceipts(recoveryKey)).toEqual([
      expect.objectContaining({ status: "confirmed", at: "2026-02-01T00:00:00.000Z" })
    ]);
    expect(await repository.load(recoveryKey)).toEqual(snapshot);
    repository.close();
  });

  test("keeps content revisions as distinct recovery keys", async () => {
    const repository = await StudyRepository.open({ indexedDB: null });
    const first = makeSnapshot();
    const second = makeSnapshot();
    second.module.contentRevision = 2;
    expect(recoveryKeyForSnapshot(first)).not.toBe(recoveryKeyForSnapshot(second));
    await repository.install(first);
    await repository.install(second);
    expect(await repository.listRecoveries()).toHaveLength(2);
    repository.close();
  });

  test("rejects missing recovery, invalid CAS revisions, and invalid receipts", async () => {
    const repository = await StudyRepository.open({ indexedDB: null });
    await expect(repository.load("missing@1")).rejects.toBeInstanceOf(RecoveryNotFoundError);
    const snapshot = makeSnapshot();
    const key = await repository.install(snapshot);
    const candidate = await repository.load(key);
    candidate.progress.stateRevision = Number.MAX_SAFE_INTEGER;
    await expect(repository.saveSnapshot(candidate, 0, repository.getKnownWriteToken(key))).rejects.toThrow(RangeError);
    await expect(repository.saveSnapshot(candidate, -1, repository.getKnownWriteToken(key))).rejects.toThrow(RangeError);
    await expect(repository.recordExportReceipt({ snapshotHash: "", stateRevision: 0, status: "attempted" })).rejects.toThrow(
      "obligatorio"
    );
    await expect(
      repository.recordExportReceipt({ snapshotHash: "abc", stateRevision: -1, status: "attempted" })
    ).rejects.toThrow(RangeError);
    await expect(
      repository.recordExportReceipt({ snapshotHash: "abc", stateRevision: 0, status: "invalid" as "attempted" })
    ).rejects.toThrow("attempted o confirmed");
    repository.close();
  });

  test("requires an explicit expected revision before replacing the same recovery key", async () => {
    const repository = await StudyRepository.open({ indexedDB: null });
    const first = makeSnapshot();
    await repository.install(first);
    expect(await repository.getWriteToken(recoveryKeyForSnapshot(first))).toBe(1);
    const replacement = makeSnapshot();
    replacement.module.title = "Contenido divergente";
    await expect(repository.install(replacement)).rejects.toBeInstanceOf(RecoveryReplacementRequiredError);
    await expect(repository.install(replacement, 7)).rejects.toBeInstanceOf(RecoveryWriteConflictError);
    await repository.install(replacement, 1);
    expect(await repository.getWriteToken(recoveryKeyForSnapshot(first))).toBe(2);
    await expect(repository.install(first, 1)).rejects.toBeInstanceOf(RecoveryWriteConflictError);

    // Simulate an equal-stateRevision replacement by another repository/tab.
    const internals = repository as unknown as { memoryWriteTokens: Map<string, number> };
    internals.memoryWriteTokens.set(recoveryKeyForSnapshot(first), 3);
    const next = nextRevision(await repository.load(recoveryKeyForSnapshot(first)), "01");
    internals.memoryWriteTokens.set(recoveryKeyForSnapshot(first), 4);
    await expect(repository.saveSnapshot(next, 0, 3)).rejects.toBeInstanceOf(RecoveryWriteConflictError);
    expect((await repository.load(recoveryKeyForSnapshot(first))).module.title).toBe("Contenido divergente");
    repository.close();
  });
});

class FakePersistentRepository {
  readonly isPersistent = true;
  readonly warning = null;
  snapshot: StudySnapshot;
  saveCalls: Array<{ expected: number; candidate: number }> = [];
  failNext = false;
  writeToken = 0;

  constructor(snapshot: StudySnapshot) {
    this.snapshot = structuredClone(snapshot);
  }

  async listRecoveries() {
    return [];
  }

  async install(snapshot: StudySnapshot) {
    this.snapshot = structuredClone(snapshot);
    this.writeToken += 1;
    return recoveryKeyForSnapshot(snapshot);
  }

  async load(_key: string) {
    return structuredClone(this.snapshot);
  }

  async getWriteToken(_key: string) {
    return this.writeToken;
  }

  getKnownWriteToken(_key: string) {
    return this.writeToken;
  }

  async saveSnapshot(snapshot: StudySnapshot, expectedRevision: number, expectedWriteToken: number | null) {
    this.saveCalls.push({ expected: expectedRevision, candidate: snapshot.progress.stateRevision });
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (this.failNext) {
      this.failNext = false;
      throw new Error("quota");
    }
    if (this.snapshot.progress.stateRevision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, this.snapshot.progress.stateRevision);
    }
    if (this.writeToken !== expectedWriteToken) {
      throw new RecoveryWriteConflictError(expectedWriteToken, this.writeToken);
    }
    this.snapshot = structuredClone(snapshot);
    this.writeToken += 1;
    return this.writeToken;
  }

  async remove(_key: string) {}
  async recordExportReceipt() {}
  close() {}
}

function asRepository(fake: FakePersistentRepository): StudyRepository {
  return fake as unknown as StudyRepository;
}

function makeStore(fake: FakePersistentRepository, channel: RevisionChannel = silentChannel()): StudyStore {
  return new StudyStore(asRepository(fake), channel, acceptingValidator);
}

describe("StudyStore queued persistence", () => {
  test("a cancelled import preview cannot adopt an external same-revision write token", async () => {
    const repository = await StudyRepository.open({ indexedDB: null });
    Object.defineProperty(repository, "isPersistent", { value: true });
    Object.defineProperty(repository, "warning", { value: null });
    const store = new StudyStore(repository, silentChannel(), acceptingValidator);
    const initial = makeSnapshot();
    await store.install(initial);
    const key = recoveryKeyForSnapshot(initial);
    const ownedWriteToken = store.getState().lastPersistedWriteToken;
    expect(ownedWriteToken).toBe(1);

    const replacement = makeSnapshot();
    replacement.module.title = "Reemplazo externo";
    const internals = repository as unknown as {
      memorySnapshots: Map<string, StudySnapshot>;
      memoryWriteTokens: Map<string, number>;
    };
    internals.memorySnapshots.set(key, structuredClone(replacement));
    internals.memoryWriteTokens.set(key, 2);

    // Same reads as the import preview; the user then cancels the dialog.
    expect(await repository.getWriteToken(key)).toBe(2);
    await repository.load(key);
    expect(store.getState().lastPersistedWriteToken).toBe(ownedWriteToken);

    await expect(
      store.commitMutation((snapshot) => nextRevision(snapshot, "01"))
    ).rejects.toBeInstanceOf(StaleStudyStateError);
    expect(store.getState().mode).toBe("stale");
    expect((await repository.load(key)).module.title).toBe("Reemplazo externo");
    store.close();
  });

  test("requires a separate backup when the existing recovery has a different write token", () => {
    expect(requiresSeparateExistingBackup("test.module@1", "test.module@1", 4, 4)).toBe(false);
    expect(requiresSeparateExistingBackup("test.module@1", "test.module@1", 4, 5)).toBe(true);
    expect(requiresSeparateExistingBackup("other.module@1", "test.module@1", 4, 4)).toBe(true);
    expect(requiresSeparateExistingBackup("test.module@1", "test.module@1", null, 4)).toBe(true);
  });

  test("deep-freezes exposed state and validates each candidate before persistence", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const store = new StudyStore(asRepository(fake), silentChannel());
    await store.install(initial);
    const exposed = store.getState().snapshot!;
    expect(Object.isFrozen(exposed)).toBe(true);
    expect(Object.isFrozen(exposed.progress)).toBe(true);
    expect(() => {
      exposed.progress.stateRevision = 99;
    }).toThrow();

    await store.commitMutation((snapshot) => createActiveRun(snapshot, {
      difficulty: "mixta",
      population: "nuevas",
      requestedSize: 10,
      acceptedSize: 10,
      seed: 7
    }, "2026-02-01T00:00:00.000Z"));
    expect(fake.snapshot.progress.stateRevision).toBe(1);

    await expect(store.commitMutation((snapshot) => ({
      ...snapshot,
      progress: {
        ...snapshot.progress,
        stateRevision: 2,
        activeRun: snapshot.progress.activeRun
          ? { ...snapshot.progress.activeRun, currentIndex: 99 }
          : null
      }
    }))).rejects.toThrow("estado inválido");
    expect(fake.snapshot.progress.stateRevision).toBe(1);
    store.close();
  });

  test("binds expected revisions at dequeue for rapid same-tab intents", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const store = makeStore(fake);
    await store.install(initial);

    const first = store.commitMutation((snapshot) => nextRevision(snapshot, "01"));
    const second = store.commitMutation((snapshot) => nextRevision(snapshot, "02"));
    await Promise.all([first, second]);

    expect(fake.saveCalls).toEqual([
      { expected: 0, candidate: 1 },
      { expected: 1, candidate: 2 }
    ]);
    expect(store.getState()).toMatchObject({ mode: "persistent", lastPersistedRevision: 2 });
    store.close();
  });

  test("does not report volatile after a post-commit broadcast failure", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const channel: RevisionChannel = {
      supported: true,
      publish() {
        throw new Error("channel closed");
      },
      close() {}
    };
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const store = makeStore(fake, channel);
      await store.install(initial);
      await store.commitMutation((snapshot) => nextRevision(snapshot, "01"));
      expect(store.getState()).toMatchObject({ mode: "persistent", lastPersistedRevision: 1 });
      expect(fake.snapshot.progress.stateRevision).toBe(1);
      store.close();
    } finally {
      console.warn = originalWarn;
    }
  });

  test("keeps a failed initial installation available in volatile memory", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    let installAttempts = 0;
    fake.install = async (snapshot) => {
      installAttempts += 1;
      if (installAttempts === 1) throw new Error("quota during install");
      fake.snapshot = structuredClone(snapshot);
      fake.writeToken += 1;
      return recoveryKeyForSnapshot(snapshot);
    };
    const store = makeStore(fake);
    const key = await store.install(initial);
    expect(key).toBe(recoveryKeyForSnapshot(initial));
    expect(store.getState()).toMatchObject({ mode: "volatile", lastPersistedRevision: null });
    expect(store.getState().warning).toContain("quota during install");
    await store.commitMutation((snapshot) => nextRevision(snapshot, "01"));
    expect(store.getState().snapshot?.progress.stateRevision).toBe(1);
    await store.retryPersistence();
    expect(store.getState()).toMatchObject({ mode: "persistent", lastPersistedRevision: 1 });
    expect(fake.snapshot.progress.stateRevision).toBe(1);
    store.close();
  });

  test("discards a failed first installation back to the empty state", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    fake.install = async () => {
      throw new Error("quota during install");
    };
    const store = makeStore(fake);
    await store.install(initial);
    expect(await store.discardAndReload()).toBeNull();
    expect(store.getState()).toMatchObject({
      snapshot: null,
      recoveryKey: null,
      mode: "persistent",
      lastPersistedRevision: null
    });
    store.close();
  });

  test("preserves multiple mutations in volatile mode and catches up atomically", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const store = makeStore(fake);
    await store.install(initial);
    fake.failNext = true;

    await store.commitMutation((snapshot) => nextRevision(snapshot, "01"));
    await store.commitMutation((snapshot) => nextRevision(snapshot, "02"));
    expect(store.getState()).toMatchObject({ mode: "volatile", lastPersistedRevision: 0 });
    expect(store.getState().snapshot?.progress.stateRevision).toBe(2);
    expect(fake.snapshot.progress.stateRevision).toBe(0);

    await store.retryPersistence();
    expect(fake.saveCalls.at(-1)).toEqual({ expected: 0, candidate: 2 });
    expect(store.getState()).toMatchObject({ mode: "persistent", lastPersistedRevision: 2 });
    expect(fake.snapshot.progress.stateRevision).toBe(2);
    store.close();
  });

  test("turns a CAS conflict into a stale read-only state without accepting the candidate", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const store = makeStore(fake);
    await store.install(initial);
    fake.snapshot = nextRevision(structuredClone(initial), "01");

    await expect(store.commitMutation((snapshot) => nextRevision(snapshot, "02"))).rejects.toBeInstanceOf(
      StaleStudyStateError
    );
    expect(store.getState().mode).toBe("stale");
    expect(store.getState().snapshot?.progress.stateRevision).toBe(0);
    await expect(store.commitMutation((snapshot) => nextRevision(snapshot, "03"))).rejects.toBeInstanceOf(
      StaleStudyStateError
    );
    store.close();
  });

  test("treats reducer no-ops as no-ops instead of false mutations", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const store = makeStore(fake);
    await store.install(initial);
    const result = await store.commitMutation((snapshot) => snapshot);
    expect(result.progress.stateRevision).toBe(0);
    expect(fake.saveCalls).toEqual([]);
    store.close();
  });

  test("loads recoveries, notifies subscribers, and supports discard/reload", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const store = makeStore(fake);
    const revisions: Array<number | null> = [];
    const unsubscribe = store.subscribe((state) => revisions.push(state.snapshot?.progress.stateRevision ?? null));
    await store.load(recoveryKeyForSnapshot(initial));
    await store.commitMutation((snapshot) => nextRevision(snapshot, "01"));
    await store.discardAndReload();
    unsubscribe();
    await store.commitMutation((snapshot) => nextRevision(snapshot, "02"));
    expect(revisions).toEqual([null, 0, 1, 1]);
    store.close();
  });

  test("rejects mutations without a module and invalid revision or module changes", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const emptyStore = makeStore(fake);
    await expect(emptyStore.commitMutation((snapshot) => snapshot)).rejects.toThrow("No hay un módulo");
    await expect(emptyStore.retryPersistence()).rejects.toThrow("No hay un módulo");
    await expect(emptyStore.discardAndReload()).rejects.toThrow("No hay una recuperación");
    emptyStore.close();

    const store = makeStore(fake);
    await store.install(initial);
    await expect(
      store.commitMutation((snapshot) => {
        const revised = nextRevision(snapshot, "01");
        return { ...revised, module: { ...revised.module, id: "changed.module" } };
      })
    ).rejects.toThrow("metadatos");
    await expect(
      store.commitMutation((snapshot) => {
        return {
          ...snapshot,
          progress: { ...snapshot.progress, stateRevision: snapshot.progress.stateRevision + 2 }
        };
      })
    ).rejects.toThrow("exactamente una vez");
    const boundary = makeSnapshot();
    boundary.progress.stateRevision = Number.MAX_SAFE_INTEGER - 1;
    await store.install(boundary);
    await expect(
      store.commitMutation((snapshot) => {
        return {
          ...snapshot,
          progress: { ...snapshot.progress, stateRevision: Number.MAX_SAFE_INTEGER }
        };
      })
    ).rejects.toThrow("rango");
    await expect(store.retryPersistence()).rejects.toThrow("No hay un guardado local pendiente");
    store.close();
  });

  test("blocks volatile retry when the persisted base changed", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const store = makeStore(fake);
    await store.install(initial);
    fake.failNext = true;
    await store.commitMutation((snapshot) => nextRevision(snapshot, "01"));
    fake.snapshot = nextRevision(structuredClone(initial), "09");
    await expect(store.retryPersistence()).rejects.toBeInstanceOf(StaleStudyStateError);
    expect(store.getState().mode).toBe("stale");
    store.close();
  });

  test("keeps volatile mode when retry persistence fails again", async () => {
    const initial = makeSnapshot();
    const fake = new FakePersistentRepository(initial);
    const store = makeStore(fake);
    await store.install(initial);
    fake.failNext = true;
    await store.commitMutation((snapshot) => nextRevision(snapshot, "01"));
    fake.failNext = true;
    await expect(store.retryPersistence()).rejects.toThrow("quota");
    expect(store.getState().mode).toBe("volatile");
    expect(store.getState().warning).toContain("quota");
    store.close();
  });

  test("receives higher revisions from another store through BroadcastChannel", async () => {
    const initial = makeSnapshot();
    initial.module.id = `broadcast.${Date.now()}`;
    const fake = new FakePersistentRepository(initial);
    const writer = new StudyStore(asRepository(fake), undefined, acceptingValidator);
    const reader = new StudyStore(asRepository(fake), undefined, acceptingValidator);
    await writer.install(initial);
    await reader.load(recoveryKeyForSnapshot(initial));
    await writer.commitMutation((snapshot) => nextRevision(snapshot, "01"));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(reader.getState().mode).toBe("stale");
    writer.close();
    reader.close();
  });

  test("treats an equal portable revision with a higher local write token as stale", async () => {
    const initial = makeSnapshot();
    initial.module.id = `broadcast.equal.${Date.now()}`;
    const fake = new FakePersistentRepository(initial);
    const store = new StudyStore(asRepository(fake), undefined, acceptingValidator);
    await store.install(initial);
    const sender = new BroadcastChannel("estudio-interactivo-revisions-v1");
    sender.postMessage({
      recoveryKey: recoveryKeyForSnapshot(initial),
      stateRevision: 0,
      writeToken: 2
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(store.getState().mode).toBe("stale");
    sender.close();
    store.close();
  });
});

describe("revision channel", () => {
  test("ignores malformed messages and forwards valid announcements", async () => {
    const name = `study-revision-test-${Date.now()}-${Math.random()}`;
    const received: Array<{ recoveryKey: string; stateRevision: number }> = [];
    const wrapper = createRevisionChannel((message) => received.push(message), name);
    const sender = new BroadcastChannel(name);
    sender.postMessage({ recoveryKey: "test@1", stateRevision: -1 });
    sender.postMessage({ recoveryKey: 7, stateRevision: 1, writeToken: 1 });
    sender.postMessage({ recoveryKey: "test@1", stateRevision: 3, writeToken: 3 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(received).toEqual([{ recoveryKey: "test@1", stateRevision: 3, writeToken: 3 }]);
    wrapper.publish({ recoveryKey: "test@1", stateRevision: 4, writeToken: 4 });
    wrapper.close();
    sender.close();
  });
});

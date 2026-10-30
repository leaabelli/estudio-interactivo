import { describe, expect, test } from "bun:test";
import { answerActiveRun, compactCompletedRuns, createActiveRun, navigateActiveRun, submitActiveRun } from "../../src/domain/runs";
import { validateSnapshot } from "../../src/domain/validation";
import { canonicalJson, readSnapshotFile } from "../../src/adapters/files";
import { deriveMetrics } from "../../src/domain/metrics";
import { deriveInsights } from "../../src/domain/insights";
import { createStudyStore } from "../../src/application/store";
import { StudyRepository } from "../../src/adapters/indexeddb";
import { makeQuestions, makeSnapshot } from "../unit/fixtures";
import type { StudySnapshot } from "../../src/domain/types";

const now = "2026-10-29T12:00:00.000Z";
const request = {
  difficulty: "mixta" as const, population: "todas" as const, requestedSize: 20, seed: 32,
  topicQuotas: [{ topic: "Tema facil", count: 5 }, { topic: "Tema medio", count: 5 }, { topic: "Tema dificil", count: 10 }]
};
function valid(snapshot: StudySnapshot) {
  const result = validateSnapshot(snapshot);
  expect(result.ok, result.ok ? undefined : JSON.stringify(result.errors)).toBe(true);
}

describe("variable-size exam persistence and validation", () => {
  test("round-trips a paused 20-question exam and scores its completion", async () => {
    let snapshot = createActiveRun(makeSnapshot(), request, now);
    snapshot = navigateActiveRun(snapshot, 19, now);
    snapshot = answerActiveRun(snapshot, { kind: "option", optionId: "a" }, now);
    valid(snapshot);
    snapshot = await readSnapshotFile(new Blob([canonicalJson(snapshot)])) as StudySnapshot;
    valid(snapshot);
    expect(snapshot.progress.activeRun!.currentIndex).toBe(19);
    expect(snapshot.progress.activeRun!.filters.topicQuotas).toEqual(request.topicQuotas);
    expect(snapshot.progress.activeRun!.items[19]!.answer).toEqual({ kind: "option", optionId: "a" });
    snapshot = submitActiveRun(snapshot, now);
    valid(snapshot);
    expect(snapshot.progress.runs[0]!.correctCount).toBe(1);
    expect(snapshot.progress.runs[0]!.incorrectCount).toBe(19);
    expect(deriveMetrics(snapshot).attemptCount).toBe(20);
    expect(deriveInsights(snapshot).lastScorePercent).toBe(5);
    valid(await readSnapshotFile(new Blob([canonicalJson(snapshot)])) as StudySnapshot);
  });

  test("persists configuration and answers through the repository/store recovery path", async () => {
    const repository = await StudyRepository.open({ indexedDB: null });
    // Exercise the persistent store path over the in-memory repository test double.
    // Real IndexedDB reload is also checked in the browser smoke test.
    Object.defineProperty(repository, "isPersistent", { value: true });
    const store = await createStudyStore(repository);
    try {
      await store.install(makeSnapshot());
      await store.commitMutation((current) => createActiveRun(current, request, now));
      await store.commitMutation((current) => navigateActiveRun(current, 15, now));
      const recoveries = await repository.listRecoveries();
      const recovered = await repository.load(recoveries[0]!.key);
      expect(recovered.progress.activeRun!.filters.topicQuotas).toEqual(request.topicQuotas);
      expect(recovered.progress.activeRun!.currentIndex).toBe(15);
      valid(recovered);
    } finally { store.close(); }
  });

  test("accepts old active/history files with no quotas and mixed run sizes", () => {
    let snapshot = createActiveRun(makeSnapshot(), { difficulty: "mixta", population: "todas", requestedSize: 10, seed: 1 }, now);
    expect(snapshot.progress.activeRun!.filters).not.toHaveProperty("topicQuotas");
    valid(snapshot);
    snapshot = submitActiveRun(snapshot, now);
    snapshot = createActiveRun(snapshot, request, now);
    valid(snapshot);
    snapshot = submitActiveRun(snapshot, now);
    snapshot = createActiveRun(snapshot, { difficulty: "mixta", population: "todas", requestedSize: 1, seed: 2 }, now);
    snapshot = submitActiveRun(snapshot, now);
    valid(snapshot);
    const compacted = compactCompletedRuns(snapshot.progress.runs, snapshot.progress.priorRunSummary, snapshot.questions, 0);
    snapshot = { ...snapshot, progress: { ...snapshot.progress, ...compacted } };
    valid(snapshot);
    expect(snapshot.progress.priorRunSummary.attemptCount).toBe(31);
  });

  test("accepts a complete large exam and correct counts beyond ten", () => {
    let snapshot = createActiveRun(makeSnapshot(makeQuestions(30)), {
      difficulty: "mixta", population: "todas", requestedSize: 120, seed: 11
    }, now);
    for (let index = 0; index < 120; index++) {
      snapshot = navigateActiveRun(snapshot, index, now);
      snapshot = answerActiveRun(snapshot, { kind: "option", optionId: "a" }, now);
    }
    valid(snapshot);
    snapshot = submitActiveRun(snapshot, now);
    valid(snapshot);
    expect(snapshot.progress.runs[0]!.correctCount).toBe(120);
  });

  test("rejects tampered quotas, totals, unknown topics and out-of-range counts", () => {
    for (const completed of [false, true]) {
      const active = createActiveRun(makeSnapshot(), request, now);
      const original = completed ? submitActiveRun(active, now) : active;
      for (const mutate of [
        (s: StudySnapshot) => { (s.progress.activeRun ?? s.progress.runs[0])!.filters.requestedSize = 19; },
        (s: StudySnapshot) => { (s.progress.activeRun ?? s.progress.runs[0])!.filters.topicQuotas![0]!.count = 6; },
        (s: StudySnapshot) => { (s.progress.activeRun ?? s.progress.runs[0])!.filters.topicQuotas![0]!.topic = "Other"; },
        (s: StudySnapshot) => { (s.progress.activeRun ?? s.progress.runs[0])!.filters.topicQuotas![1]!.topic = "Tema facil"; },
        (s: StudySnapshot) => { (s.progress.activeRun ?? s.progress.runs[0])!.filters.topicQuotas = []; },
        (s: StudySnapshot) => { (s.progress.activeRun ?? s.progress.runs[0])!.filters.requestedSize = 5001; },
      ]) {
        const changed = structuredClone(original);
        mutate(changed);
        expect(validateSnapshot(changed).ok).toBe(false);
      }
    }
  });

  test("keeps published schema size and quota bounds aligned with the validator", async () => {
    const { $defs: defs } = await Bun.file(new URL("../../schema/study-module.schema.json", import.meta.url)).json();
    expect(defs.runFilters.properties.requestedSize).toEqual({ type: "integer", minimum: 1, maximum: 5000 });
    expect(defs.runFilters.required).not.toContain("topicQuotas");
    expect(defs.topicQuota.additionalProperties).toBe(false);
    expect(defs.activeRun.properties.items.maxItems).toBe(5000);
    expect(defs.activeRun.properties.currentIndex.maximum).toBe(4999);
    expect(defs.completedRun.properties.correctCount.maximum).toBe(5000);
  });
});

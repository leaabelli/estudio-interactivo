import { describe, expect, test } from "bun:test";
import {
  MAX_DETAILED_RUNS,
  abandonActiveRun,
  answerActiveRun,
  compactCompletedRuns,
  createActiveRun,
  navigateActiveRun,
  runAnsweredCount,
  submitActiveRun
} from "../../src/domain/runs";
import { emptyPriorRunSummary, type CompletedRun, type SelectionRequest } from "../../src/domain/types";
import { makeQuestion, makeSnapshot } from "./fixtures";

const startedAt = "2026-02-01T10:00:00.000Z";
const submittedAt = "2026-02-01T10:05:00.000Z";
const request: SelectionRequest = {
  difficulty: "facil",
  population: "nuevas",
  requestedSize: 10,
  seed: 0x1234abcd
};

function readySnapshot() {
  return makeSnapshot(
    Array.from({ length: 12 }, (_, index) => makeQuestion(`q${String(index).padStart(2, "0")}`))
  );
}

describe("active run transitions", () => {
  test("creates a frozen, deterministic active run and increments revision", () => {
    const snapshot = readySnapshot();
    const created = createActiveRun(snapshot, request, startedAt);
    const run = created.progress.activeRun;

    expect(snapshot.progress.activeRun).toBeNull();
    expect(created.progress.stateRevision).toBe(1);
    expect(run?.id).toBe("run.1.1234abcd");
    expect(run?.createdStateRevision).toBe(1);
    expect(run?.items).toHaveLength(10);
    expect(new Set(run?.items.map(({ questionId }) => questionId)).size).toBe(10);
    expect(run?.items.every((item) => new Set(item.optionOrder).size === 3)).toBe(true);
    expect(() => createActiveRun(created, request, startedAt)).toThrow("already exists");
  });

  test("answers the current item, navigates, clears, and treats exact repeats as no-ops", () => {
    const created = createActiveRun(readySnapshot(), request, startedAt);
    const answered = answerActiveRun(created, { kind: "option", optionId: "a" }, submittedAt);
    expect(answered.progress.stateRevision).toBe(2);
    expect(runAnsweredCount(answered.progress.activeRun!)).toBe(1);
    expect(answerActiveRun(answered, { kind: "option", optionId: "a" })).toBe(answered);

    const navigated = navigateActiveRun(answered, 3, submittedAt);
    expect(navigated.progress.stateRevision).toBe(3);
    expect(navigated.progress.activeRun?.currentIndex).toBe(3);
    expect(navigateActiveRun(navigated, 3)).toBe(navigated);

    const cleared = answerActiveRun(navigated, null, submittedAt);
    expect(cleared.progress.activeRun?.items[3]?.answer).toBeNull();
    expect(() => answerActiveRun(cleared, { kind: "option", optionId: "missing" })).toThrow(
      "does not belong"
    );
    expect(() => navigateActiveRun(cleared, 10)).toThrow(RangeError);
  });

  test("rejects invalid or structurally stale active-run operations", () => {
    const empty = readySnapshot();
    expect(() => answerActiveRun(empty, { kind: "dontKnow" })).toThrow("no active run");
    expect(() => navigateActiveRun(empty, 0)).toThrow("no active run");

    const invalidIndex = createActiveRun(readySnapshot(), request, startedAt);
    invalidIndex.progress.activeRun!.currentIndex = 99;
    expect(() => answerActiveRun(invalidIndex, { kind: "dontKnow" })).toThrow("outside its item");

    const stale = createActiveRun(readySnapshot(), request, startedAt);
    stale.progress.activeRun!.items[0]!.questionRevision = 2;
    expect(() => answerActiveRun(stale, { kind: "dontKnow" })).toThrow("changed revision");
  });

  test("rejects revision overflow and a run-ID collision", () => {
    const exhausted = readySnapshot();
    exhausted.progress.stateRevision = Number.MAX_SAFE_INTEGER;
    expect(() => createActiveRun(exhausted, request, startedAt)).toThrow("cannot be incremented");

    const collision = readySnapshot();
    const existing = submitActiveRun(createActiveRun(readySnapshot(), request, startedAt), submittedAt)
      .progress.runs[0]!;
    collision.progress.runs.push({ ...existing, id: "run.1.1234abcd" });
    expect(() => createActiveRun(collision, request, startedAt)).toThrow("collision");
  });

  test("captures coverage before a repeated-practice run", () => {
    let snapshot = createActiveRun(readySnapshot(), request, startedAt);
    snapshot = submitActiveRun(snapshot, submittedAt);
    const repeated = createActiveRun(
      snapshot,
      { ...request, population: "todas", seed: request.seed + 1 },
      submittedAt
    );
    expect(repeated.progress.activeRun?.coverageBeforeCount).toBe(10);
  });

  test("abandoning changes no aggregates and is idempotent without a run", () => {
    const created = createActiveRun(readySnapshot(), request, startedAt);
    const abandoned = abandonActiveRun(created, submittedAt);
    expect(abandoned.progress.stateRevision).toBe(2);
    expect(abandoned.progress.activeRun).toBeNull();
    expect(abandoned.progress.questions).toEqual({});
    expect(abandoned.progress.runs).toEqual([]);
    expect(abandonActiveRun(abandoned, submittedAt)).toBe(abandoned);
  });
});

describe("submission", () => {
  test("converts unanswered items to dontKnow and applies aggregates once", () => {
    const created = createActiveRun(readySnapshot(), request, startedAt);
    const firstQuestionId = created.progress.activeRun!.items[0]!.questionId;
    const answered = answerActiveRun(created, { kind: "option", optionId: "a" }, submittedAt);
    const completed = submitActiveRun(answered, submittedAt);
    const run = completed.progress.runs[0]!;

    expect(completed.progress.stateRevision).toBe(3);
    expect(completed.progress.activeRun).toBeNull();
    expect(run.correctCount).toBe(1);
    expect(run.incorrectCount).toBe(9);
    expect(run.coverageBeforeCount).toBe(0);
    expect(run.coverageAfterCount).toBe(10);
    expect(run.items.filter((item) => item.answer?.kind === "dontKnow")).toHaveLength(9);
    expect(completed.progress.questions[firstQuestionId]).toMatchObject({
      attempts: 1,
      correct: 1,
      lastResult: "correct",
      lastCompletedStateRevision: 3
    });
    expect(Object.keys(completed.progress.questions)).toHaveLength(10);
    expect(submitActiveRun(completed, submittedAt)).toBe(completed);
  });

  test("protects submittedAt from a wall-clock rollback", () => {
    const created = createActiveRun(readySnapshot(), request, startedAt);
    const completed = submitActiveRun(created, "2020-01-01T00:00:00.000Z");
    expect(completed.progress.runs[0]?.submittedAt).toBe(startedAt);
    expect(completed.progress.updatedAt).toBe(startedAt);
  });

  test("rejects submission when frozen question content is missing", () => {
    const created = createActiveRun(readySnapshot(), request, startedAt);
    const missingId = created.progress.activeRun!.items[0]!.questionId;
    created.questions = created.questions.filter((question) => question.id !== missingId);
    expect(() => submitActiveRun(created, submittedAt)).toThrow("missing or has changed");
  });
});

describe("history compaction", () => {
  test("folds the lowest completed revision when 501 becomes 500", () => {
    const question = makeQuestion("q");
    const runs: CompletedRun[] = Array.from({ length: MAX_DETAILED_RUNS + 1 }, (_, index) => ({
      id: `run.${index + 1}.00000000`,
      status: "completed",
      createdStateRevision: index * 2 + 1,
      completedStateRevision: index * 2 + 2,
      startedAt: `2026-01-01T00:00:00.000Z`,
      submittedAt: `2026-01-01T00:00:01.000Z`,
      seed: 0,
      filters: {
        difficulty: "facil",
        population: "todas",
        requestedSize: 10,
        acceptedSize: 1
      },
      coverageBeforeCount: index === 0 ? 0 : 1,
      coverageAfterCount: 1,
      correctCount: 1,
      incorrectCount: 0,
      items: [
        {
          questionId: "q",
          questionRevision: 1,
          optionOrder: ["a", "b", "c"],
          answer: { kind: "option", optionId: "a" }
        }
      ]
    }));
    runs.reverse();

    const compacted = compactCompletedRuns(runs, emptyPriorRunSummary(), [question]);
    expect(compacted.runs).toHaveLength(500);
    expect(compacted.runs[0]?.completedStateRevision).toBe(4);
    expect(compacted.priorRunSummary).toMatchObject({
      runCount: 1,
      attemptCount: 1,
      correctCount: 1
    });
    expect(compacted.priorRunSummary.byDifficulty.facil).toEqual({ attempts: 1, correct: 1 });
  });

  test("merges compacted timestamp bounds into an existing summary", () => {
    const question = makeQuestion("q");
    const run: CompletedRun = {
      id: "run.1.00000000",
      status: "completed",
      createdStateRevision: 1,
      completedStateRevision: 2,
      startedAt,
      submittedAt,
      seed: 0,
      filters: {
        difficulty: "facil",
        population: "todas",
        requestedSize: 10,
        acceptedSize: 1
      },
      coverageBeforeCount: 0,
      coverageAfterCount: 1,
      correctCount: 0,
      incorrectCount: 1,
      items: [
        {
          questionId: "q",
          questionRevision: 1,
          optionOrder: ["a", "b", "c"],
          answer: { kind: "dontKnow" }
        }
      ]
    };
    const summary = emptyPriorRunSummary();
    summary.runCount = 1;
    summary.attemptCount = 1;
    summary.firstSubmittedAt = "2026-01-01T00:00:00.000Z";
    summary.lastSubmittedAt = "2026-03-01T00:00:00.000Z";
    const compacted = compactCompletedRuns([run], summary, [question], 0);
    expect(compacted.priorRunSummary.firstSubmittedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(compacted.priorRunSummary.lastSubmittedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  test("rejects invalid limits and dangling compacted questions", () => {
    expect(() => compactCompletedRuns([], emptyPriorRunSummary(), [], -1)).toThrow(RangeError);

    const completed = submitActiveRun(createActiveRun(readySnapshot(), request, startedAt), submittedAt)
      .progress.runs[0]!;
    expect(() => compactCompletedRuns([completed], emptyPriorRunSummary(), [], 0)).toThrow(
      "missing question"
    );
  });
});

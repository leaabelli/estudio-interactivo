import { describe, expect, test } from "bun:test";
import type { CompletedRun, StudySnapshot } from "../../src/domain/types";
import {
  buildRunTrend,
  completedRunBelongsToSnapshot,
  createRelativeNavigationAction,
  firstUnansweredIndex,
  hashForRoute,
  navigationBounds,
  routeFromHash,
  scorePercent,
} from "../../src/ui/presentation";
import { makeSnapshot } from "./fixtures";

function completedRun(
  index: number,
  correctCount: number,
  coverageAfterCount: number,
): CompletedRun {
  const items = Array.from({ length: 10 }, (_, itemIndex) => ({
    questionId: `q-${index}-${itemIndex}`,
    questionRevision: 1,
    optionOrder: ["a", "b"],
    answer: { kind: "option" as const, optionId: "a" },
  }));
  return {
    id: `run-${index}`,
    status: "completed",
    createdStateRevision: index,
    completedStateRevision: index + 1,
    startedAt: `2026-01-${String(index).padStart(2, "0")}T10:00:00.000Z`,
    submittedAt: `2026-01-${String(index).padStart(2, "0")}T10:10:00.000Z`,
    seed: index,
    filters: {
      difficulty: "mixta",
      population: "nuevas",
      requestedSize: 10,
      acceptedSize: 10,
    },
    coverageBeforeCount: Math.max(0, coverageAfterCount - 5),
    coverageAfterCount,
    items,
    correctCount,
    incorrectCount: items.length - correctCount,
  };
}

describe("presentation helpers", () => {
  test("review targets the first pending question, not an explicit unknown answer", () => {
    expect(firstUnansweredIndex([
      { answer: { kind: "option", optionId: "a" } },
      { answer: { kind: "dontKnow" } },
      { answer: null },
      { answer: null },
    ])).toBe(2);
    expect(firstUnansweredIndex([{ answer: null }])).toBe(0);
    expect(firstUnansweredIndex([{ answer: { kind: "dontKnow" } }])).toBeNull();
    expect(firstUnansweredIndex([])).toBeNull();
  });

  test("maps every app route to a stable hash and back", () => {
    for (const view of ["study", "exam", "results", "progress", "module"] as const) {
      expect(routeFromHash(hashForRoute(view))).toBe(view);
    }
    expect(routeFromHash("#desconocido")).toBeNull();
    expect(routeFromHash("  #PROGRESO ")).toBe("progress");
  });

  test("disables question navigation at the exact edges", () => {
    expect(navigationBounds(0, 0)).toEqual({ previousDisabled: true, nextDisabled: true });
    expect(navigationBounds(0, 10)).toEqual({ previousDisabled: true, nextDisabled: false });
    expect(navigationBounds(5, 10)).toEqual({ previousDisabled: false, nextDisabled: false });
    expect(navigationBounds(9, 10)).toEqual({ previousDisabled: false, nextDisabled: true });
  });

  test("keeps relative navigation attached to the live question index", () => {
    let currentIndex = 0;
    const visited: number[] = [];
    const readPosition = () => ({ currentIndex, itemCount: 10 });
    const navigate = (target: number) => {
      currentIndex = target;
      visited.push(target);
    };
    const next = createRelativeNavigationAction(readPosition, navigate, 1);
    const previous = createRelativeNavigationAction(readPosition, navigate, -1);

    next();
    next();
    next();
    previous();

    expect(visited).toEqual([1, 2, 3, 2]);
    expect(currentIndex).toBe(2);

    currentIndex = 0;
    previous();
    currentIndex = 9;
    next();
    expect(visited).toEqual([1, 2, 3, 2]);
  });

  test("builds no trend for a module without completed runs", () => {
    expect(buildRunTrend(makeSnapshot())).toEqual([]);
  });

  test("builds an accurate single-point trend", () => {
    const snapshot = makeSnapshot() as StudySnapshot;
    snapshot.questions = Array.from({ length: 20 }, (_, index) => ({
      ...snapshot.questions[0]!,
      id: `q-${index}`,
    }));
    snapshot.progress.runs = [completedRun(1, 7, 5)];

    expect(buildRunTrend(snapshot)).toEqual([
      {
        runNumber: 1,
        submittedAt: "2026-01-01T10:10:00.000Z",
        accuracyPercent: 70,
        coveragePercent: 25,
      },
    ]);
  });

  test("rejects a remembered result that belongs to another module snapshot", () => {
    const snapshot = makeSnapshot() as StudySnapshot;
    const run = completedRun(1, 7, 1);
    snapshot.questions = run.items.map((item) => ({
      ...snapshot.questions[0]!,
      id: item.questionId,
    }));
    snapshot.progress.runs = [run];

    expect(completedRunBelongsToSnapshot(snapshot, run)).toBe(true);
    expect(completedRunBelongsToSnapshot({
      ...snapshot,
      questions: snapshot.questions.map((question) => ({ ...question, id: `other-${question.id}` })),
    }, run)).toBe(false);
  });

  test("keeps the latest twelve detailed runs and preserves their global numbering", () => {
    const snapshot = makeSnapshot() as StudySnapshot;
    snapshot.questions = Array.from({ length: 100 }, (_, index) => ({
      ...snapshot.questions[0]!,
      id: `q-${index}`,
    }));
    snapshot.progress.priorRunSummary.runCount = 8;
    snapshot.progress.runs = Array.from({ length: 15 }, (_, index) =>
      completedRun(index + 1, index % 11, Math.min(100, (index + 1) * 5)),
    );

    const trend = buildRunTrend(snapshot);
    expect(trend).toHaveLength(12);
    expect(trend[0]?.runNumber).toBe(12);
    expect(trend.at(-1)?.runNumber).toBe(23);
    expect(trend.at(-1)?.coveragePercent).toBe(75);
  });

  test("score percentages are safe at empty and out-of-range inputs", () => {
    expect(scorePercent(0, 0)).toBe(0);
    expect(scorePercent(7, 10)).toBe(70);
    expect(scorePercent(12, 10)).toBe(100);
  });
});

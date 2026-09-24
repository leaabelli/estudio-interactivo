import { describe, expect, test } from "bun:test";
import {
  buildExamHistory,
  deriveInsights,
  recommendNextSteps,
  topicInsights
} from "../../src/domain/insights";
import { answerActiveRun, createActiveRun, navigateActiveRun, submitActiveRun } from "../../src/domain/runs";
import type { StudySnapshot } from "../../src/domain/types";
import { makeQuestions, makeSnapshot, progress } from "./fixtures";

const NOW = "2026-09-25T12:00:00.000Z";

function playExam(snapshot: StudySnapshot, seed: number, correctCount: number): StudySnapshot {
  let current = createActiveRun(snapshot, { difficulty: "mixta", population: "todas", requestedSize: 10, seed }, NOW);
  current.progress.activeRun!.items.forEach((_, index) => {
    current = navigateActiveRun(current, index, NOW);
    current = answerActiveRun(current, { kind: "option", optionId: index < correctCount ? "a" : "b" }, NOW);
  });
  return submitActiveRun(current, NOW);
}

describe("insights", () => {
  test("grades come from each exam, not from cumulative attempts", () => {
    let snapshot = makeSnapshot();
    snapshot = playExam(snapshot, 1, 2);
    snapshot = playExam(snapshot, 2, 9);
    const insights = deriveInsights(snapshot);
    expect(insights.lastScorePercent).toBe(90);
    expect(insights.lastScoreDelta).toBe(70);
    expect(insights.bestScorePercent).toBe(90);
    expect(buildExamHistory(snapshot).map((point) => point.movingAveragePercent)).toEqual([20, 55]);
  });

  test("topics are ordered from weakest to strongest, unseen last", () => {
    const snapshot = makeSnapshot(makeQuestions(2));
    snapshot.progress.questions["facil.01"] = progress({ correct: 1, lastResult: "correct" });
    snapshot.progress.questions["medio.01"] = progress();
    expect(topicInsights(snapshot).map((topic) => [topic.topic, topic.levelPercent])).toEqual([
      ["Tema medio", 0],
      ["Tema facil", 100],
      ["Tema dificil", null],
      ["Tema experto", null]
    ]);
  });
});

describe("next step", () => {
  test("an untouched bank starts with a diagnostic", () => {
    expect(recommendNextSteps(makeSnapshot())[0]).toEqual({ kind: "diagnostic", newCount: 48 });
  });

  test("a pile of mistakes is reviewed first, then the weakest topic", () => {
    let snapshot = makeSnapshot();
    snapshot = playExam(snapshot, 3, 4);
    const [first, second] = recommendNextSteps(snapshot);
    expect(first).toEqual({ kind: "failed", failedCount: 6 });
    expect(second?.kind).toBe("topic");
  });

  test("with a good grade and few mistakes it moves on to new questions", () => {
    let snapshot = makeSnapshot();
    snapshot = playExam(snapshot, 4, 10);
    expect(recommendNextSteps(snapshot)[0]).toEqual({ kind: "new", newCount: 38 });
  });

  test("always ends with a smart mix", () => {
    expect(recommendNextSteps(makeSnapshot()).at(-1)).toEqual({ kind: "mixed" });
  });
});

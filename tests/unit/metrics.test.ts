import { describe, expect, test } from "bun:test";
import { deriveMetrics } from "../../src/domain/metrics";
import { makeQuestion, makeSnapshot, progress } from "./fixtures";

describe("deriveMetrics", () => {
  test("keeps zero-attempt accuracy null", () => {
    const metrics = deriveMetrics(
      makeSnapshot([makeQuestion("f", "facil"), makeQuestion("m", "medio")])
    );
    expect(metrics).toMatchObject({
      totalQuestions: 2,
      evaluatedQuestions: 0,
      coveragePercent: 0,
      attemptCount: 0,
      correctCount: 0,
      accuracyPercent: null,
      masteredQuestions: 0,
      masteryPercent: 0
    });
    expect(metrics.byDifficulty.facil.accuracyPercent).toBeNull();
    expect(metrics.byDifficulty.experto.coveragePercent).toBe(0);
  });

  test("separates coverage, attempt accuracy, and latest-result mastery", () => {
    const snapshot = makeSnapshot([
      makeQuestion("f1", "facil"),
      makeQuestion("f2", "facil"),
      makeQuestion("f3", "facil"),
      makeQuestion("m1", "medio")
    ]);
    snapshot.progress.questions.f1 = progress({ attempts: 3, correct: 2, lastResult: "correct" });
    snapshot.progress.questions.f2 = progress({ attempts: 2, correct: 1, lastResult: "incorrect" });
    snapshot.progress.questions.m1 = progress({ attempts: 1, correct: 1, lastResult: "correct" });

    const metrics = deriveMetrics(snapshot);
    expect(metrics).toMatchObject({
      totalQuestions: 4,
      evaluatedQuestions: 3,
      coveragePercent: 75,
      attemptCount: 6,
      correctCount: 4,
      accuracyPercent: 66.7,
      masteredQuestions: 2,
      masteryPercent: 50
    });
    expect(metrics.byDifficulty.facil).toEqual({
      total: 3,
      evaluated: 2,
      coveragePercent: 66.7,
      attempts: 5,
      correct: 3,
      accuracyPercent: 60,
      mastered: 1,
      masteryPercent: 33.3
    });
  });
});

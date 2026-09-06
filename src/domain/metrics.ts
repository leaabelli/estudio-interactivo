import {
  DIFFICULTIES,
  type Difficulty,
  type QuestionProgress,
  type StudyMetrics,
  type StudySnapshot
} from "./types";

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

function ownProgress(snapshot: StudySnapshot, questionId: string): QuestionProgress | undefined {
  return Object.prototype.hasOwnProperty.call(snapshot.progress.questions, questionId)
    ? snapshot.progress.questions[questionId]
    : undefined;
}

export function deriveMetrics(snapshot: StudySnapshot): StudyMetrics {
  const byDifficulty = Object.fromEntries(
    DIFFICULTIES.map((difficulty) => [
      difficulty,
      {
        total: 0,
        evaluated: 0,
        coveragePercent: 0,
        attempts: 0,
        correct: 0,
        accuracyPercent: null,
        mastered: 0,
        masteryPercent: 0
      }
    ])
  ) as StudyMetrics["byDifficulty"];

  let evaluatedQuestions = 0;
  let attemptCount = 0;
  let correctCount = 0;
  let masteredQuestions = 0;

  for (const question of snapshot.questions) {
    const progress = ownProgress(snapshot, question.id);
    const difficultyMetrics = byDifficulty[question.difficulty];
    difficultyMetrics.total += 1;

    if (!progress || progress.attempts === 0) {
      continue;
    }

    evaluatedQuestions += 1;
    attemptCount += progress.attempts;
    correctCount += progress.correct;
    difficultyMetrics.evaluated += 1;
    difficultyMetrics.attempts += progress.attempts;
    difficultyMetrics.correct += progress.correct;

    if (progress.lastResult === "correct") {
      masteredQuestions += 1;
      difficultyMetrics.mastered += 1;
    }
  }

  for (const difficulty of DIFFICULTIES) {
    const metrics = byDifficulty[difficulty as Difficulty];
    metrics.coveragePercent = percentage(metrics.evaluated, metrics.total);
    metrics.accuracyPercent =
      metrics.attempts === 0 ? null : percentage(metrics.correct, metrics.attempts);
    metrics.masteryPercent = percentage(metrics.mastered, metrics.total);
  }

  return {
    totalQuestions: snapshot.questions.length,
    evaluatedQuestions,
    coveragePercent: percentage(evaluatedQuestions, snapshot.questions.length),
    attemptCount,
    correctCount,
    accuracyPercent: attemptCount === 0 ? null : percentage(correctCount, attemptCount),
    masteredQuestions,
    masteryPercent: percentage(masteredQuestions, snapshot.questions.length),
    byDifficulty
  };
}

export const calculateMetrics = deriveMetrics;

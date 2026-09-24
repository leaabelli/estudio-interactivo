import type { CompletedRun, QuestionProgress, StudyQuestion, StudySnapshot } from "./types";

/**
 * Derived study insights. Everything here is computed from data that every
 * existing .study.json already stores, so no file-format change is needed.
 */

export const RECENT_WINDOW = 5;

export interface ExamPoint {
  run: CompletedRun;
  examNumber: number;
  scorePercent: number;
  /** Mean score of this exam and up to RECENT_WINDOW - 1 previous detailed exams. */
  movingAveragePercent: number;
}

export interface TopicInsight {
  topic: string;
  total: number;
  evaluated: number;
  mastered: number;
  failing: number;
  attempts: number;
  correct: number;
  /** Share of evaluated questions whose latest answer was correct. */
  levelPercent: number | null;
}

export interface FailedQuestion {
  question: StudyQuestion;
  progress: QuestionProgress;
}

export interface StudyInsights {
  examCount: number;
  lastScorePercent: number | null;
  lastScoreDelta: number | null;
  recentAveragePercent: number | null;
  recentAverageDelta: number | null;
  bestScorePercent: number | null;
  /** Mastered / evaluated: how well you know what you have already seen. */
  currentLevelPercent: number | null;
  failed: FailedQuestion[];
  topics: TopicInsight[];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function mean(values: readonly number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function ownProgress(snapshot: StudySnapshot, questionId: string): QuestionProgress | undefined {
  return Object.prototype.hasOwnProperty.call(snapshot.progress.questions, questionId)
    ? snapshot.progress.questions[questionId]
    : undefined;
}

export function runScorePercent(run: Pick<CompletedRun, "correctCount" | "items">): number {
  return run.items.length ? round((run.correctCount / run.items.length) * 100) : 0;
}

export function examNumberOffset(snapshot: StudySnapshot): number {
  return snapshot.progress.priorRunSummary.runCount;
}

export function buildExamHistory(snapshot: StudySnapshot): ExamPoint[] {
  const offset = examNumberOffset(snapshot);
  const scores: number[] = [];
  return snapshot.progress.runs.map((run, index) => {
    const scorePercent = runScorePercent(run);
    scores.push(scorePercent);
    return {
      run,
      examNumber: offset + index + 1,
      scorePercent,
      movingAveragePercent: mean(scores.slice(-RECENT_WINDOW)) ?? scorePercent,
    };
  });
}

export function failedQuestions(snapshot: StudySnapshot): FailedQuestion[] {
  const failed: FailedQuestion[] = [];
  for (const question of snapshot.questions) {
    const progress = ownProgress(snapshot, question.id);
    if (progress && progress.attempts > 0 && progress.lastResult === "incorrect") {
      failed.push({ question, progress });
    }
  }
  return failed.sort((left, right) =>
    (right.progress.lastCompletedStateRevision ?? 0) - (left.progress.lastCompletedStateRevision ?? 0));
}

export function topicInsights(snapshot: StudySnapshot): TopicInsight[] {
  const byTopic = new Map<string, TopicInsight>();
  for (const question of snapshot.questions) {
    const topic = byTopic.get(question.topic) ?? {
      topic: question.topic,
      total: 0,
      evaluated: 0,
      mastered: 0,
      failing: 0,
      attempts: 0,
      correct: 0,
      levelPercent: null,
    };
    topic.total += 1;
    const progress = ownProgress(snapshot, question.id);
    if (progress && progress.attempts > 0) {
      topic.evaluated += 1;
      topic.attempts += progress.attempts;
      topic.correct += progress.correct;
      if (progress.lastResult === "correct") topic.mastered += 1;
      else topic.failing += 1;
    }
    byTopic.set(question.topic, topic);
  }
  const topics = [...byTopic.values()];
  for (const topic of topics) {
    topic.levelPercent = topic.evaluated ? round((topic.mastered / topic.evaluated) * 100) : null;
  }
  // Weakest evaluated topics first; unseen topics last.
  return topics.sort((left, right) => {
    if (left.levelPercent === null || right.levelPercent === null) {
      if (left.levelPercent === right.levelPercent) return left.topic.localeCompare(right.topic, "es");
      return left.levelPercent === null ? 1 : -1;
    }
    return left.levelPercent - right.levelPercent
      || right.failing - left.failing
      || left.topic.localeCompare(right.topic, "es");
  });
}

export function deriveInsights(snapshot: StudySnapshot): StudyInsights {
  const history = buildExamHistory(snapshot);
  const scores = history.map((point) => point.scorePercent);
  const last = scores.at(-1) ?? null;
  const previous = scores.length > 1 ? scores.at(-2)! : null;
  const recent = mean(scores.slice(-RECENT_WINDOW));
  const priorWindow = scores.slice(-RECENT_WINDOW * 2, -RECENT_WINDOW);
  const prior = priorWindow.length ? mean(priorWindow) : null;

  let evaluated = 0;
  let mastered = 0;
  for (const question of snapshot.questions) {
    const progress = ownProgress(snapshot, question.id);
    if (!progress || progress.attempts === 0) continue;
    evaluated += 1;
    if (progress.lastResult === "correct") mastered += 1;
  }

  return {
    examCount: snapshot.progress.priorRunSummary.runCount + snapshot.progress.runs.length,
    lastScorePercent: last,
    lastScoreDelta: last !== null && previous !== null ? round(last - previous) : null,
    recentAveragePercent: recent,
    recentAverageDelta: recent !== null && prior !== null ? round(recent - prior) : null,
    bestScorePercent: scores.length ? Math.max(...scores) : null,
    currentLevelPercent: evaluated ? round((mastered / evaluated) * 100) : null,
    failed: failedQuestions(snapshot),
    topics: topicInsights(snapshot),
  };
}

export type NextStep =
  | { kind: "diagnostic"; newCount: number }
  | { kind: "failed"; failedCount: number }
  | { kind: "topic"; topic: string; levelPercent: number; questionIds: string[] }
  | { kind: "new"; newCount: number }
  | { kind: "mixed" };

/**
 * Suggests what to study next, most valuable first: an unseen bank starts with
 * a diagnostic, a pile of mistakes gets reviewed, a clearly weak topic gets
 * reinforced, otherwise new material, otherwise a smart mix.
 */
export function recommendNextSteps(snapshot: StudySnapshot, insights = deriveInsights(snapshot)): NextStep[] {
  const newCount = snapshot.questions.filter((question) => (ownProgress(snapshot, question.id)?.attempts ?? 0) === 0).length;
  const failedCount = insights.failed.length;
  const steps: NextStep[] = [];
  if (insights.examCount === 0 && newCount > 0) steps.push({ kind: "diagnostic", newCount });
  if (failedCount >= 5 || (failedCount > 0 && (insights.lastScorePercent ?? 100) < 70)) {
    steps.push({ kind: "failed", failedCount });
  }
  const weakest = insights.topics.find((topic) => topic.levelPercent !== null && topic.levelPercent < 60);
  if (weakest) {
    const inTopic = snapshot.questions.filter((question) => question.topic === weakest.topic);
    const failedIds = inTopic.filter((question) => ownProgress(snapshot, question.id)?.lastResult === "incorrect").map((question) => question.id);
    const unseenIds = inTopic.filter((question) => (ownProgress(snapshot, question.id)?.attempts ?? 0) === 0).map((question) => question.id);
    const questionIds = [...failedIds, ...unseenIds].slice(0, 10);
    if (questionIds.length) {
      steps.push({ kind: "topic", topic: weakest.topic, levelPercent: weakest.levelPercent!, questionIds });
    }
  }
  if (newCount > 0 && insights.examCount > 0) steps.push({ kind: "new", newCount });
  if (failedCount > 0 && !steps.some((step) => step.kind === "failed")) steps.push({ kind: "failed", failedCount });
  steps.push({ kind: "mixed" });
  return steps;
}

export function incorrectItemIds(run: CompletedRun, snapshot: StudySnapshot): string[] {
  const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
  return run.items
    .filter((item) => {
      const question = byId.get(item.questionId);
      return question && !(item.answer?.kind === "option" && item.answer.optionId === question.correctOptionId);
    })
    .map((item) => item.questionId);
}


import {
  emptyPriorRunSummary,
  type ActiveRun,
  type CompletedRun,
  type Difficulty,
  type PriorRunSummary,
  type QuestionProgress,
  type SelectionRequest,
  type StudyAnswer,
  type StudyQuestion,
  type StudySnapshot
} from "./types";
import { deterministicShuffle, fnv1aUtf8 } from "./rng";
import { selectQuestions } from "./selection";

export const MAX_DETAILED_RUNS = 500;

function nextRevision(snapshot: StudySnapshot): number {
  const revision = snapshot.progress.stateRevision + 1;
  if (!Number.isSafeInteger(revision)) {
    throw new RangeError("The state revision cannot be incremented safely.");
  }
  return revision;
}

function questionMap(snapshot: StudySnapshot): Map<string, StudyQuestion> {
  return new Map(snapshot.questions.map((question) => [question.id, question]));
}

function runId(revision: number, seed: number): string {
  return `run.${revision}.${(seed >>> 0).toString(16).padStart(8, "0")}`;
}

function answersEqual(left: StudyAnswer | null, right: StudyAnswer | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  return left.kind === "dontKnow" || left.optionId === (right as { optionId: string }).optionId;
}

function withProgress(
  snapshot: StudySnapshot,
  revision: number,
  updatedAt: string,
  changes: Partial<StudySnapshot["progress"]>
): StudySnapshot {
  return {
    ...snapshot,
    progress: {
      ...snapshot.progress,
      ...changes,
      stateRevision: revision,
      updatedAt
    }
  };
}

function coverageCount(snapshot: StudySnapshot): number {
  let count = 0;
  for (const question of snapshot.questions) {
    const progress = Object.prototype.hasOwnProperty.call(snapshot.progress.questions, question.id)
      ? snapshot.progress.questions[question.id]
      : undefined;
    if (progress && progress.attempts > 0) {
      count += 1;
    }
  }
  return count;
}

function validateAnswer(question: StudyQuestion, answer: StudyAnswer | null): void {
  if (answer?.kind !== "option") {
    return;
  }
  if (!question.options.some((option) => option.id === answer.optionId)) {
    throw new RangeError(`Option ${answer.optionId} does not belong to question ${question.id}.`);
  }
}

export function createActiveRun(
  snapshot: StudySnapshot,
  request: SelectionRequest,
  now: string
): StudySnapshot {
  if (snapshot.progress.activeRun) {
    throw new Error("An active run already exists.");
  }

  const selected = selectQuestions(snapshot, request);
  const revision = nextRevision(snapshot);
  const id = runId(revision, request.seed);
  if (snapshot.progress.runs.some((run) => run.id === id)) {
    throw new Error(`Run ID collision: ${id}.`);
  }

  const activeRun: ActiveRun = {
    id,
    status: "active",
    createdStateRevision: revision,
    completedStateRevision: null,
    startedAt: now,
    submittedAt: null,
    seed: request.seed >>> 0,
    filters: {
      difficulty: request.difficulty,
      population: request.population,
      requestedSize: 10,
      acceptedSize: selected.length
    },
    coverageBeforeCount: coverageCount(snapshot),
    currentIndex: 0,
    items: selected.map((question) => ({
      questionId: question.id,
      questionRevision: question.revision,
      optionOrder: deterministicShuffle(
        question.options.map((option) => option.id),
        ((request.seed >>> 0) ^ fnv1aUtf8(question.id)) >>> 0
      ),
      answer: null
    }))
  };

  return withProgress(snapshot, revision, now, { activeRun });
}

export function answerActiveRun(
  snapshot: StudySnapshot,
  answer: StudyAnswer | null,
  now = snapshot.progress.updatedAt
): StudySnapshot {
  const activeRun = snapshot.progress.activeRun;
  if (!activeRun) {
    throw new Error("There is no active run to answer.");
  }

  const item = activeRun.items[activeRun.currentIndex];
  if (!item) {
    throw new RangeError("The active run index is outside its item list.");
  }
  const question = snapshot.questions.find((candidate) => candidate.id === item.questionId);
  if (!question || question.revision !== item.questionRevision) {
    throw new Error(`Question ${item.questionId} is missing or has changed revision.`);
  }
  validateAnswer(question, answer);

  if (answersEqual(item.answer, answer)) {
    return snapshot;
  }

  const revision = nextRevision(snapshot);
  const items = activeRun.items.map((candidate, index) =>
    index === activeRun.currentIndex ? { ...candidate, answer } : candidate
  );
  return withProgress(snapshot, revision, now, {
    activeRun: { ...activeRun, items }
  });
}

export function navigateActiveRun(
  snapshot: StudySnapshot,
  index: number,
  now = snapshot.progress.updatedAt
): StudySnapshot {
  const activeRun = snapshot.progress.activeRun;
  if (!activeRun) {
    throw new Error("There is no active run to navigate.");
  }
  if (!Number.isInteger(index) || index < 0 || index >= activeRun.items.length) {
    throw new RangeError("The requested question index is outside the active run.");
  }
  if (index === activeRun.currentIndex) {
    return snapshot;
  }

  const revision = nextRevision(snapshot);
  return withProgress(snapshot, revision, now, {
    activeRun: { ...activeRun, currentIndex: index }
  });
}

export function abandonActiveRun(snapshot: StudySnapshot, now: string): StudySnapshot {
  if (!snapshot.progress.activeRun) {
    return snapshot;
  }
  return withProgress(snapshot, nextRevision(snapshot), now, { activeRun: null });
}

function laterTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function earlierTimestamp(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function foldRun(
  summary: PriorRunSummary,
  run: CompletedRun,
  questions: ReadonlyMap<string, StudyQuestion>
): PriorRunSummary {
  const byDifficulty: PriorRunSummary["byDifficulty"] = {
    facil: { ...summary.byDifficulty.facil },
    medio: { ...summary.byDifficulty.medio },
    dificil: { ...summary.byDifficulty.dificil },
    experto: { ...summary.byDifficulty.experto }
  };

  for (const item of run.items) {
    const question = questions.get(item.questionId);
    if (!question) {
      throw new Error(`Cannot compact missing question ${item.questionId}.`);
    }
    const bucket = byDifficulty[question.difficulty];
    bucket.attempts += 1;
    if (item.answer?.kind === "option" && item.answer.optionId === question.correctOptionId) {
      bucket.correct += 1;
    }
  }

  return {
    runCount: summary.runCount + 1,
    attemptCount: summary.attemptCount + run.items.length,
    correctCount: summary.correctCount + run.correctCount,
    firstSubmittedAt:
      summary.firstSubmittedAt === null
        ? run.submittedAt
        : earlierTimestamp(summary.firstSubmittedAt, run.submittedAt),
    lastSubmittedAt:
      summary.lastSubmittedAt === null
        ? run.submittedAt
        : laterTimestamp(summary.lastSubmittedAt, run.submittedAt),
    byDifficulty
  };
}

export interface CompactedRuns {
  runs: CompletedRun[];
  priorRunSummary: PriorRunSummary;
}

/** Compacts the lowest completed-state revisions until at most limit remain. */
export function compactCompletedRuns(
  runs: readonly CompletedRun[],
  priorRunSummary: PriorRunSummary,
  questions: readonly StudyQuestion[],
  limit = MAX_DETAILED_RUNS
): CompactedRuns {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("The detailed-run limit must be a non-negative integer.");
  }

  const ordered = [...runs].sort(
    (left, right) => left.completedStateRevision - right.completedStateRevision
  );
  let summary = priorRunSummary;
  const byId = new Map(questions.map((question) => [question.id, question]));

  while (ordered.length > limit) {
    const oldest = ordered.shift() as CompletedRun;
    summary = foldRun(summary, oldest, byId);
  }

  return { runs: ordered, priorRunSummary: summary };
}

export function submitActiveRun(snapshot: StudySnapshot, now: string): StudySnapshot {
  const activeRun = snapshot.progress.activeRun;
  if (!activeRun) {
    return snapshot;
  }

  const questions = questionMap(snapshot);
  const revision = nextRevision(snapshot);
  const submittedAt = laterTimestamp(now, activeRun.startedAt);
  const answeredItems = activeRun.items.map((item) => ({
    ...item,
    answer: item.answer ?? ({ kind: "dontKnow" } as const)
  }));
  let correctCount = 0;
  const progressQuestions: Record<string, QuestionProgress> = {
    ...snapshot.progress.questions
  };

  for (const item of answeredItems) {
    const question = questions.get(item.questionId);
    if (!question || question.revision !== item.questionRevision) {
      throw new Error(`Question ${item.questionId} is missing or has changed revision.`);
    }
    validateAnswer(question, item.answer);
    const isCorrect =
      item.answer.kind === "option" && item.answer.optionId === question.correctOptionId;
    if (isCorrect) {
      correctCount += 1;
    }

    const previous = Object.prototype.hasOwnProperty.call(progressQuestions, item.questionId)
      ? progressQuestions[item.questionId]
      : undefined;
    progressQuestions[item.questionId] = {
      questionRevision: question.revision,
      attempts: (previous?.attempts ?? 0) + 1,
      correct: (previous?.correct ?? 0) + (isCorrect ? 1 : 0),
      lastResult: isCorrect ? "correct" : "incorrect",
      lastAnswer: item.answer,
      lastSubmittedAt: submittedAt,
      lastCompletedStateRevision: revision
    };
  }

  const coverageAfterCount = snapshot.questions.reduce(
    (count, question) => count + ((progressQuestions[question.id]?.attempts ?? 0) > 0 ? 1 : 0),
    0
  );
  const completedRun: CompletedRun = {
    id: activeRun.id,
    status: "completed",
    createdStateRevision: activeRun.createdStateRevision,
    completedStateRevision: revision,
    startedAt: activeRun.startedAt,
    submittedAt,
    seed: activeRun.seed,
    filters: activeRun.filters,
    coverageBeforeCount: activeRun.coverageBeforeCount,
    coverageAfterCount,
    correctCount,
    incorrectCount: answeredItems.length - correctCount,
    items: answeredItems
  };

  const compacted = compactCompletedRuns(
    [...snapshot.progress.runs, completedRun],
    snapshot.progress.priorRunSummary ?? emptyPriorRunSummary(),
    snapshot.questions
  );

  return withProgress(snapshot, revision, submittedAt, {
    questions: progressQuestions,
    runs: compacted.runs,
    priorRunSummary: compacted.priorRunSummary,
    activeRun: null
  });
}

export function runAnsweredCount(run: ActiveRun): number {
  return run.items.reduce((count, item) => count + (item.answer === null ? 0 : 1), 0);
}

import {
  DIFFICULTIES,
  type Difficulty,
  type DifficultyFilter,
  type QuestionProgress,
  type SelectionPopulation,
  type SelectionRequest,
  type StudyQuestion,
  type StudySnapshot
} from "./types";
import { deterministicShuffle, fisherYates, fnv1aUtf8, mulberry32 } from "./rng";

const MIXED_TARGETS: Readonly<Record<Difficulty, number>> = {
  facil: 3,
  medio: 3,
  dificil: 2,
  experto: 2
};

export class InsufficientQuestionsError extends Error {
  readonly eligibleCount: number;
  readonly requestedCount: number;
  readonly difficulty: DifficultyFilter;
  readonly population: SelectionPopulation;

  constructor(
    eligibleCount: number,
    requestedCount: number,
    difficulty: DifficultyFilter,
    population: SelectionPopulation
  ) {
    super(`Only ${eligibleCount} questions are eligible; ${requestedCount} were requested.`);
    this.name = "InsufficientQuestionsError";
    this.eligibleCount = eligibleCount;
    this.requestedCount = requestedCount;
    this.difficulty = difficulty;
    this.population = population;
  }
}

function ownProgress(snapshot: StudySnapshot, questionId: string): QuestionProgress | undefined {
  return Object.prototype.hasOwnProperty.call(snapshot.progress.questions, questionId)
    ? snapshot.progress.questions[questionId]
    : undefined;
}

function attemptsFor(snapshot: StudySnapshot, questionId: string): number {
  return ownProgress(snapshot, questionId)?.attempts ?? 0;
}

function matchesDifficulty(question: StudyQuestion, difficulty: DifficultyFilter): boolean {
  return difficulty === "mixta" || question.difficulty === difficulty;
}

function matchesPopulation(
  snapshot: StudySnapshot,
  question: StudyQuestion,
  population: SelectionPopulation
): boolean {
  if (population === "todas") return true;
  if (population === "nuevas") return attemptsFor(snapshot, question.id) === 0;
  const progress = ownProgress(snapshot, question.id);
  return Boolean(progress && progress.attempts > 0 && progress.lastResult === "incorrect");
}

function isEligible(
  snapshot: StudySnapshot,
  question: StudyQuestion,
  difficulty: DifficultyFilter,
  population: SelectionPopulation,
  questionIds?: ReadonlySet<string>
): boolean {
  return (
    (!questionIds || questionIds.has(question.id)) &&
    matchesDifficulty(question, difficulty) &&
    matchesPopulation(snapshot, question, population)
  );
}

export function countEligible(
  snapshot: StudySnapshot,
  difficulty: DifficultyFilter,
  population: SelectionPopulation
): number {
  let count = 0;
  for (const question of snapshot.questions) {
    if (isEligible(snapshot, question, difficulty, population)) {
      count += 1;
    }
  }
  return count;
}

/** Detailed exams completed since the question was last answered; unknown counts as long ago. */
function examsSince(progress: QuestionProgress, completedRevisions: readonly number[]): number {
  const last = progress.lastCompletedStateRevision;
  if (last === null || completedRevisions.length === 0) return Number.POSITIVE_INFINITY;
  let count = 0;
  for (let index = completedRevisions.length - 1; index >= 0; index -= 1) {
    if ((completedRevisions[index] as number) <= last) break;
    count += 1;
  }
  return count;
}

/**
 * Relative chance of a question being drawn. Unseen and failed questions are
 * favored, questions answered in the latest exams rest for a while, and
 * mastered questions keep a small share so they still come back for review.
 */
export function selectionWeight(
  progress: QuestionProgress | undefined,
  completedRevisions: readonly number[]
): number {
  if (!progress || progress.attempts === 0) return 3;
  const since = examsSince(progress, completedRevisions);
  if (progress.lastResult === "incorrect") {
    return 4 * Math.min(1, 0.5 + 0.25 * since);
  }
  const errorRate = 1 - progress.correct / progress.attempts;
  return (1 + errorRate) * Math.min(1, 0.2 + 0.2 * since);
}

function rankedPool(
  snapshot: StudySnapshot,
  questions: readonly StudyQuestion[],
  population: SelectionPopulation,
  seed: number,
  salt: string
): StudyQuestion[] {
  const byId = [...questions].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
  const random = mulberry32((seed ^ fnv1aUtf8(salt)) >>> 0);

  if (population === "nuevas") {
    return fisherYates(byId, random);
  }

  // Weighted sampling without replacement (Efraimidis-Spirakis): sorting by
  // log(u) / w keeps every question possible while favoring heavier weights.
  const completedRevisions = snapshot.progress.runs
    .map((run) => run.completedStateRevision)
    .sort((left, right) => left - right);
  const keyed = byId.map((question) => {
    const weight = selectionWeight(ownProgress(snapshot, question.id), completedRevisions);
    const draw = Math.max(random(), Number.MIN_VALUE);
    return { question, key: Math.log(draw) / weight };
  });
  keyed.sort((left, right) => right.key - left.key);
  return keyed.map(({ question }) => question);
}

function selectedSize(request: SelectionRequest, eligibleCount: number): number {
  const acceptedSize = request.acceptedSize ?? request.requestedSize;
  if (!Number.isInteger(acceptedSize) || acceptedSize < 1 || acceptedSize > request.requestedSize) {
    throw new RangeError("acceptedSize must be an integer from 1 through requestedSize.");
  }

  if (acceptedSize < request.requestedSize && acceptedSize !== eligibleCount) {
    throw new RangeError("A shorter run must accept every eligible question.");
  }

  if (eligibleCount < acceptedSize) {
    throw new InsufficientQuestionsError(
      eligibleCount,
      acceptedSize,
      request.difficulty,
      request.population
    );
  }

  return acceptedSize;
}

function fixedSelection(
  snapshot: StudySnapshot,
  request: SelectionRequest,
  eligible: readonly StudyQuestion[],
  size: number
): StudyQuestion[] {
  const ranked = rankedPool(
    snapshot,
    eligible,
    request.population,
    request.seed,
    `selection.${request.difficulty}`
  );
  return deterministicShuffle(
    ranked.slice(0, size),
    (request.seed ^ fnv1aUtf8("selection.question-order")) >>> 0
  );
}

function mixedSelection(
  snapshot: StudySnapshot,
  request: SelectionRequest,
  eligible: readonly StudyQuestion[],
  size: number
): StudyQuestion[] {
  const pools = new Map<Difficulty, StudyQuestion[]>();
  const selected: StudyQuestion[] = [];

  for (const difficulty of DIFFICULTIES) {
    const questions = eligible.filter((question) => question.difficulty === difficulty);
    const ranked = rankedPool(
      snapshot,
      questions,
      request.population,
      request.seed,
      `selection.${difficulty}`
    );
    const target = Math.min(MIXED_TARGETS[difficulty], ranked.length);
    selected.push(...ranked.slice(0, target));
    pools.set(difficulty, ranked.slice(target));
  }

  let cursor = request.seed % DIFFICULTIES.length;
  while (selected.length < size) {
    let found = false;
    for (let offset = 0; offset < DIFFICULTIES.length; offset += 1) {
      const difficultyIndex = (cursor + offset) % DIFFICULTIES.length;
      const difficulty = DIFFICULTIES[difficultyIndex] as Difficulty;
      const pool = pools.get(difficulty);
      if (pool && pool.length > 0) {
        selected.push(pool.shift() as StudyQuestion);
        cursor = (difficultyIndex + 1) % DIFFICULTIES.length;
        found = true;
        break;
      }
    }

    if (!found) {
      break;
    }
  }

  return deterministicShuffle(
    selected.slice(0, size),
    (request.seed ^ fnv1aUtf8("selection.question-order")) >>> 0
  );
}

/**
 * Selects the requested questions deterministically. A shortage is explicit:
 * callers must either leave acceptedSize undefined for a full run, or set it to
 * the complete eligible count to confirm a shorter run.
 */
export function selectQuestions(
  snapshot: StudySnapshot,
  request: SelectionRequest
): StudyQuestion[] {
  if (request.requestedSize !== 10) {
    throw new RangeError("requestedSize must be exactly 10.");
  }
  if (
    !Number.isInteger(request.seed) ||
    request.seed < 0 ||
    request.seed > 0xffff_ffff
  ) {
    throw new RangeError("seed must be an unsigned 32-bit integer.");
  }

  const questionIds = request.questionIds ? new Set(request.questionIds) : undefined;
  const eligible = snapshot.questions.filter((question) =>
    isEligible(snapshot, question, request.difficulty, request.population, questionIds)
  );
  const size = selectedSize(request, eligible.length);

  const selected =
    request.difficulty === "mixta"
      ? mixedSelection(snapshot, request, eligible, size)
      : fixedSelection(snapshot, request, eligible, size);

  if (selected.length !== size || new Set(selected.map((question) => question.id)).size !== size) {
    throw new Error("Selection invariant failed: expected a unique, complete selection.");
  }

  return selected;
}

export function countEligibleByDifficulty(
  snapshot: StudySnapshot,
  population: SelectionPopulation
): Record<Difficulty, number> {
  return {
    facil: countEligible(snapshot, "facil", population),
    medio: countEligible(snapshot, "medio", population),
    dificil: countEligible(snapshot, "dificil", population),
    experto: countEligible(snapshot, "experto", population)
  };
}

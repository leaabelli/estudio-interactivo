import {
  DIFFICULTIES,
  type Difficulty,
  type DifficultyFilter,
  type Population,
  type QuestionProgress,
  type SelectionRequest,
  type StudyQuestion,
  type StudySnapshot
} from "./types";
import { deterministicShuffle, fnv1aUtf8 } from "./rng";

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
  readonly population: Population;

  constructor(
    eligibleCount: number,
    requestedCount: number,
    difficulty: DifficultyFilter,
    population: Population
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

function isEligible(
  snapshot: StudySnapshot,
  question: StudyQuestion,
  difficulty: DifficultyFilter,
  population: Population
): boolean {
  return (
    matchesDifficulty(question, difficulty) &&
    (population === "todas" || attemptsFor(snapshot, question.id) === 0)
  );
}

export function countEligible(
  snapshot: StudySnapshot,
  difficulty: DifficultyFilter,
  population: Population
): number {
  let count = 0;
  for (const question of snapshot.questions) {
    if (isEligible(snapshot, question, difficulty, population)) {
      count += 1;
    }
  }
  return count;
}

function priorityGroup(progress: QuestionProgress | undefined): number {
  if (!progress || progress.attempts === 0) {
    return 0;
  }
  return progress.lastResult === "incorrect" ? 1 : 2;
}

function rankedPool(
  snapshot: StudySnapshot,
  questions: readonly StudyQuestion[],
  population: Population,
  seed: number,
  salt: string
): StudyQuestion[] {
  const byId = [...questions].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
  const shuffled = deterministicShuffle(byId, (seed ^ fnv1aUtf8(salt)) >>> 0);
  const shuffledRank = new Map(shuffled.map((question, index) => [question.id, index]));

  if (population === "nuevas") {
    return shuffled;
  }

  return [...byId].sort((left, right) => {
    const leftProgress = ownProgress(snapshot, left.id);
    const rightProgress = ownProgress(snapshot, right.id);
    const groupDelta = priorityGroup(leftProgress) - priorityGroup(rightProgress);
    if (groupDelta !== 0) {
      return groupDelta;
    }

    const attemptsDelta = (leftProgress?.attempts ?? 0) - (rightProgress?.attempts ?? 0);
    if (attemptsDelta !== 0) {
      return attemptsDelta;
    }

    return (shuffledRank.get(left.id) ?? 0) - (shuffledRank.get(right.id) ?? 0);
  });
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
  return ranked.slice(0, size);
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

  const eligible = snapshot.questions.filter((question) =>
    isEligible(snapshot, question, request.difficulty, request.population)
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
  population: Population
): Record<Difficulty, number> {
  return {
    facil: countEligible(snapshot, "facil", population),
    medio: countEligible(snapshot, "medio", population),
    dificil: countEligible(snapshot, "dificil", population),
    experto: countEligible(snapshot, "experto", population)
  };
}

import {
  DIFFICULTIES,
  MAX_RUN_SIZE,
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

export function countEligibleByTopic(
  snapshot: StudySnapshot,
  difficulty: DifficultyFilter,
  population: SelectionPopulation
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const question of snapshot.questions) {
    if (!counts.has(question.topic)) counts.set(question.topic, 0);
    if (isEligible(snapshot, question, difficulty, population)) {
      counts.set(question.topic, counts.get(question.topic)! + 1);
    }
  }
  return counts;
}

/** Quotas are exact: never silently shorten or redistribute a custom exam. */
export function topicQuotaError(
  request: Pick<SelectionRequest, "requestedSize" | "topicQuotas" | "acceptedSize">,
  available: ReadonlyMap<string, number>
): string | null {
  if (!Number.isInteger(request.requestedSize) || request.requestedSize < 1 || request.requestedSize > MAX_RUN_SIZE) {
    return `Elegí una cantidad entera entre 1 y ${MAX_RUN_SIZE}.`;
  }
  if (!request.topicQuotas) return null;
  if (request.acceptedSize !== undefined && request.acceptedSize !== request.requestedSize) {
    return "La distribución por tema no admite un examen reducido. Ajustá las cantidades.";
  }
  const seen = new Set<string>();
  let total = 0;
  for (const { topic, count } of request.topicQuotas) {
    if (!available.has(topic) || seen.has(topic)) return `Tema desconocido o repetido: ${topic}.`;
    seen.add(topic);
    if (!Number.isInteger(count) || count < 1 || count > MAX_RUN_SIZE) {
      return `La cantidad de «${topic}» debe ser un entero positivo.`;
    }
    if (count > available.get(topic)!) {
      return `«${topic}»: pedís ${count}, pero hay ${available.get(topic)} disponibles con estos filtros.`;
    }
    total += count;
  }
  return total === request.requestedSize
    ? null
    : `Asignaste ${total} de ${request.requestedSize} preguntas. La suma por tema debe coincidir con el total.`;
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
  // Largest remainders keep the 3/3/2/2 mix proportional for every exam size.
  const targets = DIFFICULTIES.map((difficulty) => Math.floor(size * MIXED_TARGETS[difficulty] / 10));
  const remainderOrder = DIFFICULTIES.map((difficulty, index) => ({
    index,
    remainder: (size * MIXED_TARGETS[difficulty]) % 10
  })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = size - targets.reduce((sum, target) => sum + target, 0);
  for (const { index } of remainderOrder.slice(0, remaining)) targets[index]! += 1;

  for (const difficulty of DIFFICULTIES) {
    const questions = eligible.filter((question) => question.difficulty === difficulty);
    const ranked = rankedPool(
      snapshot,
      questions,
      request.population,
      request.seed,
      `selection.${difficulty}`
    );
    const target = Math.min(targets[DIFFICULTIES.indexOf(difficulty)]!, ranked.length);
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
  if (!Number.isInteger(request.requestedSize) || request.requestedSize < 1 || request.requestedSize > MAX_RUN_SIZE) {
    throw new RangeError(`requestedSize must be an integer from 1 through ${MAX_RUN_SIZE}.`);
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
  if (request.topicQuotas) {
    const available = new Map(snapshot.questions.map((question) => [question.topic, 0]));
    for (const question of eligible) available.set(question.topic, available.get(question.topic)! + 1);
    const error = topicQuotaError(request, available);
    if (error) throw new RangeError(error);
  }
  const size = selectedSize(request, eligible.length);

  const selectPool = (pool: readonly StudyQuestion[], count: number, poolRequest = request) =>
    poolRequest.difficulty === "mixta"
      ? mixedSelection(snapshot, poolRequest, pool, count)
      : fixedSelection(snapshot, poolRequest, pool, count);
  const selected = request.topicQuotas
    ? deterministicShuffle(
        [...request.topicQuotas].sort((a, b) => a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0)
          .flatMap(({ topic, count }) => selectPool(
            eligible.filter((question) => question.topic === topic), count,
            { ...request, seed: (request.seed ^ fnv1aUtf8(topic)) >>> 0 }
          )),
        (request.seed ^ fnv1aUtf8("selection.question-order")) >>> 0
      )
    : selectPool(eligible, size);

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

import {
  DIFFICULTIES,
  type CompletedRun,
  type Difficulty,
  type QuestionProgress,
  type StudyAnswer,
  type StudyQuestion,
  type StudySnapshot
} from "./types";
import {
  canonicalUtf8ByteLength,
  type CanonicalJsonValue
} from "./canonical";

export const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_MODULE_BYTES = 6 * 1024 * 1024;
export const MAX_PROGRESS_BYTES = Math.floor(3.5 * 1024 * 1024);
export const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;

const MAX_ERRORS = 200;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult<T = StudySnapshot> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

type UnknownRecord = Record<string, unknown>;

class Errors {
  readonly values: ValidationError[] = [];

  add(path: string, message: string): void {
    if (this.values.length < MAX_ERRORS) {
      this.values.push({ path, message });
    }
  }

  get any(): boolean {
    return this.values.length > 0;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  errors: Errors
): UnknownRecord | null {
  if (!isRecord(value)) {
    errors.add(path, "debe ser un objeto");
    return null;
  }

  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.add(`${path}.${key}`, "la propiedad no está permitida");
    }
  }
  for (const key of required) {
    if (!hasOwn(value, key)) {
      errors.add(`${path}.${key}`, "la propiedad es obligatoria");
    }
  }
  return value;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function stringInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: Errors
): value is string {
  if (typeof value !== "string") {
    errors.add(path, "debe ser texto");
    return false;
  }
  const length = codePointLength(value);
  if (length < min || length > max) {
    errors.add(path, `debe tener entre ${min} y ${max} caracteres Unicode`);
    return false;
  }
  return true;
}

function id(value: unknown, path: string, errors: Errors): value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    errors.add(path, "debe cumplir [a-z0-9][a-z0-9._-]{0,63}");
    return false;
  }
  return true;
}

function integerInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: Errors
): value is number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < min || value > max) {
    errors.add(path, `debe ser un entero entre ${min} y ${max}`);
    return false;
  }
  return true;
}

function counter(value: unknown, path: string, errors: Errors): value is number {
  return integerInRange(value, path, 0, MAX_COUNTER, errors);
}

function positiveRevision(value: unknown, path: string, errors: Errors): value is number {
  return integerInRange(value, path, 1, MAX_COUNTER, errors);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validTimestamp(value: unknown, path: string, errors: Errors): value is string {
  if (typeof value !== "string") {
    errors.add(path, "debe ser una fecha RFC 3339 UTC terminada en Z");
    return false;
  }
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    errors.add(path, "debe ser una fecha RFC 3339 UTC terminada en Z");
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const daysByMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysByMonth[month - 1] ?? 0;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDay ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    errors.add(path, "contiene una fecha u hora imposible");
    return false;
  }
  return true;
}

function timestampMillis(value: string): number {
  return Date.parse(value);
}

function literal(
  value: unknown,
  expected: string | number | null,
  path: string,
  errors: Errors
): boolean {
  if (value !== expected) {
    errors.add(path, `debe ser ${JSON.stringify(expected)}`);
    return false;
  }
  return true;
}

function oneOfStrings(
  value: unknown,
  values: readonly string[],
  path: string,
  errors: Errors
): value is string {
  if (typeof value !== "string" || !values.includes(value)) {
    errors.add(path, `debe ser uno de: ${values.join(", ")}`);
    return false;
  }
  return true;
}

function validateAnswerStructure(
  value: unknown,
  path: string,
  allowNull: boolean,
  errors: Errors
): void {
  if (value === null) {
    if (!allowNull) errors.add(path, "no puede ser null");
    return;
  }
  if (!isRecord(value)) {
    errors.add(path, "debe ser una respuesta etiquetada");
    return;
  }
  if (value.kind === "option") {
    const answer = exactObject(value, path, ["kind", "optionId"], [], errors);
    if (answer) {
      literal(answer.kind, "option", `${path}.kind`, errors);
      id(answer.optionId, `${path}.optionId`, errors);
    }
    return;
  }
  if (value.kind === "dontKnow") {
    const answer = exactObject(value, path, ["kind"], [], errors);
    if (answer) literal(answer.kind, "dontKnow", `${path}.kind`, errors);
    return;
  }
  errors.add(`${path}.kind`, "debe ser option o dontKnow");
}

function validateModuleStructure(value: unknown, path: string, errors: Errors): void {
  const module = exactObject(
    value,
    path,
    ["id", "contentRevision", "title", "subject", "description", "language", "createdAt", "updatedAt"],
    [],
    errors
  );
  if (!module) return;
  id(module.id, `${path}.id`, errors);
  positiveRevision(module.contentRevision, `${path}.contentRevision`, errors);
  stringInRange(module.title, `${path}.title`, 1, 120, errors);
  stringInRange(module.subject, `${path}.subject`, 1, 120, errors);
  stringInRange(module.description, `${path}.description`, 0, 1000, errors);
  if (stringInRange(module.language, `${path}.language`, 2, 35, errors) && !LANGUAGE_PATTERN.test(module.language)) {
    errors.add(`${path}.language`, "debe ser una etiqueta BCP-47 ASCII válida");
  }
  validTimestamp(module.createdAt, `${path}.createdAt`, errors);
  validTimestamp(module.updatedAt, `${path}.updatedAt`, errors);
}

function validateQuestionStructure(value: unknown, path: string, errors: Errors): void {
  const question = exactObject(
    value,
    path,
    ["id", "revision", "difficulty", "topic", "prompt", "options", "correctOptionId", "explanation"],
    ["source"],
    errors
  );
  if (!question) return;
  id(question.id, `${path}.id`, errors);
  positiveRevision(question.revision, `${path}.revision`, errors);
  oneOfStrings(question.difficulty, DIFFICULTIES, `${path}.difficulty`, errors);
  stringInRange(question.topic, `${path}.topic`, 1, 120, errors);
  stringInRange(question.prompt, `${path}.prompt`, 1, 5000, errors);
  id(question.correctOptionId, `${path}.correctOptionId`, errors);
  stringInRange(question.explanation, `${path}.explanation`, 1, 5000, errors);

  if (!Array.isArray(question.options)) {
    errors.add(`${path}.options`, "debe ser una lista de 2 a 8 opciones");
  } else {
    if (question.options.length < 2 || question.options.length > 8) {
      errors.add(`${path}.options`, "debe contener entre 2 y 8 opciones");
    }
    question.options.forEach((entry, index) => {
      const optionPath = `${path}.options[${index}]`;
      const option = exactObject(entry, optionPath, ["id", "text"], [], errors);
      if (!option) return;
      id(option.id, `${optionPath}.id`, errors);
      stringInRange(option.text, `${optionPath}.text`, 1, 2000, errors);
    });
  }

  if (hasOwn(question, "source")) {
    const source = exactObject(question.source, `${path}.source`, ["label"], ["reference"], errors);
    if (source) {
      stringInRange(source.label, `${path}.source.label`, 1, 300, errors);
      if (hasOwn(source, "reference")) {
        stringInRange(source.reference, `${path}.source.reference`, 1, 500, errors);
      }
    }
  }
}

function validateQuestionProgressStructure(value: unknown, path: string, errors: Errors): void {
  const progress = exactObject(
    value,
    path,
    [
      "questionRevision",
      "attempts",
      "correct",
      "lastResult",
      "lastAnswer",
      "lastSubmittedAt",
      "lastCompletedStateRevision"
    ],
    [],
    errors
  );
  if (!progress) return;
  positiveRevision(progress.questionRevision, `${path}.questionRevision`, errors);
  counter(progress.attempts, `${path}.attempts`, errors);
  counter(progress.correct, `${path}.correct`, errors);
  if (progress.lastResult !== null) {
    oneOfStrings(progress.lastResult, ["correct", "incorrect"], `${path}.lastResult`, errors);
  }
  validateAnswerStructure(progress.lastAnswer, `${path}.lastAnswer`, true, errors);
  if (progress.lastSubmittedAt !== null) {
    validTimestamp(progress.lastSubmittedAt, `${path}.lastSubmittedAt`, errors);
  }
  if (progress.lastCompletedStateRevision !== null) {
    positiveRevision(progress.lastCompletedStateRevision, `${path}.lastCompletedStateRevision`, errors);
  }
}

function validateFiltersStructure(value: unknown, path: string, errors: Errors): void {
  const filters = exactObject(value, path, ["difficulty", "population", "requestedSize", "acceptedSize"], [], errors);
  if (!filters) return;
  oneOfStrings(filters.difficulty, [...DIFFICULTIES, "mixta"], `${path}.difficulty`, errors);
  oneOfStrings(filters.population, ["nuevas", "todas"], `${path}.population`, errors);
  literal(filters.requestedSize, 10, `${path}.requestedSize`, errors);
  integerInRange(filters.acceptedSize, `${path}.acceptedSize`, 1, 10, errors);
}

function validateRunItemStructure(value: unknown, path: string, errors: Errors): void {
  const item = exactObject(value, path, ["questionId", "questionRevision", "optionOrder", "answer"], [], errors);
  if (!item) return;
  id(item.questionId, `${path}.questionId`, errors);
  positiveRevision(item.questionRevision, `${path}.questionRevision`, errors);
  if (!Array.isArray(item.optionOrder)) {
    errors.add(`${path}.optionOrder`, "debe ser una lista de IDs de opción");
  } else {
    if (item.optionOrder.length < 2 || item.optionOrder.length > 8) {
      errors.add(`${path}.optionOrder`, "debe contener entre 2 y 8 IDs");
    }
    item.optionOrder.forEach((optionId, index) => id(optionId, `${path}.optionOrder[${index}]`, errors));
  }
  validateAnswerStructure(item.answer, `${path}.answer`, true, errors);
}

const ACTIVE_RUN_KEYS = [
  "id",
  "createdStateRevision",
  "completedStateRevision",
  "startedAt",
  "seed",
  "filters",
  "coverageBeforeCount",
  "items",
  "status",
  "submittedAt",
  "currentIndex"
] as const;

const COMPLETED_RUN_KEYS = [
  "id",
  "createdStateRevision",
  "completedStateRevision",
  "startedAt",
  "seed",
  "filters",
  "coverageBeforeCount",
  "items",
  "status",
  "submittedAt",
  "correctCount",
  "incorrectCount",
  "coverageAfterCount"
] as const;

function validateRunCommonStructure(run: UnknownRecord, path: string, errors: Errors): void {
  id(run.id, `${path}.id`, errors);
  positiveRevision(run.createdStateRevision, `${path}.createdStateRevision`, errors);
  validTimestamp(run.startedAt, `${path}.startedAt`, errors);
  integerInRange(run.seed, `${path}.seed`, 0, 0xffffffff, errors);
  validateFiltersStructure(run.filters, `${path}.filters`, errors);
  integerInRange(run.coverageBeforeCount, `${path}.coverageBeforeCount`, 0, 5000, errors);
  if (!Array.isArray(run.items)) {
    errors.add(`${path}.items`, "debe ser una lista de 1 a 10 preguntas");
  } else {
    if (run.items.length < 1 || run.items.length > 10) {
      errors.add(`${path}.items`, "debe contener entre 1 y 10 preguntas");
    }
    run.items.forEach((item, index) => validateRunItemStructure(item, `${path}.items[${index}]`, errors));
  }
}

function validateActiveRunStructure(value: unknown, path: string, errors: Errors): void {
  const run = exactObject(value, path, ACTIVE_RUN_KEYS, [], errors);
  if (!run) return;
  validateRunCommonStructure(run, path, errors);
  literal(run.completedStateRevision, null, `${path}.completedStateRevision`, errors);
  literal(run.status, "active", `${path}.status`, errors);
  literal(run.submittedAt, null, `${path}.submittedAt`, errors);
  integerInRange(run.currentIndex, `${path}.currentIndex`, 0, 9, errors);
}

function validateCompletedRunStructure(value: unknown, path: string, errors: Errors): void {
  const run = exactObject(value, path, COMPLETED_RUN_KEYS, [], errors);
  if (!run) return;
  validateRunCommonStructure(run, path, errors);
  positiveRevision(run.completedStateRevision, `${path}.completedStateRevision`, errors);
  literal(run.status, "completed", `${path}.status`, errors);
  validTimestamp(run.submittedAt, `${path}.submittedAt`, errors);
  integerInRange(run.correctCount, `${path}.correctCount`, 0, 10, errors);
  integerInRange(run.incorrectCount, `${path}.incorrectCount`, 0, 10, errors);
  integerInRange(run.coverageAfterCount, `${path}.coverageAfterCount`, 0, 5000, errors);
}

function validateDifficultySummaryStructure(value: unknown, path: string, errors: Errors): void {
  const summary = exactObject(value, path, ["attempts", "correct"], [], errors);
  if (!summary) return;
  counter(summary.attempts, `${path}.attempts`, errors);
  counter(summary.correct, `${path}.correct`, errors);
}

function validatePriorSummaryStructure(value: unknown, path: string, errors: Errors): void {
  const summary = exactObject(
    value,
    path,
    ["runCount", "attemptCount", "correctCount", "firstSubmittedAt", "lastSubmittedAt", "byDifficulty"],
    [],
    errors
  );
  if (!summary) return;
  counter(summary.runCount, `${path}.runCount`, errors);
  counter(summary.attemptCount, `${path}.attemptCount`, errors);
  counter(summary.correctCount, `${path}.correctCount`, errors);
  if (summary.firstSubmittedAt !== null) validTimestamp(summary.firstSubmittedAt, `${path}.firstSubmittedAt`, errors);
  if (summary.lastSubmittedAt !== null) validTimestamp(summary.lastSubmittedAt, `${path}.lastSubmittedAt`, errors);
  const byDifficulty = exactObject(summary.byDifficulty, `${path}.byDifficulty`, DIFFICULTIES, [], errors);
  if (byDifficulty) {
    for (const difficulty of DIFFICULTIES) {
      validateDifficultySummaryStructure(byDifficulty[difficulty], `${path}.byDifficulty.${difficulty}`, errors);
    }
  }
}

function validateProgressStructure(value: unknown, path: string, errors: Errors): void {
  const progress = exactObject(
    value,
    path,
    ["updatedAt", "stateRevision", "questions", "runs", "priorRunSummary", "activeRun"],
    [],
    errors
  );
  if (!progress) return;
  validTimestamp(progress.updatedAt, `${path}.updatedAt`, errors);
  counter(progress.stateRevision, `${path}.stateRevision`, errors);
  if (!isRecord(progress.questions)) {
    errors.add(`${path}.questions`, "debe ser un objeto indexado por ID de pregunta");
  } else {
    for (const [questionId, questionProgress] of Object.entries(progress.questions)) {
      const questionPath = `${path}.questions[${JSON.stringify(questionId)}]`;
      id(questionId, questionPath, errors);
      validateQuestionProgressStructure(questionProgress, questionPath, errors);
    }
  }
  if (!Array.isArray(progress.runs)) {
    errors.add(`${path}.runs`, "debe ser una lista de ejecuciones completadas");
  } else {
    if (progress.runs.length > 500) errors.add(`${path}.runs`, "no puede superar 500 ejecuciones detalladas");
    progress.runs.forEach((run, index) => validateCompletedRunStructure(run, `${path}.runs[${index}]`, errors));
  }
  validatePriorSummaryStructure(progress.priorRunSummary, `${path}.priorRunSummary`, errors);
  if (progress.activeRun !== null) {
    validateActiveRunStructure(progress.activeRun, `${path}.activeRun`, errors);
  }
}

function validateStructure(value: unknown, errors: Errors): value is StudySnapshot {
  const snapshot = exactObject(value, "$", ["schemaVersion", "module", "questions", "progress"], [], errors);
  if (!snapshot) return false;
  literal(snapshot.schemaVersion, 1, "$.schemaVersion", errors);
  validateModuleStructure(snapshot.module, "$.module", errors);
  if (!Array.isArray(snapshot.questions)) {
    errors.add("$.questions", "debe ser una lista de 1 a 5000 preguntas");
  } else {
    if (snapshot.questions.length < 1 || snapshot.questions.length > 5000) {
      errors.add("$.questions", "debe contener entre 1 y 5000 preguntas");
    }
    snapshot.questions.forEach((question, index) => validateQuestionStructure(question, `$.questions[${index}]`, errors));
  }
  validateProgressStructure(snapshot.progress, "$.progress", errors);
  return !errors.any;
}

function sameAnswer(left: StudyAnswer, right: StudyAnswer): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "dontKnow" || (right.kind === "option" && left.optionId === right.optionId);
}

function answerIsCorrect(answer: StudyAnswer, question: StudyQuestion): boolean {
  return answer.kind === "option" && answer.optionId === question.correctOptionId;
}

function expectedRunId(createdStateRevision: number, seed: number): string {
  return `run.${createdStateRevision}.${seed.toString(16).padStart(8, "0")}`;
}

interface RetainedOccurrence {
  run: CompletedRun;
  answer: StudyAnswer;
  correct: boolean;
}

function validateQuestionSemantics(
  snapshot: StudySnapshot,
  questionById: Map<string, StudyQuestion>,
  occurrences: Map<string, RetainedOccurrence[]>,
  errors: Errors
): void {
  const { progress } = snapshot;
  const firstRetainedRevision = progress.runs[0]?.completedStateRevision ?? null;

  for (const [questionId, questionProgress] of Object.entries(progress.questions)) {
    const path = `$.progress.questions[${JSON.stringify(questionId)}]`;
    const question = questionById.get(questionId);
    if (!question) {
      errors.add(path, "el ID no existe en $.questions");
      continue;
    }
    if (questionProgress.questionRevision !== question.revision) {
      errors.add(`${path}.questionRevision`, "debe coincidir con la revisión actual de la pregunta");
    }
    if (questionProgress.correct > questionProgress.attempts) {
      errors.add(`${path}.correct`, "no puede superar attempts");
    }

    const lastFields = [
      questionProgress.lastResult,
      questionProgress.lastAnswer,
      questionProgress.lastSubmittedAt,
      questionProgress.lastCompletedStateRevision
    ];
    if (questionProgress.attempts === 0) {
      if (lastFields.some((value) => value !== null)) {
        errors.add(path, "con cero intentos, todos los campos last* deben ser null");
      }
      continue;
    }

    if (lastFields.some((value) => value === null)) {
      errors.add(path, "con intentos, todos los campos last* deben tener evidencia");
      continue;
    }

    const lastAnswer = questionProgress.lastAnswer as StudyAnswer;
    if (lastAnswer.kind === "option" && !question.options.some((option) => option.id === lastAnswer.optionId)) {
      errors.add(`${path}.lastAnswer.optionId`, "no referencia una opción de la pregunta");
    }
    const expectedResult = answerIsCorrect(lastAnswer, question) ? "correct" : "incorrect";
    if (questionProgress.lastResult !== expectedResult) {
      errors.add(`${path}.lastResult`, `debe ser ${expectedResult} según lastAnswer`);
    }
    if ((questionProgress.lastCompletedStateRevision as number) > progress.stateRevision) {
      errors.add(`${path}.lastCompletedStateRevision`, "no puede superar stateRevision");
    }

    const retained = occurrences.get(questionId) ?? [];
    const latest = retained.at(-1);
    if (latest) {
      if (questionProgress.lastCompletedStateRevision !== latest.run.completedStateRevision) {
        errors.add(`${path}.lastCompletedStateRevision`, "debe señalar la última ejecución detallada que respondió esta pregunta");
      }
      if (!sameAnswer(lastAnswer, latest.answer)) {
        errors.add(`${path}.lastAnswer`, "no coincide con la evidencia de la última ejecución detallada");
      }
      if (questionProgress.lastSubmittedAt !== latest.run.submittedAt) {
        errors.add(`${path}.lastSubmittedAt`, "no coincide con la evidencia de la última ejecución detallada");
      }
    } else if (
      progress.priorRunSummary.runCount === 0 ||
      (firstRetainedRevision !== null &&
        (questionProgress.lastCompletedStateRevision as number) >= firstRetainedRevision)
    ) {
      errors.add(`${path}.lastCompletedStateRevision`, "no tiene evidencia terminal en el resumen compactado ni en ejecuciones detalladas");
    }
  }
}

function validateRunSemantics(
  snapshot: StudySnapshot,
  questionById: Map<string, StudyQuestion>,
  errors: Errors
): Map<string, RetainedOccurrence[]> {
  const { progress } = snapshot;
  const runIds = new Set<string>();
  const occurrences = new Map<string, RetainedOccurrence[]>();
  let previousCompletedRevision = 0;
  let previousCoverageAfter: number | null = null;
  const seenInDetailed = new Set<string>();

  const registerId = (runId: string, path: string): void => {
    if (runIds.has(runId)) errors.add(path, "el ID de ejecución está duplicado");
    runIds.add(runId);
  };

  for (let runIndex = 0; runIndex < progress.runs.length; runIndex += 1) {
    const run = progress.runs[runIndex] as CompletedRun;
    const path = `$.progress.runs[${runIndex}]`;
    registerId(run.id, `${path}.id`);
    const expectedId = expectedRunId(run.createdStateRevision, run.seed);
    if (run.id !== expectedId) errors.add(`${path}.id`, `debe ser ${expectedId}`);
    if (run.createdStateRevision >= run.completedStateRevision) {
      errors.add(`${path}.completedStateRevision`, "debe ser mayor que createdStateRevision");
    }
    if (run.completedStateRevision <= previousCompletedRevision) {
      errors.add(`${path}.completedStateRevision`, "debe estar estrictamente ordenada en forma ascendente");
    }
    if (runIndex > 0 && run.createdStateRevision <= previousCompletedRevision) {
      errors.add(`${path}.createdStateRevision`, "debe ser posterior a la ejecución completada anterior");
    }
    if (run.completedStateRevision > progress.stateRevision) {
      errors.add(`${path}.completedStateRevision`, "no puede superar stateRevision");
    }
    previousCompletedRevision = run.completedStateRevision;

    if (run.id.length > 64 || !ID_PATTERN.test(run.id)) {
      errors.add(`${path}.id`, "el ID derivado excede el formato permitido");
    }
    if (run.filters.acceptedSize !== run.items.length) {
      errors.add(`${path}.filters.acceptedSize`, "debe coincidir con items.length");
    }
    if (run.coverageBeforeCount > snapshot.questions.length) {
      errors.add(`${path}.coverageBeforeCount`, "no puede superar la cantidad de preguntas");
    }
    if (run.coverageAfterCount > snapshot.questions.length) {
      errors.add(`${path}.coverageAfterCount`, "no puede superar la cantidad de preguntas");
    }
    if (run.coverageAfterCount < run.coverageBeforeCount) {
      errors.add(`${path}.coverageAfterCount`, "no puede ser menor que coverageBeforeCount");
    }
    if (run.coverageAfterCount - run.coverageBeforeCount > run.items.length) {
      errors.add(`${path}.coverageAfterCount`, "la cobertura no puede crecer más que la cantidad de preguntas de la ejecución");
    }
    if (previousCoverageAfter !== null && run.coverageBeforeCount !== previousCoverageAfter) {
      errors.add(`${path}.coverageBeforeCount`, "debe coincidir con coverageAfterCount de la ejecución anterior");
    }
    if (runIndex === 0 && progress.priorRunSummary.runCount === 0 && run.coverageBeforeCount !== 0) {
      errors.add(`${path}.coverageBeforeCount`, "la primera ejecución sin resumen previo debe comenzar con cobertura cero");
    }

    const runQuestionIds = new Set<string>();
    let computedCorrect = 0;
    let maxCoverageGain = 0;
    for (let itemIndex = 0; itemIndex < run.items.length; itemIndex += 1) {
      const item = run.items[itemIndex]!;
      const itemPath = `${path}.items[${itemIndex}]`;
      if (runQuestionIds.has(item.questionId)) {
        errors.add(`${itemPath}.questionId`, "la pregunta está repetida dentro de la ejecución");
      }
      runQuestionIds.add(item.questionId);
      const question = questionById.get(item.questionId);
      if (!question) {
        errors.add(`${itemPath}.questionId`, "no referencia una pregunta del módulo");
        continue;
      }
      if (!seenInDetailed.has(item.questionId)) maxCoverageGain += 1;
      if (item.questionRevision !== question.revision) {
        errors.add(`${itemPath}.questionRevision`, "debe coincidir con la revisión actual de la pregunta");
      }
      if (run.filters.difficulty !== "mixta" && question.difficulty !== run.filters.difficulty) {
        errors.add(`${itemPath}.questionId`, "no coincide con el filtro de dificultad de la ejecución");
      }
      const expectedOptions = new Set(question.options.map((option) => option.id));
      const actualOptions = new Set(item.optionOrder);
      if (actualOptions.size !== item.optionOrder.length) {
        errors.add(`${itemPath}.optionOrder`, "no puede contener IDs duplicados");
      }
      if (
        actualOptions.size !== expectedOptions.size ||
        [...expectedOptions].some((optionId) => !actualOptions.has(optionId))
      ) {
        errors.add(`${itemPath}.optionOrder`, "debe listar exactamente todas las opciones de la pregunta");
      }
      if (item.answer === null) {
        errors.add(`${itemPath}.answer`, "una ejecución completada no puede contener respuestas null");
        continue;
      }
      if (item.answer.kind === "option" && !expectedOptions.has(item.answer.optionId)) {
        errors.add(`${itemPath}.answer.optionId`, "no referencia una opción de la pregunta");
      }
      const correct = answerIsCorrect(item.answer, question);
      if (correct) computedCorrect += 1;
      const list = occurrences.get(item.questionId) ?? [];
      list.push({ run, answer: item.answer, correct });
      occurrences.set(item.questionId, list);
    }
    if (run.coverageAfterCount - run.coverageBeforeCount > maxCoverageGain) {
      errors.add(`${path}.coverageAfterCount`, "el aumento excede las preguntas que podían ser nuevas en el historial detallado");
    }
    for (const questionId of runQuestionIds) seenInDetailed.add(questionId);
    if (run.correctCount !== computedCorrect) {
      errors.add(`${path}.correctCount`, `debe ser ${computedCorrect} según las respuestas`);
    }
    if (run.incorrectCount !== run.items.length - computedCorrect) {
      errors.add(`${path}.incorrectCount`, `debe ser ${run.items.length - computedCorrect} según las respuestas`);
    }
    if (run.correctCount + run.incorrectCount !== run.items.length) {
      errors.add(path, "correctCount + incorrectCount debe coincidir con items.length");
    }
    if (timestampMillis(run.submittedAt) < timestampMillis(run.startedAt)) {
      errors.add(`${path}.submittedAt`, "no puede ser anterior a startedAt");
    }
    previousCoverageAfter = run.coverageAfterCount;
  }

  const active = progress.activeRun;
  if (active) {
    const path = "$.progress.activeRun";
    registerId(active.id, `${path}.id`);
    const expectedId = expectedRunId(active.createdStateRevision, active.seed);
    if (active.id !== expectedId) errors.add(`${path}.id`, `debe ser ${expectedId}`);
    if (active.createdStateRevision > progress.stateRevision) {
      errors.add(`${path}.createdStateRevision`, "no puede superar stateRevision");
    }
    if (active.createdStateRevision <= previousCompletedRevision) {
      errors.add(`${path}.createdStateRevision`, "debe ser posterior a la última ejecución completada");
    }
    if (active.filters.acceptedSize !== active.items.length) {
      errors.add(`${path}.filters.acceptedSize`, "debe coincidir con items.length");
    }
    if (active.currentIndex >= active.items.length) {
      errors.add(`${path}.currentIndex`, "debe señalar un elemento existente");
    }
    const runQuestionIds = new Set<string>();
    for (let itemIndex = 0; itemIndex < active.items.length; itemIndex += 1) {
      const item = active.items[itemIndex]!;
      const itemPath = `${path}.items[${itemIndex}]`;
      if (runQuestionIds.has(item.questionId)) {
        errors.add(`${itemPath}.questionId`, "la pregunta está repetida dentro de la ejecución");
      }
      runQuestionIds.add(item.questionId);
      const question = questionById.get(item.questionId);
      if (!question) {
        errors.add(`${itemPath}.questionId`, "no referencia una pregunta del módulo");
        continue;
      }
      if (item.questionRevision !== question.revision) {
        errors.add(`${itemPath}.questionRevision`, "debe coincidir con la revisión actual de la pregunta");
      }
      if (active.filters.difficulty !== "mixta" && question.difficulty !== active.filters.difficulty) {
        errors.add(`${itemPath}.questionId`, "no coincide con el filtro de dificultad de la ejecución");
      }
      const expectedOptions = new Set(question.options.map((option) => option.id));
      const actualOptions = new Set(item.optionOrder);
      if (
        actualOptions.size !== item.optionOrder.length ||
        actualOptions.size !== expectedOptions.size ||
        [...expectedOptions].some((optionId) => !actualOptions.has(optionId))
      ) {
        errors.add(`${itemPath}.optionOrder`, "debe listar exactamente todas las opciones, sin duplicados");
      }
      if (item.answer?.kind === "option" && !expectedOptions.has(item.answer.optionId)) {
        errors.add(`${itemPath}.answer.optionId`, "no referencia una opción de la pregunta");
      }
    }
    const evaluated = Object.values(progress.questions).filter((question) => question.attempts > 0).length;
    if (active.coverageBeforeCount !== evaluated) {
      errors.add(`${path}.coverageBeforeCount`, "debe coincidir con la cobertura evaluada actual");
    }
  }

  return occurrences;
}

function validateSummarySemantics(snapshot: StudySnapshot, errors: Errors): void {
  const summary = snapshot.progress.priorRunSummary;
  const path = "$.progress.priorRunSummary";
  if (summary.correctCount > summary.attemptCount) {
    errors.add(`${path}.correctCount`, "no puede superar attemptCount");
  }
  let byDifficultyAttempts = 0;
  let byDifficultyCorrect = 0;
  for (const difficulty of DIFFICULTIES) {
    const difficultySummary = summary.byDifficulty[difficulty];
    if (difficultySummary.correct > difficultySummary.attempts) {
      errors.add(`${path}.byDifficulty.${difficulty}.correct`, "no puede superar attempts");
    }
    byDifficultyAttempts += difficultySummary.attempts;
    byDifficultyCorrect += difficultySummary.correct;
  }
  if (byDifficultyAttempts !== summary.attemptCount) {
    errors.add(`${path}.attemptCount`, "debe coincidir con la suma de byDifficulty.attempts");
  }
  if (byDifficultyCorrect !== summary.correctCount) {
    errors.add(`${path}.correctCount`, "debe coincidir con la suma de byDifficulty.correct");
  }

  if (summary.runCount === 0) {
    if (
      summary.attemptCount !== 0 ||
      summary.correctCount !== 0 ||
      summary.firstSubmittedAt !== null ||
      summary.lastSubmittedAt !== null
    ) {
      errors.add(path, "un resumen sin ejecuciones debe tener conteos cero y fechas null");
    }
  } else {
    if (summary.firstSubmittedAt === null || summary.lastSubmittedAt === null) {
      errors.add(path, "un resumen con ejecuciones requiere firstSubmittedAt y lastSubmittedAt");
    } else if (timestampMillis(summary.firstSubmittedAt) > timestampMillis(summary.lastSubmittedAt)) {
      errors.add(`${path}.lastSubmittedAt`, "no puede ser anterior a firstSubmittedAt");
    }
    if (summary.attemptCount < summary.runCount || summary.attemptCount > summary.runCount * 10) {
      errors.add(`${path}.attemptCount`, "debe representar entre 1 y 10 intentos por ejecución compactada");
    }
  }
}

function validateAggregateReconciliation(
  snapshot: StudySnapshot,
  questionById: Map<string, StudyQuestion>,
  occurrences: Map<string, RetainedOccurrence[]>,
  errors: Errors
): void {
  const progressAttempts: Record<Difficulty, number> = { facil: 0, medio: 0, dificil: 0, experto: 0 };
  const progressCorrect: Record<Difficulty, number> = { facil: 0, medio: 0, dificil: 0, experto: 0 };
  let totalProgressAttempts = 0;
  let totalProgressCorrect = 0;

  for (const question of snapshot.questions) {
    const questionProgress: QuestionProgress | undefined = hasOwn(snapshot.progress.questions, question.id)
      ? snapshot.progress.questions[question.id]
      : undefined;
    const attempts = questionProgress?.attempts ?? 0;
    const correct = questionProgress?.correct ?? 0;
    totalProgressAttempts += attempts;
    totalProgressCorrect += correct;
    progressAttempts[question.difficulty] += attempts;
    progressCorrect[question.difficulty] += correct;

    const retained = occurrences.get(question.id) ?? [];
    const retainedAttempts = retained.length;
    const retainedCorrect = retained.filter((entry) => entry.correct).length;
    if (attempts < retainedAttempts) {
      errors.add(`$.progress.questions[${JSON.stringify(question.id)}].attempts`, "no puede ser menor que sus intentos detallados");
    }
    if (correct < retainedCorrect) {
      errors.add(`$.progress.questions[${JSON.stringify(question.id)}].correct`, "no puede ser menor que sus aciertos detallados");
    }
    if (correct - retainedCorrect > attempts - retainedAttempts) {
      errors.add(`$.progress.questions[${JSON.stringify(question.id)}].correct`, "los aciertos compactados exceden los intentos compactados de la pregunta");
    }
    if (snapshot.progress.priorRunSummary.runCount === 0 && (attempts !== retainedAttempts || correct !== retainedCorrect)) {
      errors.add(`$.progress.questions[${JSON.stringify(question.id)}]`, "sin historial compactado, debe coincidir exactamente con las ejecuciones detalladas");
    }
  }

  let detailedAttempts = 0;
  let detailedCorrect = 0;
  const detailedAttemptsByDifficulty: Record<Difficulty, number> = { facil: 0, medio: 0, dificil: 0, experto: 0 };
  const detailedCorrectByDifficulty: Record<Difficulty, number> = { facil: 0, medio: 0, dificil: 0, experto: 0 };
  for (const [questionId, retained] of occurrences) {
    const question = questionById.get(questionId);
    if (!question) continue;
    detailedAttempts += retained.length;
    detailedCorrect += retained.filter((entry) => entry.correct).length;
    detailedAttemptsByDifficulty[question.difficulty] += retained.length;
    detailedCorrectByDifficulty[question.difficulty] += retained.filter((entry) => entry.correct).length;
  }

  const summary = snapshot.progress.priorRunSummary;
  if (totalProgressAttempts !== summary.attemptCount + detailedAttempts) {
    errors.add("$.progress.questions", "la suma de attempts no coincide con resumen + ejecuciones detalladas");
  }
  if (totalProgressCorrect !== summary.correctCount + detailedCorrect) {
    errors.add("$.progress.questions", "la suma de correct no coincide con resumen + ejecuciones detalladas");
  }
  for (const difficulty of DIFFICULTIES) {
    if (progressAttempts[difficulty] !== summary.byDifficulty[difficulty].attempts + detailedAttemptsByDifficulty[difficulty]) {
      errors.add(
        `$.progress.priorRunSummary.byDifficulty.${difficulty}.attempts`,
        "no reconcilia con el progreso y las ejecuciones detalladas de esta dificultad"
      );
    }
    if (progressCorrect[difficulty] !== summary.byDifficulty[difficulty].correct + detailedCorrectByDifficulty[difficulty]) {
      errors.add(
        `$.progress.priorRunSummary.byDifficulty.${difficulty}.correct`,
        "no reconcilia con el progreso y las ejecuciones detalladas de esta dificultad"
      );
    }
  }

  const evaluated = Object.values(snapshot.progress.questions).filter((entry) => entry.attempts > 0).length;
  const latestRun = snapshot.progress.runs.at(-1);
  if (latestRun && latestRun.coverageAfterCount !== evaluated) {
    errors.add("$.progress.runs", "coverageAfterCount de la última ejecución debe coincidir con la cobertura actual");
  }
}

function validateSemantics(snapshot: StudySnapshot, errors: Errors): void {
  const questionById = new Map<string, StudyQuestion>();
  for (let index = 0; index < snapshot.questions.length; index += 1) {
    const question = snapshot.questions[index]!;
    const path = `$.questions[${index}]`;
    if (questionById.has(question.id)) {
      errors.add(`${path}.id`, "el ID de pregunta está duplicado");
    } else {
      questionById.set(question.id, question);
    }
    const optionIds = new Set<string>();
    for (let optionIndex = 0; optionIndex < question.options.length; optionIndex += 1) {
      const optionId = question.options[optionIndex]!.id;
      if (optionIds.has(optionId)) {
        errors.add(`${path}.options[${optionIndex}].id`, "el ID de opción está duplicado dentro de la pregunta");
      }
      optionIds.add(optionId);
    }
    if (!optionIds.has(question.correctOptionId)) {
      errors.add(`${path}.correctOptionId`, "no referencia una opción de esta pregunta");
    }
  }

  if (timestampMillis(snapshot.module.updatedAt) < timestampMillis(snapshot.module.createdAt)) {
    errors.add("$.module.updatedAt", "no puede ser anterior a createdAt");
  }

  validateSummarySemantics(snapshot, errors);
  const occurrences = validateRunSemantics(snapshot, questionById, errors);
  validateQuestionSemantics(snapshot, questionById, occurrences, errors);
  validateAggregateReconciliation(snapshot, questionById, occurrences, errors);

  if (snapshot.progress.stateRevision === 0) {
    const initialSummary = snapshot.progress.priorRunSummary;
    if (
      Object.keys(snapshot.progress.questions).length !== 0 ||
      snapshot.progress.runs.length !== 0 ||
      snapshot.progress.activeRun !== null ||
      initialSummary.runCount !== 0 ||
      initialSummary.attemptCount !== 0 ||
      initialSummary.correctCount !== 0
    ) {
      errors.add("$.progress", "stateRevision 0 requiere progreso inicial vacío");
    }
  }

  try {
    const moduleBytes = canonicalUtf8ByteLength({
      module: snapshot.module,
      questions: snapshot.questions
    } as unknown as CanonicalJsonValue);
    if (moduleBytes > MAX_MODULE_BYTES) {
      errors.add("$.questions", `la definición del módulo supera ${MAX_MODULE_BYTES} bytes UTF-8 canónicos`);
    }
    const progressBytes = canonicalUtf8ByteLength(snapshot.progress as unknown as CanonicalJsonValue);
    if (progressBytes > MAX_PROGRESS_BYTES) {
      errors.add("$.progress", `el estado mutable supera ${MAX_PROGRESS_BYTES} bytes UTF-8 canónicos`);
    }
    const snapshotBytes = canonicalUtf8ByteLength(snapshot as unknown as CanonicalJsonValue);
    if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
      errors.add("$", `el snapshot supera ${MAX_SNAPSHOT_BYTES} bytes UTF-8 canónicos`);
    }
  } catch (error) {
    errors.add("$", error instanceof Error ? error.message : "no se pudo canonicalizar el JSON");
  }
}

export function validateSnapshot(value: unknown): ValidationResult {
  const errors = new Errors();
  if (!validateStructure(value, errors)) {
    return { ok: false, errors: errors.values };
  }
  validateSemantics(value, errors);
  return errors.any ? { ok: false, errors: errors.values } : { ok: true, value };
}

function sourceToText(source: string | Uint8Array | ArrayBuffer): ValidationResult<string> {
  let bytes: Uint8Array;
  if (typeof source === "string") {
    bytes = new TextEncoder().encode(source);
    if (bytes.byteLength > MAX_SOURCE_FILE_BYTES) {
      return { ok: false, errors: [{ path: "$", message: `el archivo supera ${MAX_SOURCE_FILE_BYTES} bytes` }] };
    }
    return { ok: true, value: source.startsWith("\uFEFF") ? source.slice(1) : source };
  }

  bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.byteLength > MAX_SOURCE_FILE_BYTES) {
    return { ok: false, errors: [{ path: "$", message: `el archivo supera ${MAX_SOURCE_FILE_BYTES} bytes` }] };
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { ok: true, value: decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded };
  } catch {
    return { ok: false, errors: [{ path: "$", message: "el archivo no contiene UTF-8 válido" }] };
  }
}

export function parseSnapshotText(source: string | Uint8Array | ArrayBuffer): ValidationResult {
  const decoded = sourceToText(source);
  if (!decoded.ok) return decoded;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.value) as unknown;
  } catch (error) {
    const detail = error instanceof SyntaxError ? error.message : "JSON inválido";
    return { ok: false, errors: [{ path: "$", message: `no se pudo interpretar el JSON: ${detail}` }] };
  }
  return validateSnapshot(parsed);
}


import {
  DIFFICULTIES,
  emptyPriorRunSummary,
  type Difficulty,
  type QuestionProgress,
  type StudyQuestion,
  type StudySnapshot
} from "../../src/domain/types";

export function makeQuestion(id: string, difficulty: Difficulty = "facil"): StudyQuestion {
  return {
    id,
    revision: 1,
    difficulty,
    topic: `Tema ${difficulty}`,
    prompt: `Pregunta ${id}`,
    options: [
      { id: "a", text: "Correcta" },
      { id: "b", text: "Incorrecta" },
      { id: "c", text: "Distractor" }
    ],
    correctOptionId: "a",
    explanation: `Explicación ${id}`
  };
}

export function makeQuestions(perDifficulty = 12): StudyQuestion[] {
  return DIFFICULTIES.flatMap((difficulty) =>
    Array.from({ length: perDifficulty }, (_, index) =>
      makeQuestion(`${difficulty}.${String(index + 1).padStart(2, "0")}`, difficulty)
    )
  );
}

export function makeSnapshot(questions: StudyQuestion[] = makeQuestions()): StudySnapshot {
  return {
    schemaVersion: 1,
    module: {
      id: "test.module",
      contentRevision: 1,
      title: "Módulo de prueba",
      subject: "Pruebas",
      description: "Fixture unitario",
      language: "es-AR",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    questions,
    progress: {
      updatedAt: "2026-01-01T00:00:00.000Z",
      stateRevision: 0,
      questions: {},
      runs: [],
      priorRunSummary: emptyPriorRunSummary(),
      activeRun: null
    }
  };
}

export function progress(overrides: Partial<QuestionProgress> = {}): QuestionProgress {
  return {
    questionRevision: 1,
    attempts: 1,
    correct: 0,
    lastResult: "incorrect",
    lastAnswer: { kind: "option", optionId: "b" },
    lastSubmittedAt: "2026-01-02T00:00:00.000Z",
    lastCompletedStateRevision: 1,
    ...overrides
  };
}

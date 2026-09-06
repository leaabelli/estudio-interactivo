import { emptyPriorRunSummary, type StudySnapshot } from "../../src/domain/types";

const NOW = "2026-09-06T12:00:00Z";

export function initialSnapshot(): StudySnapshot {
  return {
    schemaVersion: 1,
    module: {
      id: "modulo.prueba",
      contentRevision: 1,
      title: "Módulo de prueba",
      subject: "Materia sintética",
      description: "Fixture contractual",
      language: "es-AR",
      createdAt: NOW,
      updatedAt: NOW
    },
    questions: [
      {
        id: "q.facil.1",
        revision: 1,
        difficulty: "facil",
        topic: "Conceptos",
        prompt: "Identificación de la respuesta",
        body: "¿Cuál es la opción correcta?",
        options: [
          { id: "a", text: "La opción A" },
          { id: "b", text: "La opción B" }
        ],
        correctOptionId: "a",
        explanation: "A es correcta.",
        source: { label: "Material sintético", reference: "Unidad 1" }
      },
      {
        id: "q.medio.1",
        revision: 2,
        difficulty: "medio",
        topic: "Aplicación",
        prompt: "¿Qué alternativa corresponde?",
        options: [
          { id: "x", text: "La opción X" },
          { id: "y", text: "La opción Y" },
          { id: "z", text: "La opción Z" }
        ],
        correctOptionId: "y",
        explanation: "Y es correcta."
      }
    ],
    progress: {
      updatedAt: NOW,
      stateRevision: 0,
      questions: {},
      runs: [],
      priorRunSummary: emptyPriorRunSummary(),
      activeRun: null
    }
  };
}

export function activeSnapshot(): StudySnapshot {
  const snapshot = initialSnapshot();
  snapshot.progress.stateRevision = 2;
  snapshot.progress.activeRun = {
    id: "run.1.0000002a",
    createdStateRevision: 1,
    completedStateRevision: null,
    startedAt: NOW,
    seed: 42,
    filters: {
      difficulty: "mixta",
      population: "nuevas",
      requestedSize: 10,
      acceptedSize: 2
    },
    coverageBeforeCount: 0,
    items: [
      {
        questionId: "q.facil.1",
        questionRevision: 1,
        optionOrder: ["b", "a"],
        answer: { kind: "option", optionId: "a" }
      },
      {
        questionId: "q.medio.1",
        questionRevision: 2,
        optionOrder: ["z", "x", "y"],
        answer: null
      }
    ],
    status: "active",
    submittedAt: null,
    currentIndex: 1
  };
  return snapshot;
}

export function completedSnapshot(): StudySnapshot {
  const snapshot = initialSnapshot();
  snapshot.progress.updatedAt = "2026-09-06T12:05:00Z";
  snapshot.progress.stateRevision = 4;
  snapshot.progress.questions = {
    "q.facil.1": {
      questionRevision: 1,
      attempts: 1,
      correct: 1,
      lastResult: "correct",
      lastAnswer: { kind: "option", optionId: "a" },
      lastSubmittedAt: "2026-09-06T12:05:00Z",
      lastCompletedStateRevision: 4
    },
    "q.medio.1": {
      questionRevision: 2,
      attempts: 1,
      correct: 0,
      lastResult: "incorrect",
      lastAnswer: { kind: "dontKnow" },
      lastSubmittedAt: "2026-09-06T12:05:00Z",
      lastCompletedStateRevision: 4
    }
  };
  snapshot.progress.runs = [
    {
      id: "run.1.0000002a",
      createdStateRevision: 1,
      completedStateRevision: 4,
      startedAt: NOW,
      seed: 42,
      filters: {
        difficulty: "mixta",
        population: "nuevas",
        requestedSize: 10,
        acceptedSize: 2
      },
      coverageBeforeCount: 0,
      items: [
        {
          questionId: "q.facil.1",
          questionRevision: 1,
          optionOrder: ["b", "a"],
          answer: { kind: "option", optionId: "a" }
        },
        {
          questionId: "q.medio.1",
          questionRevision: 2,
          optionOrder: ["z", "x", "y"],
          answer: { kind: "dontKnow" }
        }
      ],
      status: "completed",
      submittedAt: "2026-09-06T12:05:00Z",
      correctCount: 1,
      incorrectCount: 1,
      coverageAfterCount: 2
    }
  ];
  return snapshot;
}

export function compactedSnapshot(): StudySnapshot {
  const snapshot = initialSnapshot();
  snapshot.progress.updatedAt = "2026-09-06T12:05:00Z";
  snapshot.progress.stateRevision = 3;
  snapshot.progress.questions = {
    "q.facil.1": {
      questionRevision: 1,
      attempts: 1,
      correct: 1,
      lastResult: "correct",
      lastAnswer: { kind: "option", optionId: "a" },
      lastSubmittedAt: "2026-09-06T12:05:00Z",
      lastCompletedStateRevision: 2
    }
  };
  snapshot.progress.priorRunSummary = {
    runCount: 1,
    attemptCount: 1,
    correctCount: 1,
    firstSubmittedAt: "2026-09-06T12:05:00Z",
    lastSubmittedAt: "2026-09-06T12:05:00Z",
    byDifficulty: {
      facil: { attempts: 1, correct: 1 },
      medio: { attempts: 0, correct: 0 },
      dificil: { attempts: 0, correct: 0 },
      experto: { attempts: 0, correct: 0 }
    }
  };
  return snapshot;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

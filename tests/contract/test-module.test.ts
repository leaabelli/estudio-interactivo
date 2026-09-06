import { describe, expect, test } from "bun:test";
import { canonicalStringify, type CanonicalJsonValue } from "../../src/domain/canonical";
import {
  DIFFICULTIES,
  emptyPriorRunSummary,
  type Difficulty,
  type StudySnapshot
} from "../../src/domain/types";
import { validateSnapshot } from "../../src/domain/validation";

const MODULE_ID = "fundamentos-estudio-razonamiento";
const FIXED_TIMESTAMP = "2026-09-06T12:00:00Z";
const MODULE_URL = new URL("../../modulo-prueba.study.json", import.meta.url);

async function loadModule(): Promise<{ snapshot: StudySnapshot; text: string }> {
  const text = await Bun.file(MODULE_URL).text();
  return { snapshot: JSON.parse(text) as StudySnapshot, text };
}

describe("módulo sintético inicial", () => {
  test("cumple el contrato semántico y está serializado de forma canónica", async () => {
    const { snapshot, text } = await loadModule();
    const result = validateSnapshot(snapshot);
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.errors, null, 2)).toBe(true);
    expect(text).toBe(canonicalStringify(snapshot as unknown as CanonicalJsonValue));
  });

  test("contiene exactamente 12 preguntas por dificultad y 48 en total", async () => {
    const { snapshot } = await loadModule();
    expect(snapshot.questions).toHaveLength(48);

    for (const difficulty of DIFFICULTIES) {
      const questions = snapshot.questions.filter((question) => question.difficulty === difficulty);
      expect(questions, difficulty).toHaveLength(12);
      expect(questions.map((question) => question.id)).toEqual(
        Array.from(
          { length: 12 },
          (_, index) => `${MODULE_ID}.${difficulty}.${String(index + 1).padStart(3, "0")}`
        )
      );
    }
  });

  test("cada pregunta tiene cuatro opciones válidas y posiciones correctas balanceadas", async () => {
    const { snapshot } = await loadModule();

    for (const difficulty of DIFFICULTIES) {
      const correctPositions: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
      const questions = snapshot.questions.filter((question) => question.difficulty === difficulty);

      for (const question of questions) {
        expect(question.options.map((option) => option.id)).toEqual(["a", "b", "c", "d"]);
        expect(new Set(question.options.map((option) => option.text)).size).toBe(4);
        expect(question.options.some((option) => option.id === question.correctOptionId)).toBe(true);
        correctPositions[question.correctOptionId] = (correctPositions[question.correctOptionId] ?? 0) + 1;
      }

      expect(correctPositions, difficulty).toEqual({ a: 3, b: 3, c: 3, d: 3 });
    }
  });

  test("usa contenido original sintético, variado y sin referencias a cursos oficiales", async () => {
    const { snapshot, text } = await loadModule();
    expect(snapshot.module.subject).toBe("Fundamentos de estudio y razonamiento");
    expect(snapshot.module.description).toContain("No deriva de material oficial");
    expect(new Set(snapshot.questions.map((question) => question.prompt)).size).toBe(48);
    expect(new Set(snapshot.questions.map((question) => question.explanation)).size).toBe(48);
    expect(new Set(snapshot.questions.map((question) => question.source?.reference)).size).toBe(48);

    for (const difficulty of DIFFICULTIES as readonly Difficulty[]) {
      const topics = new Set(
        snapshot.questions
          .filter((question) => question.difficulty === difficulty)
          .map((question) => question.topic)
      );
      expect(topics.size, difficulty).toBeGreaterThanOrEqual(10);
    }

    for (const question of snapshot.questions) {
      expect(question.source?.label).toBe("Banco sintético original (sin material de cursos)");
      expect(question.source?.reference).toStartWith("Fundamentos de estudio y razonamiento · ");
    }
    expect(text).not.toMatch(/campusvirtual|udesa|https?:\/\//i);
  });

  test("inicia con metadatos reproducibles y progreso exactamente vacío", async () => {
    const { snapshot } = await loadModule();
    expect(snapshot.module).toMatchObject({
      id: MODULE_ID,
      contentRevision: 1,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      language: "es-AR"
    });
    expect(snapshot.progress).toEqual({
      updatedAt: FIXED_TIMESTAMP,
      stateRevision: 0,
      questions: {},
      runs: [],
      priorRunSummary: emptyPriorRunSummary(),
      activeRun: null
    });
  });
});

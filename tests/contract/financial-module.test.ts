import { describe, expect, test } from "bun:test";
import { verifyGeneratedInitial } from "../../scripts/verify-initial-module";
import {
  DIFFICULTIES,
  emptyPriorRunSummary,
  type Difficulty,
  type StudySnapshot,
} from "../../src/domain/types";
import { parseSnapshotText } from "../../src/domain/validation";

const MODULE_URL = new URL(
  "../../modulos/informacion-financiera/informacion-financiera-ampliado.study.json",
  import.meta.url,
);
const EXPECTED_COUNTS: Record<Difficulty, number> = {
  facil: 52,
  medio: 41,
  dificil: 23,
  experto: 0,
};

async function loadModule(): Promise<{ snapshot: StudySnapshot; text: string }> {
  const text = await Bun.file(MODULE_URL).text();
  return { snapshot: JSON.parse(text) as StudySnapshot, text };
}

describe("módulo publicado de información financiera", () => {
  test("cumple el contrato y el formato canónico de un módulo inicial", async () => {
    const { snapshot, text } = await loadModule();
    const result = parseSnapshotText(text);
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.errors, null, 2)).toBe(true);
    expect(verifyGeneratedInitial(snapshot, text)).toEqual([]);
  });

  test("contiene 116 preguntas distribuidas en tres dificultades", async () => {
    const { snapshot } = await loadModule();
    expect(snapshot.questions).toHaveLength(116);
    for (const difficulty of DIFFICULTIES) {
      expect(
        snapshot.questions.filter((question) => question.difficulty === difficulty),
        difficulty,
      ).toHaveLength(EXPECTED_COUNTS[difficulty]);
    }
  });

  test("cada pregunta tiene título, cuerpo, fuente, explicación y una clave existente", async () => {
    const { snapshot } = await loadModule();
    expect(new Set(snapshot.questions.map((question) => question.id)).size).toBe(116);

    for (const question of snapshot.questions) {
      const fields = {
        prompt: question.prompt,
        body: question.body,
        "source.label": question.source?.label,
        "source.reference": question.source?.reference,
        explanation: question.explanation,
      };
      for (const [field, value] of Object.entries(fields)) {
        expect(value, `${question.id}: ${field}`).toMatch(/[\p{L}\p{N}\p{P}\p{S}]/u);
      }
      expect(
        question.options.some((option) => option.id === question.correctOptionId),
        question.id,
      ).toBe(true);
      expect(new Set(question.options.map((option) => option.id)).size, question.id).toBe(
        question.options.length,
      );
    }
  });

  test("incluye veinte tablas estructuradas completas", async () => {
    const { snapshot } = await loadModule();
    const tables = snapshot.questions
      .flatMap((question) => question.supportingContent ?? [])
      .filter((block) => block.kind === "table");
    expect(tables).toHaveLength(20);
    for (const table of tables) {
      expect(table.caption).toMatch(/\S/);
      expect(table.rows.length).toBeGreaterThan(0);
      expect(table.rows.every((row) => row.length === table.columns.length), table.caption).toBe(true);
    }
  });

  test("se distribuye con progreso exactamente vacío", async () => {
    const { snapshot } = await loadModule();
    expect(snapshot.progress).toEqual({
      updatedAt: snapshot.module.updatedAt,
      stateRevision: 0,
      questions: {},
      runs: [],
      priorRunSummary: emptyPriorRunSummary(),
      activeRun: null,
    });
  });
});

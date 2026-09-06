import { describe, expect, test } from "bun:test";
import { canonicalStringify, type CanonicalJsonValue } from "../../src/domain/canonical";
import type { StudySnapshot } from "../../src/domain/types";
import { verifyGeneratedInitial } from "../../scripts/verify-initial-module";

const MODULE_URL = new URL("../../modulo-prueba.study.json", import.meta.url);

async function fixture(): Promise<{ snapshot: StudySnapshot; text: string }> {
  const text = await Bun.file(MODULE_URL).text();
  return { text, snapshot: JSON.parse(text) as StudySnapshot };
}

describe("contrato de generación inicial", () => {
  test("acepta el módulo sintético reproducible", async () => {
    const { snapshot, text } = await fixture();
    expect(verifyGeneratedInitial(snapshot, text)).toEqual([]);
  });

  test("rechaza serialización no canónica", async () => {
    const { snapshot } = await fixture();
    expect(verifyGeneratedInitial(snapshot, JSON.stringify(snapshot, null, 2))).toContain(
      "el archivo debe usar JSON canónico, sin BOM, sangría ni salto final",
    );
  });

  test("exige trazabilidad por pregunta", async () => {
    const { snapshot } = await fixture();
    const changed = structuredClone(snapshot);
    delete changed.questions[0]!.source;
    const text = canonicalStringify(changed as unknown as CanonicalJsonValue);
    expect(verifyGeneratedInitial(changed, text).some((issue) => issue.includes("source.label y source.reference"))).toBe(true);
  });

  test("limita el ID base para que entren los IDs de pregunta", async () => {
    const { snapshot } = await fixture();
    const changed = structuredClone(snapshot);
    changed.module.id = "a".repeat(53);
    expect(verifyGeneratedInitial(changed, "").some((issue) => issue.includes("52 caracteres"))).toBe(true);
  });
});


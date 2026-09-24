import { describe, expect, test } from "bun:test";
import {
  answerActiveRun,
  createActiveRun,
  navigateActiveRun,
  submitActiveRun
} from "../../src/domain/runs";
import { deriveInsights, incorrectItemIds } from "../../src/domain/insights";
import { countEligible } from "../../src/domain/selection";
import type { SelectionRequest, StudySnapshot } from "../../src/domain/types";
import { validateSnapshot } from "../../src/domain/validation";

const MODULES = [
  new URL("../../modulo-prueba.study.json", import.meta.url),
  new URL(
    "../../modulos/informacion-financiera/informacion-financiera-ampliado.study.json",
    import.meta.url
  )
];

const NOW = "2026-09-25T12:00:00.000Z";

function expectValid(snapshot: StudySnapshot): void {
  const result = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  expect(result.ok, result.ok ? undefined : JSON.stringify(result.errors.slice(0, 5), null, 2)).toBe(true);
}

function roundTrip(snapshot: StudySnapshot): StudySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as StudySnapshot;
}

/** Plays an exam the way the previous app version did, answering every other question correctly. */
function playLegacyExam(snapshot: StudySnapshot, seed: number, population: "nuevas" | "todas"): StudySnapshot {
  let current = createActiveRun(
    snapshot,
    { difficulty: "mixta", population, requestedSize: 10, seed },
    NOW
  );
  const run = current.progress.activeRun!;
  run.items.forEach((item, index) => {
    const question = current.questions.find((candidate) => candidate.id === item.questionId)!;
    const wrong = question.options.find((option) => option.id !== question.correctOptionId)!;
    current = navigateActiveRun(current, index, NOW);
    current = answerActiveRun(
      current,
      { kind: "option", optionId: index % 2 === 0 ? question.correctOptionId : wrong.id },
      NOW
    );
  });
  return submitActiveRun(current, NOW);
}

for (const moduleUrl of MODULES) {
  const name = moduleUrl.pathname.split("/").at(-1);

  describe(`retrocompatibilidad: ${name}`, () => {
    test("un archivo sin progreso se abre y produce insights vacíos", async () => {
      const snapshot = (await Bun.file(moduleUrl).json()) as StudySnapshot;
      expectValid(snapshot);
      const insights = deriveInsights(snapshot);
      expect(insights.lastScorePercent).toBeNull();
      expect(insights.currentLevelPercent).toBeNull();
      expect(insights.failed).toHaveLength(0);
      expect(countEligible(snapshot, "mixta", "falladas")).toBe(0);
    });

    test("un archivo semi-completado con examen pausado sigue funcionando", async () => {
      let snapshot = (await Bun.file(moduleUrl).json()) as StudySnapshot;
      snapshot = playLegacyExam(snapshot, 11, "nuevas");
      snapshot = playLegacyExam(snapshot, 12, "todas");
      // Pause mid-exam, as the old app would save it.
      snapshot = createActiveRun(
        snapshot,
        { difficulty: "mixta", population: "nuevas", requestedSize: 10, seed: 13 },
        NOW
      );
      const firstItem = snapshot.progress.activeRun!.items[0]!;
      snapshot = answerActiveRun(snapshot, { kind: "option", optionId: firstItem.optionOrder[0]! }, NOW);
      snapshot = roundTrip(snapshot);
      expectValid(snapshot);

      const insights = deriveInsights(snapshot);
      expect(insights.examCount).toBe(2);
      expect(insights.lastScorePercent).toBe(50);
      expect(insights.failed.length).toBeGreaterThan(0);

      // Resume and finish the paused exam, then use the new review pools.
      snapshot = submitActiveRun(snapshot, NOW);
      expectValid(snapshot);
      const failedCount = countEligible(snapshot, "mixta", "falladas");
      expect(failedCount).toBe(deriveInsights(snapshot).failed.length);

      const failedRequest: SelectionRequest = {
        difficulty: "mixta",
        population: "falladas",
        requestedSize: 10,
        seed: 21,
        ...(failedCount < 10 ? { acceptedSize: failedCount } : {})
      };
      snapshot = createActiveRun(snapshot, failedRequest, NOW);
      expect(snapshot.progress.activeRun!.filters.population).toBe("todas");
      expectValid(snapshot);
      snapshot = submitActiveRun(snapshot, NOW);
      expectValid(snapshot);

      const lastRun = snapshot.progress.runs.at(-1)!;
      const mistakes = incorrectItemIds(lastRun, snapshot);
      expect(mistakes).toHaveLength(lastRun.incorrectCount);
      snapshot = createActiveRun(snapshot, {
        difficulty: "mixta",
        population: "todas",
        requestedSize: 10,
        acceptedSize: mistakes.length,
        questionIds: mistakes,
        seed: 22
      }, NOW);
      expect(snapshot.progress.activeRun!.items.map((item) => item.questionId).sort()).toEqual([...mistakes].sort());
      expectValid(snapshot);
      expectValid(submitActiveRun(snapshot, NOW));
    });

    test("los exámenes nuevos solo persisten valores de filtro que la versión anterior entiende", async () => {
      let snapshot = (await Bun.file(moduleUrl).json()) as StudySnapshot;
      snapshot = playLegacyExam(snapshot, 31, "nuevas");
      const failedCount = countEligible(snapshot, "mixta", "falladas");
      snapshot = createActiveRun(snapshot, {
        difficulty: "mixta",
        population: "falladas",
        requestedSize: 10,
        acceptedSize: failedCount,
        seed: 32
      }, NOW);
      snapshot = submitActiveRun(snapshot, NOW);
      for (const run of snapshot.progress.runs) {
        expect(["nuevas", "todas"]).toContain(run.filters.population);
      }
      expect(Object.keys(snapshot).sort()).toEqual(["module", "progress", "questions", "schemaVersion"]);
      expect(snapshot.schemaVersion).toBe(1);
    });
  });
}

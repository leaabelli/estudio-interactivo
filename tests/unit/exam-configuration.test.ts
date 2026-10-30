import { describe, expect, test } from "bun:test";
import { countEligibleByTopic, selectQuestions, topicQuotaError } from "../../src/domain/selection";
import { MAX_RUN_SIZE, type SelectionRequest } from "../../src/domain/types";
import { makeQuestions, makeSnapshot, progress } from "./fixtures";

const base: SelectionRequest = { difficulty: "mixta", population: "todas", requestedSize: 20, seed: 42 };
const quotas = [
  { topic: "Cálculo", count: 5 },
  { topic: "Conceptuales", count: 5 },
  { topic: "Casos", count: 10 }
];
const bank = () => makeSnapshot(makeQuestions(30).map((question, index) => ({
  ...question, topic: ["Cálculo", "Conceptuales", "Casos"][index % 3]!
})));

describe("configurable exam selection", () => {
  test("selects arbitrary sizes without duplicates and preserves proportional mixed targets", () => {
    const snapshot = makeSnapshot(makeQuestions(40));
    for (const requestedSize of [1, 2, 3, 7, 9, 10, 20, 31, 50, 160]) {
      const selected = selectQuestions(snapshot, { ...base, requestedSize });
      expect(selected).toHaveLength(requestedSize);
      expect(new Set(selected.map((q) => q.id)).size).toBe(requestedSize);
    }
    const selected = selectQuestions(snapshot, base);
    expect(["facil", "medio", "dificil", "experto"].map((difficulty) => selected.filter((q) => q.difficulty === difficulty).length)).toEqual([6, 6, 4, 4]);
  });

  test("validates size bounds and permits the full 5000-question bank", () => {
    for (const requestedSize of [0, -1, 2.5, NaN, Infinity, MAX_RUN_SIZE + 1]) {
      expect(() => selectQuestions(bank(), { ...base, requestedSize })).toThrow("integer from 1");
    }
    expect(selectQuestions(makeSnapshot(makeQuestions(1250)), { ...base, requestedSize: MAX_RUN_SIZE })).toHaveLength(MAX_RUN_SIZE);
  });

  test("selects exactly 5 + 5 + 10, stable across question and quota order", () => {
    const snapshot = bank();
    const request = { ...base, topicQuotas: quotas };
    const selected = selectQuestions(snapshot, request);
    for (const { topic, count } of quotas) expect(selected.filter((q) => q.topic === topic)).toHaveLength(count);
    expect(new Set(selected.map((q) => q.id)).size).toBe(20);
    expect(selectQuestions({ ...snapshot, questions: [...snapshot.questions].reverse() }, { ...request, topicQuotas: [...quotas].reverse() })).toEqual(selected);
    expect(selectQuestions(snapshot, { ...request, seed: 43 })).not.toEqual(selected);
    expect(quotas.map((q) => q.count)).toEqual([5, 5, 10]);
  });

  test("supports a single topic and never fills from excluded topics", () => {
    const selected = selectQuestions(bank(), { ...base, topicQuotas: [{ topic: "Cálculo", count: 20 }] });
    expect(selected.every((q) => q.topic === "Cálculo")).toBe(true);
  });

  test("honors difficulty, population and question-ID restrictions with quotas", () => {
    const snapshot = bank();
    const seen = snapshot.questions.filter((q) => q.topic === "Cálculo" && q.difficulty === "facil").slice(0, 2);
    for (const question of seen) snapshot.progress.questions[question.id] = progress();
    expect(countEligibleByTopic(snapshot, "facil", "nuevas").get("Cálculo")).toBe(8);
    expect(countEligibleByTopic(snapshot, "facil", "falladas").get("Cálculo")).toBe(2);
    const request = { ...base, difficulty: "facil" as const, requestedSize: 5, topicQuotas: [{ topic: "Cálculo", count: 5 }] };
    const selected = selectQuestions(snapshot, { ...request, population: "nuevas" });
    expect(selected.every((q) => q.difficulty === "facil" && q.topic === "Cálculo" && !seen.includes(q))).toBe(true);
    expect(() => selectQuestions(snapshot, { ...request, population: "falladas" })).toThrow("hay 2 disponibles");
    expect(() => selectQuestions(snapshot, { ...request, questionIds: [seen[0]!.id] })).toThrow("hay 1 disponibles");
  });

  test("refuses shortages, wrong totals, duplicate/unknown topics and invalid counts", () => {
    const snapshot = bank();
    const available = countEligibleByTopic(snapshot, "mixta", "todas");
    for (const topicQuotas of [[], [{ topic: "Cálculo", count: 19 }], [{ topic: "Casos", count: 41 }],
      [{ topic: "Inexistente", count: 20 }], [{ topic: "Casos", count: 10 }, { topic: "Casos", count: 10 }],
      ...[0, -1, 1.5, NaN, Infinity].map((count) => [{ topic: "Casos", count }])]) {
      expect(topicQuotaError({ ...base, topicQuotas }, available)).not.toBeNull();
      expect(() => selectQuestions(snapshot, { ...base, topicQuotas })).toThrow();
    }
    expect(() => selectQuestions(snapshot, { ...base, topicQuotas: quotas, acceptedSize: 10 })).toThrow("no admite un examen reducido");
  });

  test("still offers explicit shorter automatic exams", () => {
    const snapshot = makeSnapshot(makeQuestions(3));
    expect(() => selectQuestions(snapshot, base)).toThrow("Only 12");
    expect(selectQuestions(snapshot, { ...base, acceptedSize: 12 })).toHaveLength(12);
    expect(() => selectQuestions(snapshot, { ...base, acceptedSize: 11 })).toThrow("every eligible");
  });

  test("handles topic names as data, including HTML and object property names", () => {
    const snapshot = makeSnapshot(makeQuestions(10).map((q, i) => ({ ...q, topic: ["__proto__", "constructor", "<script>"][i % 3]! })));
    const selected = selectQuestions(snapshot, { ...base, topicQuotas: [
      { topic: "__proto__", count: 5 }, { topic: "constructor", count: 5 }, { topic: "<script>", count: 10 }
    ] });
    expect(selected).toHaveLength(20);
  });
});

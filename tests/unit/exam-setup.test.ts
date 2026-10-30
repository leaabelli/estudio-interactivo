import { describe, expect, test } from "bun:test";
import { distributeTopics, parseExamSetup, reconcileExamSetup, stepTopicQuota, type ExamSetup } from "../../src/domain/exam-setup";
import { loadExamSetup, saveExamSetup } from "../../src/adapters/exam-setup";

const setup = (): ExamSetup => ({
  version: 1, mode: "custom", total: 20,
  selectedTopics: ["Cálculo", "Casos"], topicQuotas: [{ topic: "Cálculo", count: 5 }, { topic: "Casos", count: 10 }]
});

describe("balanced topic distribution", () => {
  test("distributes exactly the total, with at most one question of difference", () => {
    const available = new Map([["Cálculo", 30], ["Casos", 30], ["Teoría", 30]]);
    for (const total of [1, 2, 5, 20, 50]) {
      const quotas = distributeTopics(total, available, new Set(available.keys()));
      expect(quotas.reduce((sum, q) => sum + q.count, 0)).toBe(total);
      const counts = [...available.keys()].map((topic) => quotas.find((q) => q.topic === topic)?.count ?? 0);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });
  test("redistributes a scarce topic's share only among the chosen topics", () => {
    const available = new Map([["A", 1], ["B", 20], ["C", 20], ["Excluded", 100]]);
    expect(distributeTopics(10, available, new Set(["A", "B", "C"]))).toEqual([
      { topic: "A", count: 1 }, { topic: "B", count: 5 }, { topic: "C", count: 4 }
    ]);
    expect(distributeTopics(50, available, new Set(["A", "B"]))).toEqual([
      { topic: "A", count: 1 }, { topic: "B", count: 20 }
    ]);
  });
  test("handles empty, invalid and zero-availability selections", () => {
    const available = new Map([["A", 0], ["B", 30]]);
    for (const topics of [new Set<string>(), new Set(["Missing"]), new Set(["A"])]) {
      expect(distributeTopics(20, available, topics)).toEqual([]);
    }
    for (const total of [0, -1, NaN, 1.5, Infinity, 5001]) expect(distributeTopics(total, available, new Set(["B"]))).toEqual([]);
  });
  test("is deterministic independently of bank order and supports arbitrary topic names", () => {
    const available = new Map([["__proto__", 12], ["constructor", 10], ["IVA", 15]]);
    const chosen = new Set(available.keys());
    expect(distributeTopics(20, available, chosen)).toEqual(distributeTopics(20, new Map([...available].reverse()), chosen));
  });
});

describe("topic steppers", () => {
  const quotas = [{ topic: "Cálculo", count: 5 }, { topic: "Conceptos", count: 5 }, { topic: "Casos", count: 10 }];
  const available = new Map([["Cálculo", 8], ["Conceptos", 8], ["Casos", 12]]);
  test("adding one changes only that topic and increases the total to 21", () => {
    const next = stepTopicQuota(quotas, "Casos", 1, available)!;
    expect(next).toEqual([{ topic: "Cálculo", count: 5 }, { topic: "Conceptos", count: 5 }, { topic: "Casos", count: 11 }]);
    expect(next.reduce((sum, q) => sum + q.count, 0)).toBe(21);
    expect(quotas[2]!.count).toBe(10);
  });
  test("stops at zero, topic capacity and the global size bound", () => {
    expect(stepTopicQuota([], "Casos", -1, available)).toBeNull();
    expect(stepTopicQuota([{ topic: "Casos", count: 12 }], "Casos", 1, available)).toBeNull();
    expect(stepTopicQuota(quotas, "Missing", 1, available)).toBeNull();
    expect(stepTopicQuota([{ topic: "A", count: 5000 }], "B", 1, new Map([["A", 5000], ["B", 1]]))).toBeNull();
    expect(stepTopicQuota([{ topic: "Casos", count: 1 }], "Casos", -1, available)).toEqual([]);
  });
  test("lets users decrease a saved quota that exceeds current availability", () => {
    expect(stepTopicQuota(quotas, "Casos", -1, new Map([["Casos", 2]]))?.find((q) => q.topic === "Casos")?.count).toBe(9);
  });
});

describe("reusable per-module configuration", () => {
  test("stores independent module settings and no question/progress data", () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    expect(saveExamSetup("one", setup(), storage)).toBe(true);
    expect(saveExamSetup("two", { ...setup(), mode: "auto", total: 7 }, storage)).toBe(true);
    expect(loadExamSetup("one", storage)).toEqual(setup());
    expect(loadExamSetup("two", storage)?.total).toBe(7);
    expect(loadExamSetup("missing", storage)).toBeNull();
    expect([...entries.values()].join()).not.toMatch(/questionId|progress|answer|population|difficulty/);
  });
  test("tolerates blocked storage, malformed JSON and unsupported versions", () => {
    expect(saveExamSetup("one", setup(), { setItem: () => { throw new Error("QuotaExceededError"); } })).toBe(false);
    expect(loadExamSetup("one", { getItem: () => { throw new Error("SecurityError"); } })).toBeNull();
    for (const raw of ["bad", "null", "[]", JSON.stringify({ ...setup(), version: 2 }), "x".repeat(2_000_001)]) {
      expect(loadExamSetup("one", { getItem: () => raw })).toBeNull();
    }
  });
  test("rejects invalid/duplicate preferences and returns a detached safe object", () => {
    for (const invalid of [
      { total: -1 }, { total: 1.5 }, { mode: "unknown" },
      { selectedTopics: ["A", "A"] }, { topicQuotas: [{ topic: "A", count: 0 }] },
      { topicQuotas: [{ topic: "A", count: 2 }, { topic: "A", count: 3 }] },
      { topicQuotas: [{ topic: "A", count: 4000 }, { topic: "B", count: 4000 }] }
    ]) expect(parseExamSetup({ ...setup(), ...invalid })).toBeNull();
    const original = setup();
    const parsed = parseExamSetup({ ...original, extra: "ignored" })!;
    parsed.topicQuotas[0]!.count = 9;
    expect(original.topicQuotas[0]!.count).toBe(5);
    expect(parsed).not.toHaveProperty("extra");
  });
  test("removes vanished topics without adding new ones or clamping saved quantities", () => {
    const result = reconcileExamSetup(setup(), new Set(["Casos", "Nuevo"]));
    expect(result.selectedTopics).toEqual(["Casos"]);
    expect(result.topicQuotas).toEqual([{ topic: "Casos", count: 10 }]);
    expect(setup().topicQuotas).toHaveLength(2);
  });
  test("loads legacy saved distributions without restoring or re-saving their practice filters", () => {
    let raw = JSON.stringify({ ...setup(), population: "falladas", difficulty: "experto" });
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    const restored = loadExamSetup("one", storage)!;
    expect(restored).toEqual(setup());
    expect(saveExamSetup("one", restored, storage)).toBe(true);
    expect(JSON.parse(raw)).not.toHaveProperty("population");
    expect(JSON.parse(raw)).not.toHaveProperty("difficulty");
  });
});

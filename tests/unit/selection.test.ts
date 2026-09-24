import { describe, expect, test } from "bun:test";
import {
  InsufficientQuestionsError,
  countEligible,
  countEligibleByDifficulty,
  selectQuestions,
  selectionWeight
} from "../../src/domain/selection";
import type { Difficulty, SelectionRequest } from "../../src/domain/types";
import { makeQuestion, makeQuestions, makeSnapshot, progress } from "./fixtures";

const baseRequest: SelectionRequest = {
  difficulty: "mixta",
  population: "nuevas",
  requestedSize: 10,
  seed: 7
};

function counts(ids: readonly { difficulty: Difficulty }[]): Record<Difficulty, number> {
  return ids.reduce<Record<Difficulty, number>>(
    (result, question) => {
      result[question.difficulty] += 1;
      return result;
    },
    { facil: 0, medio: 0, dificil: 0, experto: 0 }
  );
}

describe("eligibility", () => {
  test("counts fixed, mixed, new, and all populations", () => {
    const snapshot = makeSnapshot(makeQuestions(3));
    snapshot.progress.questions["facil.01"] = progress();

    expect(countEligible(snapshot, "facil", "nuevas")).toBe(2);
    expect(countEligible(snapshot, "facil", "todas")).toBe(3);
    expect(countEligible(snapshot, "mixta", "nuevas")).toBe(11);
    expect(countEligibleByDifficulty(snapshot, "nuevas")).toEqual({
      facil: 2,
      medio: 3,
      dificil: 3,
      experto: 3
    });
  });

  test("does not read inherited progress keys", () => {
    const snapshot = makeSnapshot([makeQuestion("constructor")]);
    expect(countEligible(snapshot, "facil", "nuevas")).toBe(1);
  });
});

describe("selection", () => {
  test("selects ten unique mixed questions in the 3/3/2/2 target", () => {
    const snapshot = makeSnapshot();
    const selected = selectQuestions(snapshot, baseRequest);

    expect(selected).toHaveLength(10);
    expect(new Set(selected.map((question) => question.id)).size).toBe(10);
    expect(counts(selected)).toEqual({ facil: 3, medio: 3, dificil: 2, experto: 2 });
    expect(selectQuestions(snapshot, baseRequest).map(({ id }) => id)).toEqual(
      selected.map(({ id }) => id)
    );
  });

  test("redistributes missing mixed slots by rotated round-robin", () => {
    const questions = [
      ...Array.from({ length: 5 }, (_, index) => makeQuestion(`m${index}`, "medio")),
      ...Array.from({ length: 5 }, (_, index) => makeQuestion(`d${index}`, "dificil")),
      ...Array.from({ length: 5 }, (_, index) => makeQuestion(`e${index}`, "experto"))
    ];
    const selected = selectQuestions(makeSnapshot(questions), { ...baseRequest, seed: 0 });
    expect(counts(selected)).toEqual({ facil: 0, medio: 4, dificil: 3, experto: 3 });
  });

  test("requires explicit acceptance and all eligible IDs for a shorter run", () => {
    const snapshot = makeSnapshot(Array.from({ length: 9 }, (_, index) => makeQuestion(`q${index}`)));
    expect(() =>
      selectQuestions(snapshot, { ...baseRequest, difficulty: "facil" })
    ).toThrow(InsufficientQuestionsError);
    expect(
      selectQuestions(snapshot, { ...baseRequest, difficulty: "facil", acceptedSize: 9 })
    ).toHaveLength(9);
    expect(() =>
      selectQuestions(snapshot, { ...baseRequest, difficulty: "facil", acceptedSize: 8 })
    ).toThrow("must accept every eligible");
  });

  test("review pools are randomized, not a fixed priority sweep", () => {
    const snapshot = makeSnapshot(
      Array.from({ length: 40 }, (_, index) => makeQuestion(`q${String(index).padStart(2, "0")}`))
    );
    for (let index = 0; index < 20; index += 1) {
      snapshot.progress.questions[`q${String(index).padStart(2, "0")}`] = progress({
        attempts: 1,
        correct: 1,
        lastResult: "correct"
      });
    }
    const selections = new Set<string>();
    let masteredDraws = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const ids = selectQuestions(snapshot, {
        ...baseRequest,
        difficulty: "facil",
        population: "todas",
        seed
      }).map(({ id }) => id);
      selections.add([...ids].sort().join(","));
      masteredDraws += ids.filter((id) => Number(id.slice(1)) < 20).length;
    }
    // Many different exams, unseen favored, mastered still reappearing.
    expect(selections.size).toBeGreaterThan(150);
    expect(masteredDraws).toBeGreaterThan(0);
    expect(masteredDraws).toBeLessThan(200 * 10 * 0.4);
  });

  test("weights favor failed and unseen questions and rest recently answered ones", () => {
    expect(selectionWeight(undefined, [])).toBe(3);
    const failed = progress({ lastCompletedStateRevision: 1 });
    expect(selectionWeight(failed, [5, 9])).toBe(4);
    expect(selectionWeight(failed, [1])).toBe(2);
    const mastered = progress({ correct: 1, lastResult: "correct", lastCompletedStateRevision: 9 });
    expect(selectionWeight(mastered, [5, 9])).toBeCloseTo(0.2);
    expect(selectionWeight(mastered, [])).toBeCloseTo(1);
    expect(selectionWeight({ ...mastered, lastCompletedStateRevision: null }, [5, 9])).toBeCloseTo(1);
  });

  test("failed pool returns only questions whose latest answer was incorrect", () => {
    const snapshot = makeSnapshot(makeQuestions(12));
    snapshot.progress.questions["facil.01"] = progress();
    snapshot.progress.questions["medio.02"] = progress();
    snapshot.progress.questions["dificil.03"] = progress({ correct: 1, lastResult: "correct" });
    expect(countEligible(snapshot, "mixta", "falladas")).toBe(2);
    expect(countEligible(snapshot, "medio", "falladas")).toBe(1);
    const selected = selectQuestions(snapshot, {
      ...baseRequest,
      population: "falladas",
      acceptedSize: 2
    });
    expect(selected.map(({ id }) => id).sort()).toEqual(["facil.01", "medio.02"]);
  });

  test("explicit question IDs restrict the pool", () => {
    const snapshot = makeSnapshot(makeQuestions(12));
    const questionIds = ["facil.04", "experto.07", "medio.11"];
    const selected = selectQuestions(snapshot, {
      ...baseRequest,
      population: "todas",
      acceptedSize: 3,
      questionIds
    });
    expect(selected.map(({ id }) => id).sort()).toEqual([...questionIds].sort());
  });

  test("new-only never returns evaluated questions", () => {
    const snapshot = makeSnapshot(makeQuestions(12));
    snapshot.progress.questions["facil.01"] = progress();
    const selected = selectQuestions(snapshot, {
      ...baseRequest,
      difficulty: "facil"
    });
    expect(selected.some(({ id }) => id === "facil.01")).toBe(false);
  });

  test("preserves uniqueness and target counts across many seeds", () => {
    const snapshot = makeSnapshot();
    for (let seed = 0; seed < 100; seed += 1) {
      const selected = selectQuestions(snapshot, { ...baseRequest, seed });
      expect(new Set(selected.map(({ id }) => id)).size).toBe(10);
      expect(counts(selected)).toEqual({ facil: 3, medio: 3, dificil: 2, experto: 2 });
    }
  });

  test("rejects runtime requests outside the schema contract", () => {
    const snapshot = makeSnapshot();
    expect(() => selectQuestions(snapshot, { ...baseRequest, seed: -1 })).toThrow("unsigned");
    expect(() =>
      selectQuestions(snapshot, { ...baseRequest, requestedSize: 9 as 10 })
    ).toThrow("exactly 10");
  });
});

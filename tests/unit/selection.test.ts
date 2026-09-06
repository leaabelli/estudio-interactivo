import { describe, expect, test } from "bun:test";
import {
  InsufficientQuestionsError,
  countEligible,
  countEligibleByDifficulty,
  selectQuestions
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

  test("prioritizes unseen, then last incorrect, then least attempts", () => {
    const snapshot = makeSnapshot(
      Array.from({ length: 12 }, (_, index) => makeQuestion(`q${String(index).padStart(2, "0")}`))
    );
    snapshot.progress.questions.q00 = progress({ attempts: 5, lastResult: "incorrect" });
    snapshot.progress.questions.q01 = progress({ attempts: 1, lastResult: "incorrect" });
    snapshot.progress.questions.q02 = progress({ attempts: 1, correct: 1, lastResult: "correct" });
    snapshot.progress.questions.q03 = progress({ attempts: 2, correct: 2, lastResult: "correct" });

    const selected = selectQuestions(snapshot, {
      ...baseRequest,
      difficulty: "facil",
      population: "todas"
    });
    const ids = selected.map((question) => question.id);
    expect(ids.slice(0, 8).every((id) => !["q00", "q01", "q02", "q03"].includes(id))).toBe(true);
    expect(ids.slice(8)).toEqual(["q01", "q00"]);
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

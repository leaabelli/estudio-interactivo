import { describe, expect, test } from "bun:test";
import type { StudySnapshot } from "../../src/domain/types";
import {
  MAX_COUNTER,
  MAX_SOURCE_FILE_BYTES,
  parseSnapshotText,
  validateSnapshot,
  type ValidationError
} from "../../src/domain/validation";
import {
  activeSnapshot,
  clone,
  compactedSnapshot,
  completedSnapshot,
  initialSnapshot
} from "./fixtures";

function errorsFor(value: unknown): ValidationError[] {
  const result = validateSnapshot(value);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

function expectError(value: unknown, path: string, messagePart?: string): void {
  const errors = errorsFor(value);
  const match = errors.find((error) => error.path === path && (!messagePart || error.message.includes(messagePart)));
  expect(match, `Errores recibidos:\n${errors.map((error) => `${error.path}: ${error.message}`).join("\n")}`).toBeDefined();
}

describe("valid snapshots", () => {
  test("accepts exact initial progress", () => {
    const snapshot = initialSnapshot();
    const result = validateSnapshot(snapshot);
    expect(result).toEqual({ ok: true, value: snapshot });
  });

  test("accepts an active run without counting provisional answers", () => {
    expect(validateSnapshot(activeSnapshot()).ok).toBe(true);
  });

  test("accepts a completed run with reconciled aggregates", () => {
    expect(validateSnapshot(completedSnapshot()).ok).toBe(true);
  });

  test("accepts terminal evidence retained only in the compacted summary", () => {
    expect(validateSnapshot(compactedSnapshot()).ok).toBe(true);
  });

  test("treats prototype-looking IDs as data, not inherited properties", () => {
    const snapshot = initialSnapshot();
    snapshot.questions[0]!.id = "constructor";
    expect(validateSnapshot(snapshot).ok).toBe(true);
  });
});

describe("closed structural contract", () => {
  test("rejects extra properties at every representative object layer", () => {
    const cases: Array<{ snapshot: StudySnapshot; target: Record<string, unknown>; path: string }> = [];

    const root = initialSnapshot();
    cases.push({ snapshot: root, target: root as unknown as Record<string, unknown>, path: "$.extra" });
    const module = initialSnapshot();
    cases.push({ snapshot: module, target: module.module as unknown as Record<string, unknown>, path: "$.module.extra" });
    const question = initialSnapshot();
    cases.push({ snapshot: question, target: question.questions[0] as unknown as Record<string, unknown>, path: "$.questions[0].extra" });
    const option = initialSnapshot();
    cases.push({ snapshot: option, target: option.questions[0]!.options[0] as unknown as Record<string, unknown>, path: "$.questions[0].options[0].extra" });
    const progress = initialSnapshot();
    cases.push({ snapshot: progress, target: progress.progress as unknown as Record<string, unknown>, path: "$.progress.extra" });
    const run = activeSnapshot();
    cases.push({ snapshot: run, target: run.progress.activeRun as unknown as Record<string, unknown>, path: "$.progress.activeRun.extra" });
    const answer = activeSnapshot();
    cases.push({
      snapshot: answer,
      target: answer.progress.activeRun!.items[0]!.answer as unknown as Record<string, unknown>,
      path: "$.progress.activeRun.items[0].answer.extra"
    });

    for (const entry of cases) {
      entry.target.extra = true;
      expectError(entry.snapshot, entry.path, "no está permitida");
    }
  });

  test("rejects missing required fields", () => {
    const snapshot = initialSnapshot() as unknown as Record<string, unknown>;
    delete snapshot.module;
    expectError(snapshot, "$.module", "obligatoria");
  });

  test("separates active and completed run shapes", () => {
    const active = activeSnapshot();
    (active.progress.activeRun as unknown as Record<string, unknown>).correctCount = 0;
    expectError(active, "$.progress.activeRun.correctCount", "no está permitida");

    const completed = completedSnapshot();
    (completed.progress.runs[0] as unknown as Record<string, unknown>).currentIndex = 0;
    expectError(completed, "$.progress.runs[0].currentIndex", "no está permitida");
  });

  test("rejects unsupported schema versions and unsafe counters", () => {
    const version = initialSnapshot() as unknown as { schemaVersion: number };
    version.schemaVersion = 2;
    expectError(version, "$.schemaVersion");

    const counter = initialSnapshot();
    counter.progress.stateRevision = MAX_COUNTER + 1;
    expectError(counter, "$.progress.stateRevision");
  });

  test("counts string limits by Unicode code points", () => {
    const accepted = initialSnapshot();
    accepted.module.title = "😀".repeat(120);
    expect(validateSnapshot(accepted).ok).toBe(true);

    const rejected = initialSnapshot();
    rejected.module.title = "😀".repeat(121);
    expectError(rejected, "$.module.title", "120");
  });

  test("rejects impossible and non-UTC timestamps", () => {
    const impossible = initialSnapshot();
    impossible.module.createdAt = "2026-02-30T12:00:00Z";
    expectError(impossible, "$.module.createdAt", "imposible");

    const offset = initialSnapshot();
    offset.progress.updatedAt = "2026-09-06T13:00:00+01:00";
    expectError(offset, "$.progress.updatedAt", "UTC");
  });
});

describe("IDs and references", () => {
  test("rejects duplicate question and option IDs", () => {
    const questions = initialSnapshot();
    questions.questions[1]!.id = questions.questions[0]!.id;
    expectError(questions, "$.questions[1].id", "duplicado");

    const options = initialSnapshot();
    options.questions[0]!.options[1]!.id = options.questions[0]!.options[0]!.id;
    expectError(options, "$.questions[0].options[1].id", "duplicado");
  });

  test("rejects broken correct-option and progress references", () => {
    const correct = initialSnapshot();
    correct.questions[0]!.correctOptionId = "missing";
    expectError(correct, "$.questions[0].correctOptionId", "no referencia");

    const progress = completedSnapshot();
    progress.progress.questions.ghost = clone(progress.progress.questions["q.facil.1"]!);
    expectError(progress, '$.progress.questions["ghost"]', "no existe");
  });

  test("rejects broken run references and option permutations", () => {
    const question = completedSnapshot();
    question.progress.runs[0]!.items[0]!.questionId = "ghost";
    expectError(question, "$.progress.runs[0].items[0].questionId", "no referencia");

    const order = activeSnapshot();
    order.progress.activeRun!.items[0]!.optionOrder = ["a", "a"];
    expectError(order, "$.progress.activeRun.items[0].optionOrder", "exactamente");

    const answer = activeSnapshot();
    answer.progress.activeRun!.items[0]!.answer = { kind: "option", optionId: "ghost" };
    expectError(answer, "$.progress.activeRun.items[0].answer.optionId", "no referencia");
  });

  test("derives run IDs from creation revision and zero-padded seed", () => {
    const snapshot = activeSnapshot();
    snapshot.progress.activeRun!.id = "run.other";
    expectError(snapshot, "$.progress.activeRun.id", "run.1.0000002a");
  });
});

describe("run and aggregate invariants", () => {
  test("rejects null answers and falsified scores in completed runs", () => {
    const nullAnswer = completedSnapshot();
    nullAnswer.progress.runs[0]!.items[1]!.answer = null;
    expectError(nullAnswer, "$.progress.runs[0].items[1].answer", "no puede");

    const score = completedSnapshot();
    score.progress.runs[0]!.correctCount = 2;
    score.progress.runs[0]!.incorrectCount = 0;
    expectError(score, "$.progress.runs[0].correctCount", "debe ser 1");
  });

  test("rejects accepted-size, current-index and fixed-difficulty mismatches", () => {
    const size = activeSnapshot();
    size.progress.activeRun!.filters.acceptedSize = 1;
    expectError(size, "$.progress.activeRun.filters.acceptedSize", "items.length");

    const index = activeSnapshot();
    index.progress.activeRun!.currentIndex = 2;
    expectError(index, "$.progress.activeRun.currentIndex", "existente");

    const difficulty = activeSnapshot();
    difficulty.progress.activeRun!.filters.difficulty = "facil";
    expectError(difficulty, "$.progress.activeRun.items[1].questionId", "dificultad");
  });

  test("rejects non-monotonic revisions and submission before start", () => {
    const revision = completedSnapshot();
    revision.progress.runs[0]!.completedStateRevision = 1;
    expectError(revision, "$.progress.runs[0].completedStateRevision", "mayor");

    const time = completedSnapshot();
    time.progress.runs[0]!.submittedAt = "2026-09-06T11:59:00Z";
    time.progress.questions["q.facil.1"]!.lastSubmittedAt = "2026-09-06T11:59:00Z";
    time.progress.questions["q.medio.1"]!.lastSubmittedAt = "2026-09-06T11:59:00Z";
    expectError(time, "$.progress.runs[0].submittedAt", "anterior");
  });

  test("recomputes last result and requires terminal evidence", () => {
    const result = completedSnapshot();
    result.progress.questions["q.facil.1"]!.lastResult = "incorrect";
    expectError(result, '$.progress.questions["q.facil.1"].lastResult', "correct");

    const evidence = completedSnapshot();
    evidence.progress.questions["q.facil.1"]!.lastCompletedStateRevision = 3;
    expectError(evidence, '$.progress.questions["q.facil.1"].lastCompletedStateRevision', "última ejecución");
  });

  test("requires null terminal fields for zero attempts and non-null fields otherwise", () => {
    const zero = initialSnapshot();
    zero.progress.stateRevision = 1;
    zero.progress.questions["q.facil.1"] = {
      questionRevision: 1,
      attempts: 0,
      correct: 0,
      lastResult: "incorrect",
      lastAnswer: null,
      lastSubmittedAt: null,
      lastCompletedStateRevision: null
    };
    expectError(zero, '$.progress.questions["q.facil.1"]', "cero intentos");

    const nonzero = completedSnapshot();
    nonzero.progress.questions["q.facil.1"]!.lastAnswer = null;
    expectError(nonzero, '$.progress.questions["q.facil.1"]', "evidencia");
  });

  test("reconciles global and per-difficulty aggregates", () => {
    const attempts = completedSnapshot();
    attempts.progress.questions["q.facil.1"]!.attempts = 2;
    expectError(attempts, "$.progress.questions", "suma");

    const summary = compactedSnapshot();
    summary.progress.priorRunSummary.byDifficulty.facil.attempts = 0;
    summary.progress.priorRunSummary.byDifficulty.medio.attempts = 1;
    expectError(summary, "$.progress.priorRunSummary.byDifficulty.facil.attempts", "reconcilia");
  });

  test("state revision zero means exactly empty progress", () => {
    const snapshot = activeSnapshot();
    snapshot.progress.stateRevision = 0;
    expectError(snapshot, "$.progress", "inicial vacío");
  });
});

describe("parsing, encoding, and budgets", () => {
  test("parses JSON with at most one UTF-8 BOM", () => {
    const text = JSON.stringify(initialSnapshot());
    expect(parseSnapshotText(`\uFEFF${text}`).ok).toBe(true);
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    expect(parseSnapshotText(bytes).ok).toBe(true);

    const twice = parseSnapshotText(`\uFEFF\uFEFF${text}`);
    expect(twice.ok).toBe(false);
  });

  test("rejects invalid UTF-8 and malformed JSON with actionable root errors", () => {
    const utf8 = parseSnapshotText(new Uint8Array([0xc3, 0x28]));
    expect(utf8.ok).toBe(false);
    if (!utf8.ok) expect(utf8.errors[0]).toEqual({ path: "$", message: "el archivo no contiene UTF-8 válido" });

    const json = parseSnapshotText("{oops");
    expect(json.ok).toBe(false);
    if (!json.ok) expect(json.errors[0]!.path).toBe("$");
  });

  test("checks source size before parsing", () => {
    const oversized = new Uint8Array(MAX_SOURCE_FILE_BYTES + 1);
    const result = parseSnapshotText(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.message).toContain("supera");
  });

  test("enforces the canonical module-definition byte budget", () => {
    const snapshot = initialSnapshot();
    const template = snapshot.questions[0]!;
    snapshot.questions = Array.from({ length: 630 }, (_, index) => ({
      ...clone(template),
      id: `q.${index}`,
      prompt: "p".repeat(5000),
      explanation: "e".repeat(5000),
      options: clone(template.options)
    }));
    expectError(snapshot, "$.questions", "bytes UTF-8 canónicos");
  });

  test("rejects unpaired Unicode surrogates during canonical budget validation", () => {
    const snapshot = initialSnapshot();
    snapshot.module.description = "\ud800";
    expectError(snapshot, "$", "unpaired high surrogate");
  });
});


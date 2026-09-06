import { describe, expect, test } from "bun:test";
import type { StudySnapshot } from "../../src/domain/types";
import {
  MAX_COUNTER,
  MAX_QUESTION_MEDIA_BYTES,
  MAX_SOURCE_FILE_BYTES,
  createTrustedModuleValidationContext,
  parseSnapshotText,
  validateTrustedProgressSnapshot,
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

const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const JPEG_2X3 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDDooor7k8A/9k=";
const WEBP_2X3 = "data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+7gpn/sHf0Hf0Hf6pn/yC5YXXEYAA";
const INVALID_PNG_BITSTREAM = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAUlEQVQAKDh96AAAAABJRU5ErkJggg==";
const INVALID_JPEG_BITSTREAM = "data:image/jpeg;base64,/9j/wAAICAABAAEA/9oABgAAPwD/2Q==";
const INVALID_WEBP_BITSTREAM = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAUAAAAvAAAAAAA=";
const APNG_7X5 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAHAAAABQAAAAAAAAAAAGQD6AAApN4NvQAAABVJREFUeJxj/M/A8J8BB2DCJUFDSQAfWAII2A8Z6AAAABpmY1RMAAAAAQAAAAcAAAAFAAAAAAAAAAAAZAPoAAA/redpAAAAGWZkQVQAAAACeJxjZGD4/58BB2DCJUFDSQAdWgIIljzNzwAAAABJRU5ErkJggg==";
const JPEG_EXIF_ORIENTATION_6 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==";
const JPEG_LATE_EXIF_ORIENTATION_6 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2Q==";
const PNG_EXIF_ORIENTATION_6 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAGmVYSWZNTQAqAAAACAABARIAAwAAAAEABgAAAAAAANZnS2kAAAAQSURBVHicY/zPAAVMMAYDABMpAQPw2AeEAAAAAElFTkSuQmCC";
const WEBP_EXIF_ORIENTATION_6 = "data:image/webp;base64,UklGRnAAAABXRUJQVlA4WAoAAAAIAAAAAgAAAQAAVlA4IDAAAADQAQCdASoDAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAABFWElGGgAAAE1NACoAAAAIAAEBEgADAAAAAQAGAAAAAAAA";
const WEBP_EXIF_ORIENTATION_1 = "data:image/webp;base64,UklGRnAAAABXRUJQVlA4WAoAAAAIAAAAAgAAAQAAVlA4IDAAAADQAQCdASoDAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAABFWElGGgAAAE1NACoAAAAIAAEBEgADAAAAAQABAAAAAAAA";

function truncateDataUri(dataUri: string, byteLength: number): string {
  const separator = dataUri.indexOf(",");
  const prefix = dataUri.slice(0, separator + 1);
  const decoded = atob(dataUri.slice(separator + 1));
  return `${prefix}${btoa(decoded.slice(0, byteLength))}`;
}

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

  test("accepts a visible optional body and legacy questions without one", () => {
    const snapshot = initialSnapshot();
    expect(snapshot.questions[0]!.body).toBe("¿Cuál es la opción correcta?");
    expect(snapshot.questions[1]!.body).toBeUndefined();
    expect(validateSnapshot(snapshot).ok).toBe(true);
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

  test("accepts ordered tables, images, and diagrams with accessible metadata", () => {
    const snapshot = initialSnapshot();
    snapshot.questions[0]!.supportingContent = [
      {
        kind: "table",
        caption: "Comparación por período",
        columns: ["Período", "Importe"],
        rows: [["Año 1", "100"], ["Año 2", "125"]],
        rowHeaderColumn: 0
      },
      {
        kind: "image",
        dataUri: PNG_1X1,
        alt: "Punto de referencia azul sobre fondo transparente.",
        caption: "Referencia visual",
        width: 1,
        height: 1
      },
      {
        kind: "diagram",
        dataUri: PNG_1X1,
        alt: "Un nodo representa el inicio del proceso.",
        width: 1,
        height: 1
      }
    ];
    expect(validateSnapshot(snapshot).ok).toBe(true);
  });

  test("accepts genuine JPEG and WebP raster payloads", () => {
    for (const dataUri of [JPEG_2X3, WEBP_2X3]) {
      const snapshot = initialSnapshot();
      snapshot.questions[0]!.supportingContent = [{
        kind: "image",
        dataUri,
        alt: "Rectángulo azul de prueba.",
        width: 2,
        height: 3
      }];
      expect(validateSnapshot(snapshot).ok).toBe(true);
    }

    const normalizedWebp = initialSnapshot();
    normalizedWebp.questions[0]!.supportingContent = [{
      kind: "image",
      dataUri: WEBP_EXIF_ORIENTATION_1,
      alt: "Rectángulo WebP horizontal de prueba.",
      width: 3,
      height: 2
    }];
    expect(validateSnapshot(normalizedWebp).ok).toBe(true);
  });

  test("uses the displayed dimensions of EXIF-oriented JPEG and PNG images", () => {
    for (const dataUri of [JPEG_EXIF_ORIENTATION_6, PNG_EXIF_ORIENTATION_6]) {
      const snapshot = initialSnapshot();
      snapshot.questions[0]!.supportingContent = [{
        kind: "image",
        dataUri,
        alt: "Rectángulo orientado verticalmente.",
        width: 2,
        height: 3
      }];
      expect(validateSnapshot(snapshot).ok).toBe(true);
    }
  });

  test("revalidates mutable progress against a trusted module definition", () => {
    const snapshot = activeSnapshot();
    const context = createTrustedModuleValidationContext(snapshot);
    expect(validateTrustedProgressSnapshot(snapshot, context).ok).toBe(true);

    const replacedDefinition = { ...snapshot, module: { ...snapshot.module } };
    const result = validateTrustedProgressSnapshot(replacedDefinition, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) =>
        error.path === "$.module" && error.message.includes("por referencia"))).toBe(true);
    }
  });
});

describe("question body", () => {
  test("rejects blank, invisible, and oversized bodies", () => {
    const blank = initialSnapshot();
    blank.questions[0]!.body = " \n\t ";
    expectError(blank, "$.questions[0].body", "carácter visible");

    const invisible = initialSnapshot();
    invisible.questions[0]!.body = "\u200B\uFEFF";
    expectError(invisible, "$.questions[0].body", "carácter visible");

    const oversized = initialSnapshot();
    oversized.questions[0]!.body = "a".repeat(5001);
    expectError(oversized, "$.questions[0].body", "entre 1 y 5000");
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

  test("keeps every supporting-content variant closed", () => {
    const table = initialSnapshot();
    table.questions[0]!.supportingContent = [{
      kind: "table",
      caption: "Tabla",
      columns: ["A"],
      rows: [["1"]]
    }];
    (table.questions[0]!.supportingContent[0] as unknown as Record<string, unknown>).extra = true;
    expectError(table, "$.questions[0].supportingContent[0].extra", "no está permitida");

    const media = initialSnapshot();
    media.questions[0]!.supportingContent = [{
      kind: "image",
      dataUri: PNG_1X1,
      alt: "Imagen mínima",
      width: 1,
      height: 1
    }];
    (media.questions[0]!.supportingContent[0] as unknown as Record<string, unknown>).extra = true;
    expectError(media, "$.questions[0].supportingContent[0].extra", "no está permitida");
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

describe("supporting question content", () => {
  test("rejects empty, excessive, and unknown block lists", () => {
    const empty = initialSnapshot();
    empty.questions[0]!.supportingContent = [];
    expectError(empty, "$.questions[0].supportingContent", "entre 1 y 4");

    const excessive = initialSnapshot();
    const table = { kind: "table" as const, caption: "Tabla", columns: ["A"], rows: [["1"]] };
    excessive.questions[0]!.supportingContent = Array.from({ length: 5 }, () => clone(table));
    expectError(excessive, "$.questions[0].supportingContent", "entre 1 y 4");

    const unknown = initialSnapshot();
    (unknown.questions[0] as unknown as Record<string, unknown>).supportingContent = [{ kind: "video" }];
    expectError(unknown, "$.questions[0].supportingContent[0].kind", "table, image o diagram");
  });

  test("rejects non-rectangular and out-of-range tables", () => {
    const ragged = initialSnapshot();
    ragged.questions[0]!.supportingContent = [{
      kind: "table",
      caption: "Tabla irregular",
      columns: ["A", "B"],
      rows: [["1"]]
    }];
    expectError(ragged, "$.questions[0].supportingContent[0].rows[0]", "exactamente 2");

    const rowHeader = initialSnapshot();
    rowHeader.questions[0]!.supportingContent = [{
      kind: "table",
      caption: "Tabla",
      columns: ["A"],
      rows: [["1"]],
      rowHeaderColumn: 1
    }];
    expectError(rowHeader, "$.questions[0].supportingContent[0].rowHeaderColumn", "entre 0 y 0");
  });

  test("rejects external URLs, SVG, malformed base64, and MIME spoofing", () => {
    const invalidValues = [
      "https://example.com/image.png",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64,%%%",
      PNG_1X1.replace("image/png", "image/jpeg")
    ];
    for (const dataUri of invalidValues) {
      const snapshot = initialSnapshot();
      snapshot.questions[0]!.supportingContent = [{
        kind: "image",
        dataUri,
        alt: "Imagen de prueba",
        width: 1,
        height: 1
      }];
      expectError(snapshot, "$.questions[0].supportingContent[0].dataUri");
    }
  });

  test("requires useful alternative text and exact intrinsic dimensions", () => {
    const alt = initialSnapshot();
    alt.questions[0]!.supportingContent = [{
      kind: "diagram",
      dataUri: PNG_1X1,
      alt: "",
      width: 1,
      height: 1
    }];
    expectError(alt, "$.questions[0].supportingContent[0].alt", "entre 1 y 500");

    const whitespaceAlt = initialSnapshot();
    whitespaceAlt.questions[0]!.supportingContent = [{
      kind: "image",
      dataUri: PNG_1X1,
      alt: "   ",
      width: 1,
      height: 1
    }];
    expectError(whitespaceAlt, "$.questions[0].supportingContent[0].alt", "carácter visible");

    const invisibleAlt = initialSnapshot();
    invisibleAlt.questions[0]!.supportingContent = [{
      kind: "image",
      dataUri: PNG_1X1,
      alt: "\u200B",
      width: 1,
      height: 1
    }];
    expectError(invisibleAlt, "$.questions[0].supportingContent[0].alt", "carácter visible");

    for (const invisible of [
      "\u0000",
      "\u115F",
      "\u1160",
      "\u3164",
      "\uFE0F",
      "\uFFA0",
      "\u{E0001}"
    ]) {
      const formatOnlyAlt = initialSnapshot();
      formatOnlyAlt.questions[0]!.supportingContent = [{
        kind: "image",
        dataUri: PNG_1X1,
        alt: invisible,
        width: 1,
        height: 1
      }];
      expectError(formatOnlyAlt, "$.questions[0].supportingContent[0].alt", "carácter visible");
    }

    const whitespaceTable = initialSnapshot();
    whitespaceTable.questions[0]!.supportingContent = [{
      kind: "table",
      caption: "\t",
      columns: ["Encabezado", " "],
      rows: [["Dato", "1"]]
    }];
    expectError(whitespaceTable, "$.questions[0].supportingContent[0].caption", "carácter visible");
    expectError(whitespaceTable, "$.questions[0].supportingContent[0].columns[1]", "carácter visible");

    const dimensions = initialSnapshot();
    dimensions.questions[0]!.supportingContent = [{
      kind: "image",
      dataUri: PNG_1X1,
      alt: "Imagen mínima",
      width: 2,
      height: 1
    }];
    expectError(dimensions, "$.questions[0].supportingContent[0].width", "ancho real (1)");

    const orientedDimensions = initialSnapshot();
    orientedDimensions.questions[0]!.supportingContent = [{
      kind: "image",
      dataUri: JPEG_EXIF_ORIENTATION_6,
      alt: "Rectángulo orientado verticalmente.",
      width: 3,
      height: 2
    }];
    expectError(
      orientedDimensions,
      "$.questions[0].supportingContent[0].width",
      "ancho real (2)"
    );
  });

  test("rejects truncated raster containers even when their headers are intact", () => {
    const cases = [
      truncateDataUri(PNG_1X1, 33),
      truncateDataUri(JPEG_2X3, atob(JPEG_2X3.split(",")[1]!).length - 2),
      truncateDataUri(WEBP_2X3, atob(WEBP_2X3.split(",")[1]!).length - 2)
    ];

    for (const dataUri of cases) {
      const snapshot = initialSnapshot();
      snapshot.questions[0]!.supportingContent = [{
        kind: "image",
        dataUri,
        alt: "Imagen truncada de prueba",
        width: 1,
        height: 1
      }];
      expectError(snapshot, "$.questions[0].supportingContent[0].dataUri", "bytes no corresponden");
    }
  });

  test("rejects impossible raster payloads inside complete containers", () => {
    for (const dataUri of [INVALID_PNG_BITSTREAM, INVALID_JPEG_BITSTREAM, INVALID_WEBP_BITSTREAM]) {
      const snapshot = initialSnapshot();
      snapshot.questions[0]!.supportingContent = [{
        kind: "image",
        dataUri,
        alt: "Imagen imposible de prueba",
        width: 1,
        height: 1
      }];
      expectError(snapshot, "$.questions[0].supportingContent[0].dataUri", "bytes no corresponden");
    }
  });

  test("rejects animated PNG content", () => {
    const snapshot = initialSnapshot();
    snapshot.questions[0]!.supportingContent = [{
      kind: "diagram",
      dataUri: APNG_7X5,
      alt: "Dos cuadros animados de prueba",
      width: 7,
      height: 5
    }];
    expectError(snapshot, "$.questions[0].supportingContent[0].dataUri", "bytes no corresponden");
  });

  test("rejects WebP orientation metadata that browsers render inconsistently", () => {
    const snapshot = initialSnapshot();
    snapshot.questions[0]!.supportingContent = [{
      kind: "image",
      dataUri: WEBP_EXIF_ORIENTATION_6,
      alt: "Rectángulo WebP con orientación no normalizada.",
      width: 3,
      height: 2
    }];
    expectError(snapshot, "$.questions[0].supportingContent[0].dataUri", "bytes no corresponden");
  });

  test("rejects JPEG orientation metadata placed after image scan data", () => {
    const snapshot = initialSnapshot();
    snapshot.questions[0]!.supportingContent = [{
      kind: "image",
      dataUri: JPEG_LATE_EXIF_ORIENTATION_6,
      alt: "Rectángulo JPEG con orientación tardía.",
      width: 2,
      height: 3
    }];
    expectError(snapshot, "$.questions[0].supportingContent[0].dataUri", "bytes no corresponden");
  });

  test("enforces the decoded media budget before image parsing", () => {
    const snapshot = initialSnapshot();
    const decodedBytes = MAX_QUESTION_MEDIA_BYTES + 1;
    const base64 = "A".repeat((decodedBytes / 3) * 4);
    snapshot.questions[0]!.supportingContent = [{
      kind: "image",
      dataUri: `data:image/png;base64,${base64}`,
      alt: "Carga sobredimensionada",
      width: 1,
      height: 1
    }];
    expectError(snapshot, "$.questions[0].supportingContent[0].dataUri", "bytes decodificados");
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

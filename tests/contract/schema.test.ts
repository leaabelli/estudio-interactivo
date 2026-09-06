import { describe, expect, test } from "bun:test";

interface SchemaNode {
  type?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean | SchemaNode;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  $defs?: Record<string, SchemaNode>;
}

describe("canonical JSON Schema", () => {
  test("is valid JSON Schema 2020-12 with a closed root", async () => {
    const schema = (await Bun.file(new URL("../../schema/study-module.schema.json", import.meta.url)).json()) as SchemaNode & {
      $schema: string;
    };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["schemaVersion", "module", "questions", "progress"]);
  });

  test("closes every fixed-shape object and constrains the dynamic question map", async () => {
    const schema = (await Bun.file(new URL("../../schema/study-module.schema.json", import.meta.url)).json()) as SchemaNode;
    const fixedObjects = [
      "module",
      "option",
      "source",
      "questionTable",
      "questionMedia",
      "question",
      "optionAnswer",
      "dontKnowAnswer",
      "questionProgress",
      "runFilters",
      "runItem",
      "activeRun",
      "completedRun",
      "difficultySummary",
      "priorRunSummary",
      "progress"
    ];
    for (const name of fixedObjects) {
      expect(schema.$defs?.[name]?.type, name).toBe("object");
      expect(schema.$defs?.[name]?.additionalProperties, name).toBe(false);
    }
    const questionMap = schema.$defs?.progress?.properties?.questions;
    expect(typeof questionMap?.additionalProperties).toBe("object");
  });

  test("requires visible table and media descriptions", async () => {
    const schema = (await Bun.file(new URL("../../schema/study-module.schema.json", import.meta.url)).json()) as SchemaNode;
    const tablePattern = schema.$defs?.questionTable?.properties?.caption?.pattern;
    const mediaPattern = schema.$defs?.questionMedia?.properties?.alt?.pattern;
    expect(typeof tablePattern).toBe("string");
    expect(typeof mediaPattern).toBe("string");
    for (const pattern of [tablePattern!, mediaPattern!]) {
      const visible = new RegExp(pattern, "u");
      expect(visible.test("Texto visible")).toBe(true);
      expect(visible.test("😀")).toBe(true);
      for (const invisible of ["\u115F", "\u1160", "\u3164", "\uFFA0", "\u{E0001}"]) {
        expect(visible.test(invisible)).toBe(false);
      }
    }
  });

  test("defines an optional visible body for the question statement", async () => {
    const schema = (await Bun.file(new URL("../../schema/study-module.schema.json", import.meta.url)).json()) as SchemaNode;
    const question = schema.$defs?.question;
    const body = question?.properties?.body;
    expect(question?.required).not.toContain("body");
    expect(body?.type).toBe("string");
    expect(body?.minLength).toBe(1);
    expect(body?.maxLength).toBe(5000);
    expect(new RegExp(body?.pattern ?? "", "u").test("Enunciado visible")).toBe(true);
    expect(new RegExp(body?.pattern ?? "", "u").test("\u200B\uFEFF")).toBe(false);
    expect(new RegExp(body?.pattern ?? "", "u").test("\u0301")).toBe(false);
  });
});

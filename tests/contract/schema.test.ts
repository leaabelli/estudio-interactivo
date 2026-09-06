import { describe, expect, test } from "bun:test";

interface SchemaNode {
  type?: string;
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
});


import { describe, expect, test } from "bun:test";
import {
  canonicalStringify,
  canonicalUtf8ByteLength,
  canonicalUtf8Bytes,
  type CanonicalJsonValue
} from "../../src/domain/canonical";

describe("canonical JSON", () => {
  test("sorts object keys recursively and never appends a newline", () => {
    const value = { z: 1, a: { y: true, b: null }, m: [3, 2, 1] };
    const serialized = canonicalStringify(value);
    expect(serialized).toBe('{"a":{"b":null,"y":true},"m":[3,2,1],"z":1}');
    expect(serialized.endsWith("\n")).toBe(false);
  });

  test("uses ECMAScript/JCS number formatting", () => {
    expect(
      canonicalStringify({ numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27, -0] })
    ).toBe('{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0]}');
  });

  test("orders property names by UTF-16 code units", () => {
    const value = { "€": 1, "\r": 2, "דּ": 3, "1": 4, "😀": 5, "\u0080": 6, "ö": 7 };
    expect(canonicalStringify(value)).toBe('{"\\r":2,"1":4,"":6,"ö":7,"€":1,"😀":5,"דּ":3}');
  });

  test("normalizes string-keyed Maps as objects", () => {
    const value = new Map<string, CanonicalJsonValue>([
      ["z", 2],
      ["a", new Map<string, CanonicalJsonValue>([["b", "texto"]])]
    ]);
    expect(canonicalStringify(value)).toBe('{"a":{"b":"texto"},"z":2}');
  });

  test("reports exact UTF-8 bytes", () => {
    const value = { emoji: "😀" };
    const bytes = canonicalUtf8Bytes(value);
    expect(new TextDecoder().decode(bytes)).toBe('{"emoji":"😀"}');
    expect(canonicalUtf8ByteLength(value)).toBe(bytes.byteLength);
    expect(bytes.byteLength).toBe(16);
  });

  test("rejects values outside the supported JSON subset", () => {
    expect(() => canonicalStringify({ number: Number.NaN })).toThrow("finite numbers");
    expect(() => canonicalStringify({ number: Number.POSITIVE_INFINITY })).toThrow("finite numbers");
    expect(() => canonicalStringify({ broken: "\ud800" })).toThrow("unpaired high surrogate");
    expect(() => canonicalStringify(new Date() as unknown as CanonicalJsonValue)).toThrow("plain objects");

    const sparse = new Array<CanonicalJsonValue>(2);
    sparse[1] = true;
    expect(() => canonicalStringify(sparse)).toThrow("sparse arrays");

    const cyclic: { self?: CanonicalJsonValue } = {};
    cyclic.self = cyclic as CanonicalJsonValue;
    expect(() => canonicalStringify(cyclic as CanonicalJsonValue)).toThrow("cyclic references");
  });
});


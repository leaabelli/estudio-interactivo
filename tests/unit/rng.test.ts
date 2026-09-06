import { describe, expect, test } from "bun:test";
import {
  deterministicShuffle,
  fisherYates,
  fnv1aUtf8,
  mulberry32
} from "../../src/domain/rng";

describe("mulberry32", () => {
  test("matches the contractual seed 0 vectors", () => {
    const random = mulberry32(0);
    expect(random()).toBeCloseTo(0.2664292087, 10);
    expect(random()).toBeCloseTo(0.0003297457, 10);
    expect(random()).toBeCloseTo(0.2232720274, 10);
  });

  test("matches the contractual seed 1 vectors", () => {
    const random = mulberry32(1);
    expect(random()).toBeCloseTo(0.6270739406, 10);
    expect(random()).toBeCloseTo(0.0027357212, 10);
    expect(random()).toBeCloseTo(0.52744704, 10);
  });
});

describe("fnv1aUtf8", () => {
  test("matches every contractual UTF-8 vector", () => {
    expect(fnv1aUtf8("q1")).toBe(2622263703);
    expect(fnv1aUtf8("pregunta-01")).toBe(506011741);
    expect(fnv1aUtf8("demo.facil.001")).toBe(682481706);
  });

  test("hashes Unicode by UTF-8 bytes and replaces lone surrogates", () => {
    expect(fnv1aUtf8("contabilidad 📚")).toBe(2707544993);
    expect(fnv1aUtf8("é")).toBe(513665217);
    expect(fnv1aUtf8("\ud800")).toBe(fnv1aUtf8("�"));
  });
});

describe("Fisher-Yates", () => {
  test("uses exactly n-1 draws and does not mutate its input", () => {
    const original = [1, 2, 3, 4, 5];
    let draws = 0;
    const shuffled = fisherYates(original, () => {
      draws += 1;
      return 0;
    });

    expect(draws).toBe(4);
    expect(original).toEqual([1, 2, 3, 4, 5]);
    expect(shuffled).toEqual([2, 3, 4, 5, 1]);
  });

  test("is deterministic and preserves each value exactly once", () => {
    const values = Array.from({ length: 100 }, (_, index) => index);
    const first = deterministicShuffle(values, 123456);
    const second = deterministicShuffle(values, 123456);
    expect(first).toEqual(second);
    expect([...first].sort((a, b) => a - b)).toEqual(values);
  });

  test("rejects an invalid random source", () => {
    expect(() => fisherYates([1, 2], () => 1)).toThrow(RangeError);
  });
});

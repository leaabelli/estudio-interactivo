/** A deterministic random source that returns values in [0, 1). */
export type RandomSource = () => number;

const UINT32_RANGE = 0x1_0000_0000;

/**
 * Normative Mulberry32 implementation. The seed and all internal operations are
 * reduced to unsigned 32-bit integers.
 */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/**
 * FNV-1a over UTF-8 bytes. Lone UTF-16 surrogates are encoded as U+FFFD, which
 * matches the replacement behavior of the platform UTF-8 encoder without
 * depending on a browser API.
 */
export function fnv1aUtf8(input: string): number {
  let hash = 0x811c9dc5;

  const addByte = (byte: number): void => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };

  for (const symbol of input) {
    let codePoint = symbol.codePointAt(0) ?? 0xfffd;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      addByte(codePoint);
    } else if (codePoint <= 0x7ff) {
      addByte(0xc0 | (codePoint >>> 6));
      addByte(0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      addByte(0xe0 | (codePoint >>> 12));
      addByte(0x80 | ((codePoint >>> 6) & 0x3f));
      addByte(0x80 | (codePoint & 0x3f));
    } else {
      addByte(0xf0 | (codePoint >>> 18));
      addByte(0x80 | ((codePoint >>> 12) & 0x3f));
      addByte(0x80 | ((codePoint >>> 6) & 0x3f));
      addByte(0x80 | (codePoint & 0x3f));
    }
  }

  return hash >>> 0;
}

/** Fisher-Yates with exactly one random draw for every index n-1 through 1. */
export function fisherYates<T>(values: readonly T[], random: RandomSource): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index >= 1; index -= 1) {
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
      throw new RangeError("The random source must return a finite value in [0, 1).");
    }

    const swapIndex = Math.floor(draw * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex] as T;
    shuffled[swapIndex] = current as T;
  }

  return shuffled;
}

export function deterministicShuffle<T>(values: readonly T[], seed: number): T[] {
  return fisherYates(values, mulberry32(seed));
}

/**
 * JSON values accepted by the portable v1 contract.
 *
 * `Map` is accepted as an input convenience and normalized to a JSON object.
 * The serialized form itself is always ordinary JSON.
 */
export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue }
  | ReadonlyMap<string, CanonicalJsonValue>;

const encoder = new TextEncoder();

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("Canonical JSON cannot contain an unpaired high surrogate");
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("Canonical JSON cannot contain an unpaired low surrogate");
    }
  }
}

function quote(value: string): string {
  assertUnicodeScalarString(value);
  return JSON.stringify(value);
}

function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function serialize(
  value: CanonicalJsonValue,
  ancestors: Set<object>
): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return quote(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new TypeError("Canonical JSON only supports finite numbers");
      }
      // JSON.stringify implements ECMAScript NumberToString, including -0 -> 0,
      // which is the number representation required by RFC 8785/JCS.
      return JSON.stringify(value);
    }
    case "object":
      break;
    default:
      throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON cannot contain cyclic references");
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new TypeError("Canonical JSON cannot contain sparse arrays");
        }
        parts.push(serialize(value[index] as CanonicalJsonValue, ancestors));
      }
      return `[${parts.join(",")}]`;
    }

    let entries: Array<[string, CanonicalJsonValue]>;
    if (value instanceof Map) {
      entries = [];
      for (const [key, entryValue] of value) {
        if (typeof key !== "string") {
          throw new TypeError("Canonical JSON Map keys must be strings");
        }
        entries.push([key, entryValue]);
      }
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Canonical JSON objects must be plain objects or Maps");
      }
      entries = Object.keys(value).map((key) => [key, value[key] as CanonicalJsonValue]);
    }

    entries.sort(([left], [right]) => compareUtf16(left, right));
    return `{${entries
      .map(([key, entryValue]) => `${quote(key)}:${serialize(entryValue, ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Deterministic RFC 8785/JCS-style JSON for the JSON subset used by v1.
 * There is deliberately no final newline.
 */
export function canonicalStringify(value: CanonicalJsonValue): string {
  return serialize(value, new Set<object>());
}

export function canonicalUtf8Bytes(value: CanonicalJsonValue): Uint8Array {
  return encoder.encode(canonicalStringify(value));
}

export function canonicalUtf8ByteLength(value: CanonicalJsonValue): number {
  return canonicalUtf8Bytes(value).byteLength;
}


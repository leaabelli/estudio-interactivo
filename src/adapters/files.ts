import type { StudySnapshot } from "../domain/types";
import { canonicalStringify, type CanonicalJsonValue } from "../domain/canonical";

export const MAX_PORTABLE_FILE_BYTES = 10 * 1024 * 1024;

export type SaveSnapshotFileResult =
  | {
      status: "confirmed";
      method: "file-system-access";
      fileName: string;
      bytes: number;
      snapshotHash: string;
    }
  | {
      status: "attempted";
      method: "download";
      fileName: string;
      bytes: number;
      snapshotHash: string;
    }
  | {
      status: "cancelled";
      method: "file-system-access";
      fileName: string;
      bytes: number;
      snapshotHash: string;
    };

interface WritableFileLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?: () => Promise<void>;
}

interface FileHandleLike {
  name?: string;
  createWritable(): Promise<WritableFileLike>;
}

interface SaveFilePickerOptionsLike {
  suggestedName: string;
  types: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

type ShowSaveFilePickerLike = (options: SaveFilePickerOptionsLike) => Promise<FileHandleLike>;

/** RFC 8785 JSON Canonicalization Scheme for already validated JSON data. */
export function canonicalJson(value: unknown): string {
  return canonicalStringify(value as CanonicalJsonValue);
}

function toHex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotateRight(value: number, distance: number): number {
  return (value >>> distance) | (value << (32 - distance));
}

/** Small dependency-free fallback for contexts where SubtleCrypto is absent. */
function sha256Fallback(source: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((source.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.byteLength] = 0x80;
  const paddedView = new DataView(padded.buffer);
  const bitLength = source.byteLength * 8;
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = paddedView.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const prior15 = words[index - 15] as number;
      const prior2 = words[index - 2] as number;
      const sigma0 = rotateRight(prior15, 7) ^ rotateRight(prior15, 18) ^ (prior15 >>> 3);
      const sigma1 = rotateRight(prior2, 17) ^ rotateRight(prior2, 19) ^ (prior2 >>> 10);
      words[index] = ((words[index - 16] as number) + sigma0 + (words[index - 7] as number) + sigma1) >>> 0;
    }

    let a = hash[0] as number;
    let b = hash[1] as number;
    let c = hash[2] as number;
    let d = hash[3] as number;
    let e = hash[4] as number;
    let f = hash[5] as number;
    let g = hash[6] as number;
    let h = hash[7] as number;
    for (let index = 0; index < 64; index += 1) {
      const upperE = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + upperE + choose + (SHA256_CONSTANTS[index] as number) + (words[index] as number)) >>> 0;
      const upperA = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (upperA + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = ((hash[0] as number) + a) >>> 0;
    hash[1] = ((hash[1] as number) + b) >>> 0;
    hash[2] = ((hash[2] as number) + c) >>> 0;
    hash[3] = ((hash[3] as number) + d) >>> 0;
    hash[4] = ((hash[4] as number) + e) >>> 0;
    hash[5] = ((hash[5] as number) + f) >>> 0;
    hash[6] = ((hash[6] as number) + g) >>> 0;
    hash[7] = ((hash[7] as number) + h) >>> 0;
  }

  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  hash.forEach((word, index) => outputView.setUint32(index * 4, word, false));
  return output;
}

export async function snapshotHash(snapshot: StudySnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(snapshot));
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle
    ? new Uint8Array(await subtle.digest("SHA-256", bytes))
    : sha256Fallback(bytes);
  return toHex(digest);
}

function safeModuleFileName(snapshot: StudySnapshot): string {
  const stem = snapshot.module.id
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "modulo-estudio"}.study.json`;
}

function isAbortError(error: unknown): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

/**
 * Saves a canonical portable snapshot. A picker completion is confirmed; the
 * anchor fallback can truthfully report only that a download was attempted.
 */
export async function saveSnapshotFile(snapshot: StudySnapshot): Promise<SaveSnapshotFileResult> {
  const text = canonicalJson(snapshot);
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength > MAX_PORTABLE_FILE_BYTES) {
    throw new RangeError("El módulo portable supera el máximo de 10 MiB.");
  }
  const fileName = safeModuleFileName(snapshot);
  const hash = await snapshotHash(snapshot);
  const blob = new Blob([encoded], { type: "application/json;charset=utf-8" });
  const picker = (globalThis as typeof globalThis & { showSaveFilePicker?: ShowSaveFilePickerLike }).showSaveFilePicker;

  if (picker) {
    let writable: WritableFileLike | null = null;
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [{ description: "Módulo de Estudio", accept: { "application/json": [".study.json", ".json"] } }]
      });
      writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return {
        status: "confirmed",
        method: "file-system-access",
        fileName: handle.name ?? fileName,
        bytes: encoded.byteLength,
        snapshotHash: hash
      };
    } catch (error) {
      if (isAbortError(error)) {
        return {
          status: "cancelled",
          method: "file-system-access",
          fileName,
          bytes: encoded.byteLength,
          snapshotHash: hash
        };
      }
      if (writable?.abort) {
        try {
          await writable.abort();
        } catch {
          // The original write error remains the actionable failure.
        }
      }
      throw error;
    }
  }

  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Este entorno no puede iniciar una descarga de archivo.");
  }
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    const parent = document.body ?? document.documentElement;
    parent.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return {
    status: "attempted",
    method: "download",
    fileName,
    bytes: encoded.byteLength,
    snapshotHash: hash
  };
}

/** Decode/parse once; structural and business validation belongs to the import boundary. */
export async function readSnapshotFile(file: Blob): Promise<unknown> {
  if (file.size > MAX_PORTABLE_FILE_BYTES) throw new RangeError("El archivo supera el máximo de 10 MiB.");
  const source = new Uint8Array(await file.arrayBuffer());
  const offset = source.length >= 3 && source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf ? 3 : 0;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source.subarray(offset));
  } catch {
    throw new TypeError("El archivo no contiene UTF-8 válido.");
  }
  return JSON.parse(text) as unknown;
}

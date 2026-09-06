import { afterEach, describe, expect, test } from "bun:test";
import {
  MAX_PORTABLE_FILE_BYTES,
  canonicalJson,
  readSnapshotFile,
  saveSnapshotFile,
  snapshotHash
} from "../../src/adapters/files";
import { makeSnapshot } from "../unit/fixtures";

const pickerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "showSaveFilePicker");
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

afterEach(() => {
  restoreGlobal("showSaveFilePicker", pickerDescriptor);
  restoreGlobal("document", documentDescriptor);
  restoreGlobal("crypto", cryptoDescriptor);
  if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
  if (revokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
});

describe("portable JSON", () => {
  test("canonicalizes object keys recursively with no final newline", () => {
    const result = canonicalJson({ z: -0, b: 2, a: [3, { x: "é", a: true }] });
    expect(result).toBe('{"a":[3,{"a":true,"x":"é"}],"b":2,"z":0}');
    expect(result.endsWith("\n")).toBe(false);
    expect(() => canonicalJson({ invalid: Number.NaN })).toThrow("finite numbers");
  });

  test("hashes canonical snapshots deterministically", async () => {
    const snapshot = makeSnapshot();
    const first = await snapshotHash(snapshot);
    const second = await snapshotHash(structuredClone(snapshot));
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { subtle: undefined }
    });
    expect(await snapshotHash(snapshot)).toBe(first);
  });

  test("strips one UTF-8 BOM and rejects invalid UTF-8 or oversized files", async () => {
    const json = new TextEncoder().encode('{"ok":true}');
    const withBom = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), json]);
    expect(await readSnapshotFile(withBom)).toEqual({ ok: true });
    await expect(readSnapshotFile(new Blob([new Uint8Array([0xc3, 0x28])]))).rejects.toThrow("UTF-8");
    await expect(readSnapshotFile(new Blob([new Uint8Array(MAX_PORTABLE_FILE_BYTES + 1)]))).rejects.toThrow(
      "10 MiB"
    );
  });
});

describe("saveSnapshotFile", () => {
  test("reports confirmed only after the File System Access write closes", async () => {
    let written: Blob | null = null;
    let closed = false;
    Object.defineProperty(globalThis, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        name: "elegido.study.json",
        async createWritable() {
          return {
            async write(blob: Blob) {
              written = blob;
            },
            async close() {
              closed = true;
            }
          };
        }
      })
    });

    const snapshot = makeSnapshot();
    const result = await saveSnapshotFile(snapshot);
    expect(result).toMatchObject({
      status: "confirmed",
      method: "file-system-access",
      fileName: "elegido.study.json"
    });
    expect(closed).toBe(true);
    expect(written).not.toBeNull();
    expect(await written!.text()).toBe(canonicalJson(snapshot));
  });

  test("treats a cancelled picker as cancellation and records no false success", async () => {
    Object.defineProperty(globalThis, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        throw error;
      }
    });
    expect(await saveSnapshotFile(makeSnapshot())).toMatchObject({
      status: "cancelled",
      method: "file-system-access"
    });
  });

  test("reports only attempted for the anchor-download fallback", async () => {
    Reflect.deleteProperty(globalThis, "showSaveFilePicker");
    let clicked = 0;
    let revoked = 0;
    const anchor = {
      href: "",
      download: "",
      hidden: false,
      click() {
        clicked += 1;
      },
      remove() {}
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => anchor,
        body: { append: () => undefined },
        documentElement: { append: () => undefined }
      }
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:test" });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => {
        revoked += 1;
      }
    });

    const result = await saveSnapshotFile(makeSnapshot());
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(result).toMatchObject({ status: "attempted", method: "download" });
    expect(clicked).toBe(1);
    expect(revoked).toBe(1);
  });

  test("rejects an oversized export before attempting a save", async () => {
    const snapshot = makeSnapshot();
    snapshot.module.description = "x".repeat(MAX_PORTABLE_FILE_BYTES + 1);
    await expect(saveSnapshotFile(snapshot)).rejects.toThrow("10 MiB");
  });

  test("aborts a failed picker write and propagates the original failure", async () => {
    let aborted = 0;
    Object.defineProperty(globalThis, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        async createWritable() {
          return {
            async write() {
              throw new Error("disk full");
            },
            async close() {},
            async abort() {
              aborted += 1;
            }
          };
        }
      })
    });
    await expect(saveSnapshotFile(makeSnapshot())).rejects.toThrow("disk full");
    expect(aborted).toBe(1);
  });

  test("fails truthfully when neither a picker nor a document is available", async () => {
    Reflect.deleteProperty(globalThis, "showSaveFilePicker");
    Reflect.deleteProperty(globalThis, "document");
    await expect(saveSnapshotFile(makeSnapshot())).rejects.toThrow("no puede iniciar");
  });

  test("revokes the temporary URL when the fallback click fails", async () => {
    Reflect.deleteProperty(globalThis, "showSaveFilePicker");
    let revoked = 0;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => ({
          href: "",
          download: "",
          hidden: false,
          click() {
            throw new Error("blocked click");
          },
          remove() {}
        }),
        body: { append: () => undefined },
        documentElement: { append: () => undefined }
      }
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:test" });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => {
        revoked += 1;
      }
    });
    await expect(saveSnapshotFile(makeSnapshot())).rejects.toThrow("blocked click");
    expect(revoked).toBe(1);
  });
});

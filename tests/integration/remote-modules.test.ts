import { describe, expect, test } from "bun:test";
import { MAX_PORTABLE_FILE_BYTES } from "../../src/adapters/files";
import { readRemoteSnapshot, type RemoteModuleFetch } from "../../src/adapters/remote-modules";

const URL = "https://example.org/materia.study.json";
const validResponse = () => new Response('{"module":{"title":"Práctica"}}');

describe("remote module downloads", () => {
  test("requests only public CORS content without credentials or referrer", async () => {
    let requestedUrl = "";
    let request: RequestInit | undefined;
    const fetch: RemoteModuleFetch = async (url, options) => {
      requestedUrl = url;
      request = options;
      return validResponse();
    };
    expect(await readRemoteSnapshot(` ${URL}#position `, { fetch })).toEqual({ module: { title: "Práctica" } });
    expect(requestedUrl).toBe(URL);
    expect(request).toMatchObject({ method: "GET", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  test("rejects insecure, local, malformed and credential-bearing URLs before fetching", async () => {
    let requests = 0;
    const fetch: RemoteModuleFetch = async () => { requests += 1; return validResponse(); };
    for (const url of ["http://example.org/a.json", "file:///a.json", "data:application/json,{}", "/a.json", "https://user:password@example.org/a.json"]) {
      await expect(readRemoteSnapshot(url, { fetch })).rejects.toThrow();
    }
    expect(requests).toBe(0);
  });

  test("loads a standard GitHub study file link through its public raw URL", async () => {
    let requestedUrl = "";
    await readRemoteSnapshot("https://github.com/person/study-bank/blob/main/modules/contabilidad.study.json?plain=1#L1", {
      fetch: async (url) => { requestedUrl = url; return validResponse(); },
    });
    expect(requestedUrl).toBe("https://raw.githubusercontent.com/person/study-bank/main/modules/contabilidad.study.json");
  });

  test("does not rewrite unrelated hosts or ambiguous GitHub paths", async () => {
    for (const original of [
      "https://example.org/person/repo/blob/main/test.study.json",
      "https://github.com.example.org/person/repo/blob/main/test.study.json",
      "https://github.com:8443/person/repo/blob/main/test.study.json",
      "https://github.com/person/repo/tree/main/test.study.json",
      "https://github.com/person/repo/blob/main/README.md",
      "https://github.com/person/repo/blob/test.study.json",
    ]) {
      let requestedUrl = "";
      await readRemoteSnapshot(original, {
        fetch: async (url) => { requestedUrl = url; return validResponse(); },
      });
      expect(requestedUrl).toBe(original);
    }
  });

  test("rejects a redirect ending on HTTP", async () => {
    const response = validResponse();
    Object.defineProperty(response, "url", { value: "http://example.org/a.json" });
    await expect(readRemoteSnapshot(URL, { fetch: async () => response })).rejects.toThrow("HTTPS");
  });

  test("makes server and CORS failures actionable", async () => {
    await expect(readRemoteSnapshot(URL, { fetch: async () => new Response("missing", { status: 404 }) })).rejects.toThrow("404");
    await expect(readRemoteSnapshot(URL, { fetch: async () => { throw new TypeError("Failed to fetch"); } })).rejects.toThrow("descargá el archivo en tu dispositivo y usá Elegir archivo");
  });

  test("rejects web pages instead of suggesting that their content is a module", async () => {
    await expect(readRemoteSnapshot(URL, { fetch: async () => new Response("<html>Login</html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }) })).rejects.toThrow("página web");
    await expect(readRemoteSnapshot(URL, { fetch: async () => new Response("not json") })).rejects.toThrow("descarga directa");
  });

  test("uses the same UTF-8 and BOM handling as local imports", async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"ok":true}')]);
    expect(await readRemoteSnapshot(URL, { fetch: async () => new Response(withBom) })).toEqual({ ok: true });
    await expect(readRemoteSnapshot(URL, { fetch: async () => new Response(new Uint8Array([0xc3, 0x28])) })).rejects.toThrow("UTF-8");
  });

  test("rejects declared oversize before reading the stream", async () => {
    let startedReading = false;
    const response = new Response("{}", { headers: { "Content-Length": String(MAX_PORTABLE_FILE_BYTES + 1) } });
    const getReader = response.body!.getReader.bind(response.body);
    Object.defineProperty(response.body, "getReader", { value: () => { startedReading = true; return getReader(); } });
    await expect(readRemoteSnapshot(URL, { fetch: async () => response })).rejects.toThrow("10 MiB");
    expect(startedReading).toBe(false);
  });

  test("enforces actual streamed length even when declared length is missing or false", async () => {
    for (const declared of [undefined, "2"]) {
      let cancelled = false;
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent > 1) return;
          controller.enqueue(new Uint8Array(MAX_PORTABLE_FILE_BYTES / 2 + sent));
          sent += 1;
        },
        cancel() { cancelled = true; },
      });
      const response = new Response(stream, declared ? { headers: { "Content-Length": declared } } : undefined);
      await expect(readRemoteSnapshot(URL, { fetch: async () => response })).rejects.toThrow("10 MiB");
      expect(cancelled).toBe(true);
    }
  });

  test("accepts the exact byte limit without truncating the JSON", async () => {
    const json = `"${"x".repeat(MAX_PORTABLE_FILE_BYTES - 2)}"`;
    const result = await readRemoteSnapshot(URL, {
      fetch: async () => new Response(json, { headers: { "Content-Length": String(MAX_PORTABLE_FILE_BYTES) } }),
    });
    expect(typeof result).toBe("string");
    expect((result as string).length).toBe(MAX_PORTABLE_FILE_BYTES - 2);
  });

  test("times out a fetch even if a transport does not honor abort", async () => {
    let signal: AbortSignal | null | undefined;
    const fetch: RemoteModuleFetch = async (_, options) => {
      signal = options.signal;
      return new Promise<Response>(() => undefined);
    };
    await expect(readRemoteSnapshot(URL, { fetch, timeoutMs: 5 })).rejects.toThrow("tardó demasiado");
    expect(signal?.aborted).toBe(true);
  });

  test("also times out and cancels a stalled response body", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    await expect(readRemoteSnapshot(URL, { fetch: async () => new Response(stream), timeoutMs: 5 })).rejects.toThrow("tardó demasiado");
    expect(cancelled).toBe(true);
  });

  test("reports interrupted streams without exposing network internals", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("internal detail")); } });
    await expect(readRemoteSnapshot(URL, { fetch: async () => new Response(stream) })).rejects.toThrow("No se pudo descargar");
  });

  test("does not treat parsing as installation or semantic validation", async () => {
    expect(await readRemoteSnapshot(URL, { fetch: async () => new Response('{"untrusted":true}') })).toEqual({ untrusted: true });
  });
});

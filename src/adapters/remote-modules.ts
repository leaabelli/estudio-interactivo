import { MAX_PORTABLE_FILE_BYTES, readSnapshotFile } from "./files";

export type RemoteModuleFetch = (url: string, options: RequestInit) => Promise<Response>;

export interface RemoteModuleOptions {
  fetch?: RemoteModuleFetch;
  timeoutMs?: number;
}

const NETWORK_HELP = "No se pudo descargar el módulo. Revisá la conexión y el enlace. Algunos sitios bloquean la descarga desde otras páginas; en ese caso, descargá el archivo en tu dispositivo y usá Elegir archivo.";

class RemoteModuleError extends Error {}

function publicHttpsUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new RemoteModuleError("Ingresá un enlace completo que empiece con https:// y apunte al archivo .study.json.");
  }
  if (url.protocol !== "https:") {
    throw new RemoteModuleError("El enlace debe usar HTTPS. Si el archivo está en tu dispositivo, usá Elegir archivo.");
  }
  if (url.username || url.password) {
    throw new RemoteModuleError("Usá un enlace público, sin usuario ni contraseña en la dirección.");
  }
  url.hash = "";
  return url;
}

function downloadUrl(url: URL): URL {
  if (url.host !== "github.com") return url;
  const file = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/blob\/(.+\/.+\.study\.json)$/.exec(url.pathname);
  if (!file) return url;
  // GitHub's file viewer is HTML; its public raw endpoint serves the JSON.
  return new URL(`https://raw.githubusercontent.com/${file[1]}/${file[2]}/${file[3]}`);
}

/** Downloads only; the caller must validate and preview before installing. */
export async function readRemoteSnapshot(input: string, options: RemoteModuleOptions = {}): Promise<unknown> {
  const url = downloadUrl(publicHttpsUrl(input));
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new RangeError("El tiempo límite de descarga debe estar entre 1 y 60000 milisegundos.");
  }
  const fetchModule = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RemoteModuleError("La descarga tardó demasiado. Volvé a intentarlo o descargá el archivo y usá Elegir archivo."));
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    }, timeoutMs);
  });
  const bounded = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, deadline]);
  let complete = false;
  try {
    const response = await bounded(fetchModule(url.href, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      redirect: "follow",
      headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.1" },
      signal: controller.signal,
    }));
    if (response.type === "opaque" || response.type === "opaqueredirect") {
      throw new RemoteModuleError(NETWORK_HELP);
    }
    if (response.url) publicHttpsUrl(response.url);
    if (!response.ok) {
      throw new RemoteModuleError(`El servidor respondió con error ${response.status}. Revisá que el enlace sea público y descargue el archivo directamente; también podés usar Elegir archivo.`);
    }
    if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      throw new RemoteModuleError("El enlace muestra una página web, no el archivo de preguntas. Usá el enlace de descarga directa del .study.json.");
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > MAX_PORTABLE_FILE_BYTES) {
      throw new RemoteModuleError("El archivo supera el máximo de 10 MiB.");
    }
    if (!response.body) {
      throw new RemoteModuleError("El enlace no devolvió un archivo. Usá un enlace de descarga directa del .study.json.");
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteCount = 0;
    while (true) {
      const { done, value } = await bounded(reader.read());
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_PORTABLE_FILE_BYTES) {
        throw new RemoteModuleError("El archivo supera el máximo de 10 MiB.");
      }
      chunks.push(value.slice());
    }
    let parsed: unknown;
    try {
      parsed = await bounded(readSnapshotFile(new Blob(chunks)));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new RemoteModuleError("El enlace no entrega un JSON válido. Usá el enlace de descarga directa del .study.json, no la página que lo muestra.");
      }
      if (error instanceof TypeError) throw new RemoteModuleError(error.message);
      throw error;
    }
    complete = true;
    return parsed;
  } catch (error) {
    if (error instanceof RemoteModuleError) throw error;
    throw new RemoteModuleError(NETWORK_HELP);
  } finally {
    clearTimeout(timer!);
    if (!complete) {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    }
    reader?.releaseLock();
  }
}

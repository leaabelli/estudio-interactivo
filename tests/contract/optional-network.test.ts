import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { verifyArtifact } from "../../scripts/verify-artifact";

function artifact(options: { script?: string; styles?: string; shell?: string } = {}): string {
  const script = options.script ?? 'const example = "https://example.com/preguntas.study.json";';
  const styles = options.styles ?? "body{color:#202124}";
  const hash = (value: string) => `'sha256-${createHash("sha256").update(value).digest("base64")}'`;
  const csp = `default-src 'none'; script-src ${hash(script)}; style-src ${hash(styles)}; img-src data:; font-src data:; connect-src https:; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${styles}</style></head><body><main id="app" data-boot-fallback>este visor no permite usar la aplicación directamente en Safari. Si recibiste solo este archivo, pedí el enlace web</main>${options.shell ?? ""}<script>${script}</script></body></html>`;
}

describe("optional HTTPS import artifact boundary", () => {
  test("allows URL examples without creating a remote application dependency", () => {
    expect(verifyArtifact(artifact())).toEqual([]);
    expect(verifyArtifact(artifact({ shell: '<img src="data:image/png;base64,AA==">' }))).toEqual([]);
  });

  test("retains strict script, style, image, frame and connection policies", () => {
    for (const [from, to] of [
      ["connect-src https:", "connect-src *"],
      ["img-src data:", "img-src data: https:"],
      ["font-src data:", "font-src https:"],
      ["default-src 'none'", "default-src https:"],
      ["object-src 'none'", "object-src https:"],
      ["form-action 'none'", "form-action https:"],
      ["base-uri 'none'", "base-uri https:"],
    ]) {
      expect(verifyArtifact(artifact().replace(from!, to!)).length).toBeGreaterThan(0);
    }
    expect(verifyArtifact(artifact().replace('content="default-src', 'content="frame-src https:; default-src')).length).toBeGreaterThan(0);
    expect(verifyArtifact(artifact().replace("const example", "const changed"))).toContain("política CSP inesperada: script-src");
    expect(verifyArtifact(artifact().replace("color:#202124", "color:red"))).toContain("política CSP inesperada: style-src");
  });

  test("rejects external or relative resources and automatic redirects", () => {
    for (const shell of [
      '<img src="https://example.com/image.png">',
      '<img src="//example.com/image.png">',
      '<img src="image.png">',
      '<img src=https://example.com/image.png>',
      '<link rel="preconnect" href="https://example.com">',
      '<link rel="stylesheet" href="app.css">',
      '<source srcset="https://example.com/image.png 2x">',
      '<video poster="https://example.com/image.png"></video>',
      '<iframe src="https://example.com"></iframe>',
      '<meta http-equiv="refresh" content="0;url=https://example.com">',
      '<script src="https://example.com/app.js"></script>',
    ]) {
      expect(verifyArtifact(artifact({ shell })).length).toBeGreaterThan(0);
    }
  });

  test("rejects CSS network dependencies but allows embedded fonts", () => {
    expect(verifyArtifact(artifact({ styles: '@font-face{font-family:app;src:url(data:font/woff2;base64,AA==)}' }))).toEqual([]);
    for (const styles of [
      'body{background:url("https://example.com/bg.png")}',
      "body{background:url(bg.png)}",
      '@import "https://example.com/app.css";',
    ]) {
      expect(verifyArtifact(artifact({ styles })).length).toBeGreaterThan(0);
    }
  });

  test("does not permit other network or background cache APIs", () => {
    for (const script of [
      'navigator.sendBeacon("https://example.com", "value");',
      'new WebSocket("wss://example.com");',
      'new EventSource("https://example.com");',
      "new XMLHttpRequest();",
      'navigator.serviceWorker.register("worker.js");',
    ]) {
      expect(verifyArtifact(artifact({ script }))).toContain("API de red/cache no permitida");
    }
  });
});

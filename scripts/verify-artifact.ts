import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Check packaged resources; explicit HTTPS module imports are optional. */
export function verifyArtifact(html: string): string[] {
  const failures: string[] = [];
  const bootFallbackIndex = html.indexOf("data-boot-fallback");
  const scriptIndex = html.indexOf("<script>");
  const script = /<script>([\s\S]*?)<\/script>/i.exec(html)?.[1] ?? "";
  const styles = /<style>([\s\S]*?)<\/style>/i.exec(html)?.[1] ?? "";
  const shell = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  if (!html.startsWith("<!doctype html>")) failures.push("falta doctype");
  if (!html.includes("id=\"app\"")) failures.push("falta raíz de aplicación");
  if (bootFallbackIndex === -1) failures.push("falta protección para visores que no arrancan");
  else if (scriptIndex !== -1 && bootFallbackIndex > scriptIndex) failures.push("la protección de arranque debe existir antes del script");
  if (!html.includes("este visor no permite usar la aplicación")) failures.push("falta mensaje de visor incompatible");
  if (!html.includes("directamente en Safari")) failures.push("falta instrucción de apertura en Safari");
  if (!html.includes("Si recibiste solo este archivo, pedí el enlace web")) failures.push("falta alternativa cuando solo se recibió el archivo");
  if ((html.match(/<script\b/gi) ?? []).length !== 1 || !script) failures.push("debe existir un único script inline");
  if ((html.match(/<style\b/gi) ?? []).length !== 1 || !styles) failures.push("debe existir un único estilo inline");

  const csp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?>/i.exec(html)?.[1];
  const policies = new Map<string, string>();
  for (const directive of csp?.split(";") ?? []) {
    const [name, ...values] = directive.trim().split(/\s+/);
    if (!name) continue;
    if (policies.has(name)) failures.push(`directiva CSP repetida: ${name}`);
    policies.set(name, values.join(" "));
  }
  const hash = (value: string) => `'sha256-${createHash("sha256").update(value, "utf8").digest("base64")}'`;
  const expectedPolicies = new Map([
    ["default-src", "'none'"],
    ["script-src", hash(script)],
    ["style-src", hash(styles)],
    ["img-src", "data:"],
    ["font-src", "data:"],
    ["connect-src", "https:"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'none'"],
  ]);
  if (!csp) failures.push("falta CSP");
  for (const [name, value] of expectedPolicies) {
    if (policies.get(name) !== value) failures.push(`política CSP inesperada: ${name}`);
  }
  for (const name of policies.keys()) {
    if (!expectedPolicies.has(name)) failures.push(`directiva CSP no prevista: ${name}`);
  }

  // Inspect the HTML shell and CSS, not URL examples inside the bundled code.
  // Passive resources must stay embedded; only the explicit import uses HTTPS.
  for (const tag of shell.match(/<(?:link|img|source|video|audio|track|input|image|use)\b[^>]*>/gi) ?? []) {
    for (const attribute of tag.matchAll(/\b(?:src|href|poster|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const value = attribute[1] ?? attribute[2] ?? attribute[3] ?? "";
      if (!/^(?:data:|#|$)/i.test(value)) failures.push("recurso de aplicación no embebido");
    }
    if (/\bsrcset\s*=/i.test(tag)) failures.push("srcset no permitido en el artefacto");
  }
  if (/<(?:iframe|frame|object|embed|base)\b/i.test(shell)) failures.push("contenido externo incrustado no permitido");
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b/i.test(shell)) failures.push("redirección automática no permitida");
  if (/@import\b/i.test(styles)) failures.push("importación CSS no permitida");
  for (const match of styles.matchAll(/url\(\s*['"]?([^)'"\s]+)/gi)) {
    if (!/^(?:data:|#)/i.test(match[1]!)) failures.push("recurso CSS no embebido");
  }
  if (/serviceWorker|navigator\.sendBeacon|\b(?:WebSocket|EventSource|XMLHttpRequest)\s*\(/.test(script)) failures.push("API de red/cache no permitida");
  if (/__(CSP|STYLES|SCRIPT)__/.test(html)) failures.push("marcador de build sin reemplazar");
  return failures;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const path = resolve(root, "index.html");
  const html = await readFile(path, "utf8");
  const failures = verifyArtifact(html);
  if (failures.length) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exit(1);
  }
  console.log(`Artefacto válido: ${path} (${Buffer.byteLength(html)} bytes, recursos embebidos e importación HTTPS opcional).`);
}

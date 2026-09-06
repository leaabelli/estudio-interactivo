import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const path = resolve(root, "index.html");
const html = await readFile(path, "utf8");
const failures: string[] = [];
const bootFallbackIndex = html.indexOf("data-boot-fallback");
const scriptIndex = html.indexOf("<script>");

if (!html.startsWith("<!doctype html>")) failures.push("falta doctype");
if (!html.includes("Content-Security-Policy")) failures.push("falta CSP");
if (!html.includes("id=\"app\"")) failures.push("falta raíz de aplicación");
if (bootFallbackIndex === -1) failures.push("falta protección para visores que no arrancan");
else if (scriptIndex !== -1 && bootFallbackIndex > scriptIndex) failures.push("la protección de arranque debe existir antes del script");
if (!html.includes("este visor no permite usar la aplicación")) failures.push("falta mensaje de visor incompatible");
if (!html.includes("directamente en Safari")) failures.push("falta instrucción de apertura en Safari");
if (!html.includes("Si recibiste solo este archivo, pedí el enlace web")) failures.push("falta alternativa cuando solo se recibió el archivo");
if ((html.match(/<script/g) ?? []).length !== 1) failures.push("debe existir un único script inline");
if ((html.match(/<style/g) ?? []).length !== 1) failures.push("debe existir un único estilo inline");
if (/<(?:script|link|img|source)[^>]+(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html)) failures.push("referencia externa ejecutable");
if (/https?:\/\//i.test(html)) failures.push("URL http(s) encontrada");
if (/serviceWorker|navigator\.sendBeacon|new\s+WebSocket|EventSource\s*\(/.test(html)) failures.push("API de red/cache no permitida");
if (/__(CSP|STYLES|SCRIPT)__/.test(html)) failures.push("marcador de build sin reemplazar");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Artefacto válido: ${path} (${Buffer.byteLength(html)} bytes, cero referencias http(s)).`);

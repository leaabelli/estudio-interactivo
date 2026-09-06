import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const path = resolve(root, "index.html");
const html = await readFile(path, "utf8");
const failures: string[] = [];

if (!html.startsWith("<!doctype html>")) failures.push("falta doctype");
if (!html.includes("Content-Security-Policy")) failures.push("falta CSP");
if (!html.includes("id=\"app\"")) failures.push("falta raíz de aplicación");
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


import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

async function fontFace(
  family: string,
  weight: string,
  relativePath: string,
): Promise<string> {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) return "";
  const bytes = await readFile(path);
  return `@font-face{font-family:${JSON.stringify(family)};font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2")}`;
}

const result = await Bun.build({
  entrypoints: [resolve(root, "src/index.ts")],
  target: "browser",
  format: "iife",
  minify: true,
  sourcemap: "none",
  splitting: false,
});

if (!result.success || result.outputs.length !== 1) {
  for (const log of result.logs) console.error(log);
  throw new Error("No se pudo generar el bundle autocontenido.");
}

const script = await result.outputs[0]!.text();
const fontCss = [
  await fontFace("Atkinson Hyperlegible", "400", "assets/fonts/AtkinsonHyperlegible-Regular.woff2"),
  await fontFace("Atkinson Hyperlegible", "700", "assets/fonts/AtkinsonHyperlegible-Bold.woff2"),
  await fontFace("Source Serif 4", "200 900", "assets/fonts/SourceSerif4-Variable.woff2"),
].filter(Boolean).join("\n");
const baseCss = await readFile(resolve(root, "src/styles/app.css"), "utf8");
const styles = `${fontCss}${fontCss ? "\n" : ""}${baseCss.trim()}\n`;
const csp = [
  "default-src 'none'",
  `script-src 'sha256-${sha256(script)}'`,
  `style-src 'sha256-${sha256(styles)}'`,
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const template = await readFile(resolve(root, "src/template.html"), "utf8");
const html = template
  .replace("__CSP__", () => csp)
  .replace("__STYLES__", () => styles)
  .replace("__SCRIPT__", () => script)
  .replace(/\r\n/g, "\n");

const unresolvedMarker = /__(CSP|STYLES|SCRIPT)__/.exec(html);
if (unresolvedMarker) {
  throw new Error(`Quedó un marcador sin reemplazar en index.html: ${unresolvedMarker[0]}`);
}

await writeFile(resolve(root, "index.html"), html, "utf8");
console.log(`index.html generado (${Buffer.byteLength(html)} bytes)`);

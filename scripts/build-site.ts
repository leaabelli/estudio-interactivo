import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const site = resolve(root, "site");
const files = [
  { source: "index.html", target: "index.html" },
  { source: "output/pdf/manual-usuario.pdf", target: "manual-usuario.pdf" },
  { source: "modulo-prueba.study.json", target: "modulo-prueba.study.json" },
];

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
for (const file of files) await cp(resolve(root, file.source), resolve(site, file.target));

const actual = (await readdir(site)).sort();
const expected = files.map((file) => file.target).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Artefacto Pages inesperado: ${actual.join(", ")}`);
}

console.log(`Sitio listo: ${site} (${actual.join(", ")})`);

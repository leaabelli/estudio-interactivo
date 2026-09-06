import {
  MAX_SOURCE_FILE_BYTES,
  parseSnapshotText
} from "../src/domain/validation";

function usage(): never {
  console.error("Uso: bun run scripts/validate-module.ts <archivo.study.json>");
  process.exit(2);
}

const filePath = process.argv[2];
if (!filePath || process.argv.length !== 3) usage();

const file = Bun.file(filePath);
if (!(await file.exists())) {
  console.error(`No existe el archivo: ${filePath}`);
  process.exit(2);
}
if (file.size > MAX_SOURCE_FILE_BYTES) {
  console.error(`Archivo inválido:\n- $: el archivo supera ${MAX_SOURCE_FILE_BYTES} bytes`);
  process.exit(1);
}

let bytes: Uint8Array;
try {
  bytes = new Uint8Array(await file.arrayBuffer());
} catch (error) {
  console.error(`No se pudo leer ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const result = parseSnapshotText(bytes);
if (!result.ok) {
  console.error(`Módulo inválido (${result.errors.length} error${result.errors.length === 1 ? "" : "es"}):`);
  for (const error of result.errors) {
    console.error(`- ${error.path}: ${error.message}`);
  }
  process.exit(1);
}

console.log(
  `Módulo válido: ${result.value.module.title} — ${result.value.questions.length} pregunta${
    result.value.questions.length === 1 ? "" : "s"
  }, revisión de contenido ${result.value.module.contentRevision}, revisión de estado ${result.value.progress.stateRevision}.`
);


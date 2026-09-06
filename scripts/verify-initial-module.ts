import { canonicalStringify, type CanonicalJsonValue } from "../src/domain/canonical";
import type { Difficulty, StudySnapshot } from "../src/domain/types";
import { MAX_SOURCE_FILE_BYTES, parseSnapshotText } from "../src/domain/validation";

export function verifyGeneratedInitial(snapshot: StudySnapshot, sourceText: string): string[] {
  const issues: string[] = [];
  if (snapshot.module.contentRevision !== 1) issues.push("module.contentRevision debe ser 1 en el primer módulo");
  if (snapshot.module.id.length > 52) issues.push("module.id no puede superar 52 caracteres con el patrón de IDs generado");
  if (snapshot.progress.stateRevision !== 0) issues.push("progress.stateRevision debe ser 0");

  const counters: Record<Difficulty, number> = { facil: 0, medio: 0, dificil: 0, experto: 0 };
  for (const question of snapshot.questions) {
    counters[question.difficulty] += 1;
    const expectedId = `${snapshot.module.id}.${question.difficulty}.${String(counters[question.difficulty]).padStart(3, "0")}`;
    if (question.id !== expectedId) issues.push(`${question.id}: se esperaba el ID ${expectedId}`);
    if (question.revision !== 1) issues.push(`${question.id}: revision debe ser 1`);
    if (!question.source?.label || !question.source.reference) {
      issues.push(`${question.id}: source.label y source.reference son obligatorios`);
    }
  }

  try {
    const canonical = canonicalStringify(snapshot as unknown as CanonicalJsonValue);
    if (sourceText !== canonical) issues.push("el archivo debe usar JSON canónico, sin BOM, sangría ni salto final");
  } catch (error) {
    issues.push(`no se pudo serializar canónicamente: ${error instanceof Error ? error.message : String(error)}`);
  }
  return issues;
}

function usage(): never {
  console.error("Uso: bun run scripts/verify-initial-module.ts <archivo.study.json>");
  process.exit(2);
}

if (import.meta.main) {
  const filePath = process.argv[2];
  if (!filePath || process.argv.length !== 3) usage();
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    console.error(`No existe el archivo: ${filePath}`);
    process.exit(2);
  }
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    console.error(`Módulo inicial inválido:\n- el archivo supera ${MAX_SOURCE_FILE_BYTES} bytes`);
    process.exit(1);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseSnapshotText(bytes);
  if (!parsed.ok) {
    console.error(`Módulo inicial inválido (${parsed.errors.length} errores de contrato):`);
    for (const error of parsed.errors) console.error(`- ${error.path}: ${error.message}`);
    process.exit(1);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const issues = verifyGeneratedInitial(parsed.value, text);
  if (issues.length) {
    console.error(`Módulo inicial inválido (${issues.length} ${issues.length === 1 ? "problema" : "problemas"} de generación):`);
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log(`Módulo inicial reproducible: ${parsed.value.module.title} — ${parsed.value.questions.length} preguntas con fuente y progreso vacío.`);
}


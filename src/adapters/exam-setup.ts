import { parseExamSetup, type ExamSetup } from "../domain/exam-setup";

const keyFor = (moduleId: string) => `estudio-interactivo.exam-setup.v1.${encodeURIComponent(moduleId)}`;

export function loadExamSetup(moduleId: string, storage?: Pick<Storage, "getItem">): ExamSetup | null {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(keyFor(moduleId));
    if (!raw || raw.length > 2_000_000) return null;
    return parseExamSetup(JSON.parse(raw));
  } catch { return null; }
}

export function saveExamSetup(moduleId: string, setup: ExamSetup, storage?: Pick<Storage, "setItem">): boolean {
  try {
    const parsed = parseExamSetup(setup);
    if (!parsed) return false;
    (storage ?? globalThis.localStorage).setItem(keyFor(moduleId), JSON.stringify(parsed));
    return true;
  } catch { return false; }
}

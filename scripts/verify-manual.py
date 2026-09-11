#!/usr/bin/env python3
"""Structural checks for the rendered user manual."""

from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "output" / "pdf" / "manual-usuario.pdf"


def main() -> None:
    failures: list[str] = []
    if not PDF.exists():
        raise SystemExit(f"No existe el manual: {PDF}")
    if PDF.stat().st_size < 100_000:
        failures.append("el PDF parece incompleto por su tamaño")

    reader = PdfReader(str(PDF))
    if len(reader.pages) != 9:
        failures.append(f"cantidad de páginas inesperada: {len(reader.pages)}")
    if reader.is_encrypted:
        failures.append("el manual no debe estar cifrado")
    metadata = reader.metadata
    if metadata is None or metadata.title != "Estudio Interactivo - Manual de uso":
        failures.append("título de metadatos ausente o incorrecto")

    text = " ".join("\n".join(page.extract_text() or "" for page in reader.pages).split())
    for expected in [
        "Cargá tus preguntas",
        "Prepará un examen",
        "Respondé a tu ritmo",
        "Aprendé de la corrección",
        "Mirá cómo venís",
        "Guardá y continuá después",
        "Sumá tus propios tests",
        "Usalo desde el celular",
        "Compartí un test por enlace",
        "Cargar módulo",
        "Cargar desde enlace",
        "Guardar archivo",
        ".study.json",
        "repositorio público de GitHub",
        "modulos/materia/",
        "Commit changes",
        "sin progreso",
        "Por rama:",
        "Por commit:",
        "El enlace no sincroniza el progreso",
        "No subas tus archivos con progreso a GitHub",
    ]:
        if expected not in text:
            failures.append(f"falta contenido de uso: {expected}")
    for technical_detail in ["site/index.html", "bun run", "schemaVersion", "moduleRevision", "IndexedDB"]:
        if technical_detail in text:
            failures.append(f"detalle de desarrollo fuera del manual de uso: {technical_detail}")

    if len(reader.pages) >= 9:
        creation_page = " ".join((reader.pages[6].extract_text() or "").split())
        sharing_page = " ".join((reader.pages[8].extract_text() or "").split())
        if "seguí la página 9" not in creation_page:
            failures.append("la página 7 no remite a la guía de publicación de la página 9")
        if "9. Compartí un test por enlace" not in sharing_page:
            failures.append("la guía de publicación no comienza en la página 9")

    image_pages = 0
    web_links: set[str] = set()
    for page_number, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        if f"{page_number}. " not in page_text:
            failures.append(f"página {page_number}: el paso no coincide con su página")
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        if abs(width - 595.276) > 1 or abs(height - 841.89) > 1:
            failures.append(f"página {page_number}: tamaño no A4 ({width:.1f} x {height:.1f})")
        if len((page.extract_text() or "").strip()) < 80:
            failures.append(f"página {page_number}: texto vacío o insuficiente")
        resources = page["/Resources"].get_object() if "/Resources" in page else {}
        xobjects = resources.get("/XObject", {}).get_object() if "/XObject" in resources else {}
        if any(obj.get_object().get("/Subtype") == "/Image" for obj in xobjects.values()):
            image_pages += 1
        for annotation in page.get("/Annots", []):
            action = annotation.get_object().get("/A")
            if action is not None:
                action = action.get_object()
                if action.get("/S") not in {"/URI", "/GoTo"}:
                    failures.append(f"página {page_number}: acción no permitida")
                if action.get("/S") == "/URI" and not str(action.get("/URI", "")).startswith(("https://", "http://")):
                    failures.append(f"página {page_number}: enlace no web")
                if action.get("/S") == "/URI":
                    web_links.add(str(action.get("/URI", "")))
    if image_pages < 5:
        failures.append(f"faltan capturas de la app: solo {image_pages} páginas ilustradas")
    example_path = "modulos/informacion-financiera/informacion-financiera-ampliado.study.json"
    for expected_link in [
        f"https://github.com/leaabelli/estudio-interactivo/blob/main/{example_path}",
        f"https://raw.githubusercontent.com/leaabelli/estudio-interactivo/refs/heads/main/{example_path}",
    ]:
        if expected_link not in web_links:
            failures.append(f"falta el enlace del ejemplo público: {expected_link}")

    raw = PDF.read_bytes()
    if any(token in raw for token in [b"/JavaScript", b"/OpenAction", b"/Launch", b"/EmbeddedFile", b"/RichMedia"]):
        failures.append("el PDF contiene acciones ejecutables")

    if failures:
        raise SystemExit("Manual inválido:\n- " + "\n- ".join(failures))
    print(f"Manual válido: {PDF} ({len(reader.pages)} páginas A4, {image_pages} con capturas, {PDF.stat().st_size} bytes).")


if __name__ == "__main__":
    main()

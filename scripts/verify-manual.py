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
    if PDF.stat().st_size < 15_000:
        failures.append("el PDF parece incompleto por su tamaño")

    reader = PdfReader(str(PDF))
    if not 5 <= len(reader.pages) <= 8:
        failures.append(f"cantidad de páginas inesperada: {len(reader.pages)}")
    metadata = reader.metadata
    if metadata is None or metadata.title != "Estudio Interactivo - Manual de uso":
        failures.append("título de metadatos ausente o incorrecto")

    text = " ".join("\n".join(page.extract_text() or "" for page in reader.pages).split())
    for expected in [
        "Empezar en dos minutos",
        "Preparar un examen modelo",
        "Leer resultados y progreso",
        "Crear nuevos módulos de preguntas",
        "Resolver problemas frecuentes",
        "GitHub Pages",
        "site/index.html",
        "El módulo de prueba y el manual quedan fuera del deploy",
    ]:
        if expected not in text:
            failures.append(f"falta la sección: {expected}")

    for page_number, page in enumerate(reader.pages, start=1):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        if abs(width - 595.276) > 1 or abs(height - 841.89) > 1:
            failures.append(f"página {page_number}: tamaño no A4 ({width:.1f} x {height:.1f})")

    raw = PDF.read_bytes()
    if b"/JavaScript" in raw or b"/OpenAction" in raw:
        failures.append("el PDF contiene acciones ejecutables")

    if failures:
        raise SystemExit("Manual inválido:\n- " + "\n- ".join(failures))
    print(f"Manual válido: {PDF} ({len(reader.pages)} páginas A4, {PDF.stat().st_size} bytes).")


if __name__ == "__main__":
    main()

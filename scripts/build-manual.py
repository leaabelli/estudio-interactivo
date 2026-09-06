#!/usr/bin/env python3
"""Build the Spanish user manual as a deterministic, visually checked PDF."""

from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "manual-usuario.md"
OUTPUT = ROOT / "output" / "pdf" / "manual-usuario.pdf"
PAGE_WIDTH, PAGE_HEIGHT = A4
INK = colors.HexColor("#13243e")
MUTED = colors.HexColor("#526170")
PAPER = colors.HexColor("#fffdf8")
CANVAS = colors.HexColor("#f5f1e8")
ACCENT = colors.HexColor("#a9520a")
ACCENT_SOFT = colors.HexColor("#f3e1cf")
LINE = colors.HexColor("#d7d0c4")


SANS = "Helvetica"
SANS_BOLD = "Helvetica-Bold"
SERIF = "Times-Bold"


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=22 * mm,
            rightMargin=22 * mm,
            topMargin=23 * mm,
            bottomMargin=20 * mm,
            title="Estudio Interactivo - Manual de uso",
            author="Proyecto Estudio Interactivo",
            subject="Guia de uso offline, progreso y modulos portables",
            invariant=True,
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="body",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(PageTemplate(id="manual", frames=[frame], onPage=self._decorate_page))
        self._bookmark_counter = 0

    def _decorate_page(self, canvas, doc) -> None:
        canvas.saveState()
        canvas.setFillColor(PAPER)
        canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
        if doc.page > 1:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.7)
            canvas.line(22 * mm, PAGE_HEIGHT - 15 * mm, PAGE_WIDTH - 22 * mm, PAGE_HEIGHT - 15 * mm)
            canvas.setFillColor(MUTED)
            canvas.setFont(SANS_BOLD, 8.2)
            canvas.drawString(22 * mm, PAGE_HEIGHT - 11.5 * mm, "ESTUDIO INTERACTIVO")
            canvas.setFont(SANS, 8.2)
            canvas.drawRightString(PAGE_WIDTH - 22 * mm, PAGE_HEIGHT - 11.5 * mm, "MANUAL DE USO")
        canvas.setFillColor(MUTED)
        canvas.setFont(SANS, 8.2)
        canvas.drawString(22 * mm, 11.5 * mm, "Offline y portable")
        canvas.drawRightString(PAGE_WIDTH - 22 * mm, 11.5 * mm, f"{doc.page:02d}")
        canvas.restoreState()

    def afterFlowable(self, flowable) -> None:
        if not isinstance(flowable, Paragraph) or flowable.style.name not in {"H1", "H2", "H3"}:
            return
        self._bookmark_counter += 1
        key = f"heading-{self._bookmark_counter}"
        level = {"H1": 0, "H2": 0, "H3": 1}[flowable.style.name]
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(flowable.getPlainText(), key, level=level, closed=False)


def styles() -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    return {
        "CoverTitle": ParagraphStyle(
            "CoverTitle", parent=sample["Title"], fontName=SERIF, fontSize=31, leading=35,
            textColor=INK, alignment=TA_LEFT, spaceAfter=8 * mm,
        ),
        "CoverMeta": ParagraphStyle(
            "CoverMeta", parent=sample["Normal"], fontName=SANS_BOLD, fontSize=11, leading=15,
            textColor=ACCENT, spaceAfter=4 * mm,
        ),
        "CoverBody": ParagraphStyle(
            "CoverBody", parent=sample["Normal"], fontName=SANS, fontSize=14, leading=20,
            textColor=INK, spaceAfter=8 * mm,
        ),
        "H1": ParagraphStyle(
            "H1", parent=sample["Heading1"], fontName=SERIF, fontSize=24, leading=28,
            textColor=INK, spaceBefore=0, spaceAfter=7 * mm, keepWithNext=True,
        ),
        "H2": ParagraphStyle(
            "H2", parent=sample["Heading2"], fontName=SERIF, fontSize=18, leading=22,
            textColor=INK, spaceBefore=5 * mm, spaceAfter=3 * mm, keepWithNext=True,
        ),
        "H3": ParagraphStyle(
            "H3", parent=sample["Heading3"], fontName=SANS_BOLD, fontSize=12.5, leading=16,
            textColor=ACCENT, spaceBefore=4 * mm, spaceAfter=2 * mm, keepWithNext=True,
        ),
        "Body": ParagraphStyle(
            "Body", parent=sample["BodyText"], fontName=SANS, fontSize=9.5, leading=13.6,
            textColor=INK, spaceAfter=2.3 * mm, allowWidows=0, allowOrphans=0,
        ),
        "Bullet": ParagraphStyle(
            "Bullet", parent=sample["BodyText"], fontName=SANS, fontSize=9.4, leading=13.3,
            textColor=INK, leftIndent=5 * mm, firstLineIndent=-3.5 * mm, bulletIndent=0,
            spaceAfter=1.25 * mm,
        ),
        "Number": ParagraphStyle(
            "Number", parent=sample["BodyText"], fontName=SANS, fontSize=9.4, leading=13.3,
            textColor=INK, leftIndent=7 * mm, firstLineIndent=-5 * mm, bulletIndent=0,
            spaceAfter=1.4 * mm,
        ),
        "Callout": ParagraphStyle(
            "Callout", parent=sample["BodyText"], fontName=SANS, fontSize=9.5, leading=14,
            textColor=INK, backColor=ACCENT_SOFT, borderColor=ACCENT, borderWidth=1,
            borderPadding=(7, 9, 7, 11), leftIndent=2 * mm, rightIndent=2 * mm,
            spaceBefore=2 * mm, spaceAfter=4 * mm,
        ),
        "Code": ParagraphStyle(
            "Code", parent=sample["Code"], fontName="Courier", fontSize=8.2, leading=11.5,
            textColor=INK, backColor=CANVAS, borderColor=LINE, borderWidth=0.7,
            borderPadding=7, leftIndent=2 * mm, rightIndent=2 * mm, spaceAfter=3 * mm,
        ),
        "TableHead": ParagraphStyle(
            "TableHead", parent=sample["BodyText"], fontName=SANS_BOLD, fontSize=8.7, leading=11.5,
            textColor=colors.white,
        ),
        "TableCell": ParagraphStyle(
            "TableCell", parent=sample["BodyText"], fontName=SANS, fontSize=8.4, leading=11.5,
            textColor=INK,
        ),
    }


STYLES = styles()


def inline(text: str) -> str:
    value = html.escape(text.strip())
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"`(.+?)`", r'<font name="Courier" size="8.3">\1</font>', value)
    return value


def table_from(lines: list[str]) -> Table:
    rows: list[list[Paragraph]] = []
    for index, line in enumerate(lines):
        if index == 1 and set(line.replace("|", "").replace("-", "").replace(" ", "")) == set():
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        style = STYLES["TableHead"] if not rows else STYLES["TableCell"]
        rows.append([Paragraph(inline(cell), style) for cell in cells])
    count = len(rows[0])
    available = PAGE_WIDTH - 44 * mm
    if count == 2:
        widths = [available * 0.31, available * 0.69]
    elif count == 3:
        widths = [available * 0.24, available * 0.35, available * 0.41]
    else:
        widths = [available / count] * count
    table = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.55, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PAPER, CANVAS]),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def build_story(source: str) -> list:
    lines = source.splitlines()
    story: list = []
    paragraph: list[str] = []
    index = 0
    cover = True

    def flush_paragraph() -> None:
        if paragraph:
            story.append(Paragraph(inline(" ".join(part.strip() for part in paragraph)), STYLES["Body"]))
            paragraph.clear()

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            index += 1
            continue
        if stripped == "<!-- pagebreak -->":
            flush_paragraph()
            story.append(PageBreak())
            cover = False
            index += 1
            continue
        if stripped.startswith("```"):
            flush_paragraph()
            code_lines: list[str] = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index])
                index += 1
            story.append(Paragraph("<br/>".join(html.escape(part) for part in code_lines), STYLES["Code"]))
            index += 1
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            flush_paragraph()
            table_lines: list[str] = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index].strip())
                index += 1
            story.extend([table_from(table_lines), Spacer(1, 4 * mm)])
            continue
        if stripped.startswith("# "):
            flush_paragraph()
            title = stripped[2:].strip()
            if cover:
                story.extend([
                    Spacer(1, 28 * mm),
                    Paragraph("ESTUDIO INTERACTIVO", STYLES["CoverMeta"]),
                    Paragraph(inline(title), STYLES["CoverTitle"]),
                ])
            else:
                story.append(Paragraph(inline(title), STYLES["H1"]))
            index += 1
            continue
        if stripped.startswith("## "):
            flush_paragraph()
            story.append(Paragraph(inline(stripped[3:]), STYLES["H2"]))
            index += 1
            continue
        if stripped.startswith("### "):
            flush_paragraph()
            story.append(Paragraph(inline(stripped[4:]), STYLES["H3"]))
            index += 1
            continue
        if stripped.startswith("> "):
            flush_paragraph()
            story.append(Paragraph(inline(stripped[2:]), STYLES["Callout"]))
            index += 1
            continue
        unordered = re.match(r"^-\s+(.+)$", stripped)
        ordered = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if unordered:
            flush_paragraph()
            story.append(Paragraph(inline(unordered.group(1)), STYLES["Bullet"], bulletText="•"))
            index += 1
            continue
        if ordered:
            flush_paragraph()
            story.append(Paragraph(inline(ordered.group(2)), STYLES["Number"], bulletText=f"{ordered.group(1)}."))
            index += 1
            continue
        if cover:
            flush_paragraph()
            style = STYLES["CoverMeta"] if "version" in stripped.lower() else STYLES["CoverBody"]
            if stripped.startswith("**"):
                style = STYLES["Callout"]
            story.append(Paragraph(inline(stripped), style))
            index += 1
            continue
        paragraph.append(stripped)
        index += 1

    flush_paragraph()
    return story


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    source = SOURCE.read_text(encoding="utf-8")
    doc = ManualDocTemplate(str(OUTPUT))
    story = build_story(source)
    doc.build(story)
    print(f"Manual generado: {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

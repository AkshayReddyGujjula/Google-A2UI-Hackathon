"""Generate demo assignment PDFs from the brief.md in each demo_tests/<name>/ dir.

Run once (regenerate after editing a brief):
    agent/.venv/Scripts/python.exe scripts/make_demo_pdfs.py
"""
from __future__ import annotations

import re
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "demo_tests"


def _ascii(s: str) -> str:
    repl = {"→": "->", "—": "-", "–": "-", "‘": "'", "’": "'",
            "“": '"', "”": '"', "…": "...", "×": "x"}
    for k, v in repl.items():
        s = s.replace(k, v)
    return s.encode("latin-1", "replace").decode("latin-1")


def render(md: str, out: Path) -> None:
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(True, margin=18)
    pdf.add_page()
    pdf.set_margins(20, 18, 20)
    in_code = False
    for raw in md.splitlines():
        line = _ascii(raw.rstrip())
        if line.strip().startswith("```"):
            in_code = not in_code
            pdf.ln(2)
            continue
        if in_code:
            pdf.set_font("Courier", size=9.5)
            pdf.set_text_color(40, 40, 60)
            pdf.multi_cell(0, 5, line or " ", new_x="LMARGIN", new_y="NEXT")
            continue
        pdf.set_text_color(20, 20, 24)
        if line.startswith("# "):
            pdf.set_font("Helvetica", "B", 17)
            pdf.multi_cell(0, 9, line[2:], new_x="LMARGIN", new_y="NEXT")
            pdf.ln(1)
        elif line.startswith("## "):
            pdf.set_font("Helvetica", "B", 13)
            pdf.ln(1)
            pdf.multi_cell(0, 7, line[3:], new_x="LMARGIN", new_y="NEXT")
        elif line.startswith("### "):
            pdf.set_font("Helvetica", "B", 11)
            pdf.multi_cell(0, 6, line[4:], new_x="LMARGIN", new_y="NEXT")
        elif not line.strip():
            pdf.ln(3)
        else:
            text = re.sub(r"\*\*(.+?)\*\*", r"\1", line)
            text = re.sub(r"`(.+?)`", r"\1", text)
            pdf.set_font("Helvetica", size=11)
            if text.lstrip().startswith("- "):
                text = "  - " + text.lstrip()[2:]
            pdf.multi_cell(0, 6, text, new_x="LMARGIN", new_y="NEXT")
    pdf.output(str(out))
    print("wrote", out.relative_to(ROOT))


def main() -> None:
    for d in sorted(DEMO.iterdir()):
        brief = d / "brief.md"
        if brief.exists():
            render(brief.read_text(encoding="utf-8"), d / "assignment.pdf")


if __name__ == "__main__":
    main()

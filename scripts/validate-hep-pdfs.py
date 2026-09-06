#!/usr/bin/env python3
"""Check exported HEP PDF text and pagination; requires only pypdf and Python stdlib.

Example: python validate_hep_pdfs.py ./exports --programs ./scripts/hep-programs.json
This complements rendered-page review; text extraction cannot prove visual legibility.
"""

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

from pypdf import PdfReader


PROGRAM_FIELDS = (
    "title", "fitIntro", "fit", "assessFirst", "redFlags", "programHeading",
    "programIntro", "frequency", "equipment", "checkpoint", "goal",
    "responseIntro", "green", "yellow", "red", "evaluation",
)
EXERCISE_FIELDS = ("name", "dose", "frequency", "how", "easier", "harder")
MARGIN_FOOTER = "Jeremy Swisher, MD - Home exercise program"
PAGE_NUMBER = re.compile(r"\bPage\s+(\d+)\s+of\s+(\d+)")
PROGRESSION_HEADING = "Build capacity in stages."
READINESS_HEADING = "Signs you are ready for the next stage"
TRACKER_HEADING = "Progress tracker"
CONTACT_FOOTER = "Questions? Call UCLA Orthopedics at 310-319-1234."
EMERGENCY_DISCLOSURE = (
    "General education only, not individualized medical advice. "
    "For a medical emergency, call 911."
)


def normalize(text):
    # PDF extraction may insert or omit spaces at line wraps and between glyphs.
    # Ignore whitespace, but retain letters, digits, punctuation, and their order.
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text).replace("\u00ad", ""))


def expected_fields(program):
    fields = {key: program[key] for key in PROGRAM_FIELDS}
    for index, exercise in enumerate(program["exercises"], 1):
        fields.update({f"exercise {index}.{key}": exercise[key] for key in EXERCISE_FIELDS})
    for index, stage in enumerate(program["progression"], 1):
        fields.update({f"stage {index}.{key}": stage[key] for key in ("title", "text")})
    fields.update({f"ready item {index}": text for index, text in enumerate(program["readyItems"], 1)})
    fields.update({
        "canonical guide URL": f"https://jeremyswishermd.com/{program['slug']}/",
        "emergency disclosure": EMERGENCY_DISCLOSURE,
        "progression heading": PROGRESSION_HEADING,
        "readiness heading": READINESS_HEADING,
        "tracker heading": TRACKER_HEADING,
        "contact footer": CONTACT_FOOTER,
    })
    return fields


def validate_pdf(path, program, fields):
    issues = []
    try:
        reader = PdfReader(path)
        raw_pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as error:
        return [f"cannot read PDF: {error}"], 0
    if not raw_pages:
        return ["PDF contains no pages"], 0

    pages = []
    for index, raw in enumerate(raw_pages, 1):
        paper = path.stem.rsplit('-', 1)[-1]
        width, height = (612, 792) if paper == 'Letter' else (595.28, 841.89)
        box = reader.pages[index - 1].mediabox
        if abs(float(box.width) - width) > 2 or abs(float(box.height) - height) > 2:
            issues.append(f"page {index}: unexpected {paper} paper dimensions {box.width} x {box.height}")
        if normalize(MARGIN_FOOTER) not in normalize(raw):
            issues.append(f"page {index}: missing exercise running footer")
        numbers = PAGE_NUMBER.findall(raw)
        expected = [(str(index), str(len(raw_pages)))]
        if numbers != expected:
            issues.append(f"page {index}: expected one 'Page {index} of {len(raw_pages)}'; found {numbers}")
        # Remove running margins before matching a field across adjacent pages.
        body = normalize(PAGE_NUMBER.sub("", raw)).replace(normalize(MARGIN_FOOTER), "")
        if not any(character.isalnum() for character in body):
            issues.append(f"page {index}: blank except for running margins")
        pages.append(body)

    full_text = "".join(pages)
    for label, value in fields.items():
        if normalize(value) not in full_text:
            issues.append(f"missing or altered text: {label}")

    def same_page(label, values):
        needles = [normalize(value) for value in values]
        # Missing text is already reported above; avoid duplicate pagination errors.
        if all(needle in full_text for needle in needles):
            if not any(all(needle in page for needle in needles) for page in pages):
                locations = [[i for i, page in enumerate(pages, 1) if needle in page] for needle in needles]
                issues.append(f"{label}: must stay on one page; component pages {locations}")

    for index, exercise in enumerate(program["exercises"], 1):
        same_page(f"exercise {index} ({exercise['name']})", [exercise[key] for key in EXERCISE_FIELDS])
    for index, stage in enumerate(program["progression"], 1):
        same_page(f"stage {index} ({stage['title']})", [stage["title"], stage["text"]])
    same_page("program heading and introduction", [program["programHeading"], program["programIntro"]])
    same_page("progression heading and first stage", [PROGRESSION_HEADING, program["progression"][0]["title"]])
    same_page("readiness heading and first item", [READINESS_HEADING, program["readyItems"][0]])
    same_page("tracker and footer", [TRACKER_HEADING, CONTACT_FOOTER, fields["canonical guide URL"], EMERGENCY_DISCLOSURE])
    return issues, len(pages)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path, help="Directory containing every SLUG-Letter.pdf and SLUG-A4.pdf")
    parser.add_argument("--programs", type=Path, default=Path(__file__).with_name("hep-programs.json"), help="Maintained HEP JSON (default: hep-programs.json beside this script)")
    args = parser.parse_args()
    try:
        programs = json.loads(args.programs.read_text(encoding="utf-8"))
        if not isinstance(programs, list) or not programs:
            raise ValueError("expected a nonempty array of programs")
        sources = []
        slugs = set()
        for program in programs:
            slug = program["slug"]
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or slug in slugs:
                raise ValueError(f"invalid or duplicate slug: {slug!r}")
            slugs.add(slug)
            fields = expected_fields(program)
            if not program["exercises"] or not program["progression"] or not program["readyItems"]:
                raise ValueError(f"{slug}: empty exercise, progression, or readiness list")
            if any(not isinstance(text, str) or not normalize(text) for text in fields.values()):
                raise ValueError(f"{slug}: expected nonempty strings in printed fields")
            sources.append((program, fields))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(f"cannot load maintained programs from {args.programs}: {error}")

    failures = []
    file_count = page_count = 0
    for program, fields in sources:
        for paper in ("Letter", "A4"):
            path = args.output_directory / f"{program['slug']}-{paper}.pdf"
            if not path.is_file():
                failures.append(f"{path.name}: missing required PDF")
                continue
            issues, count = validate_pdf(path, program, fields)
            file_count += 1
            page_count += count
            failures.extend(f"{path.name}: {issue}" for issue in issues)
    control = args.output_directory / 'care-page-control.pdf'
    try:
        control_pages = PdfReader(control).pages
        if not control_pages:
            failures.append('care-page-control.pdf: no pages')
        for index, page in enumerate(control_pages, 1):
            if normalize(MARGIN_FOOTER) in normalize(page.extract_text() or ''):
                failures.append(f'care-page-control.pdf: page {index} incorrectly labeled as an exercise program')
    except Exception as error:
        failures.append(f'care-page-control.pdf: cannot read control PDF: {error}')
    if failures:
        print("\n".join(f"FAIL {failure}" for failure in failures), file=sys.stderr)
        print(f"Failed: {len(failures)} issue(s); checked {file_count}/{len(programs) * 2} PDFs, {page_count} pages.", file=sys.stderr)
        return 1
    print(f"Validated {file_count} PDFs for {len(programs)} programs in Letter and A4 ({page_count} pages): complete source text, intact exercises/stages, attached headings, tracker/footer, paper sizes, page numbering, and a non-exercise footer control.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

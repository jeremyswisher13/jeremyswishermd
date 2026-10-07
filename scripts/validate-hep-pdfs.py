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
from datetime import date

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
EXPECTED_PROGRAM_COUNT = 25
SUMMARY_TITLE = "Exercise follow-up summary"
SUMMARY_CAPTION = "Patient-recorded sessions and next-morning responses"
SUMMARY_HEADERS = ("Date", "Done", "Skipped", "Next-morning response", "Notes / activity goal")
SUMMARY_RESPONSES = {
    "not-checked": "Not checked yet", "baseline": "Back to usual baseline",
    "more-symptomatic": "Still more symptomatic", "not-sure": "Not sure",
}
SUMMARY_DISCLOSURE = (
    "These entries are patient-recorded and have not been reviewed by a clinician. "
    "Use the original program’s dose, frequency, and symptom rules."
)
SUMMARY_PRINT_NOTICE = (
    "Printing or saving this summary does not send it to your doctor. "
    "Bring it to follow-up if helpful."
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


def load_summary_fixtures(path, programs):
    """Read the separately seeded oracle, rather than scraped report text."""
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("version") != 1 or manifest.get("syntheticOnly") is not True:
        raise ValueError("expected version 1 synthetic-only summary fixtures")
    summaries = manifest["summaries"]
    expected_slugs = {program["slug"] for program in programs}
    if not isinstance(summaries, list) or len(summaries) != EXPECTED_PROGRAM_COUNT:
        raise ValueError("expected one summary fixture for each guided program")
    if {summary["slug"] for summary in summaries} != expected_slugs:
        raise ValueError("missing, duplicate, or unexpected summary program")
    sources = {program["slug"]: program for program in programs}
    for summary in summaries:
        program = sources[summary["slug"]]
        if summary["title"] != program["title"] or summary["canonical"] != f"https://jeremyswishermd.com/{program['slug']}/":
            raise ValueError(f"{program['slug']}: fixture title or canonical differs from the source program")
        if not isinstance(summary["goal"], str) or not 1 <= len(summary["goal"]) <= 140:
            raise ValueError(f"{program['slug']}: invalid synthetic current goal")
        if len(summary["entries"]) != 6:
            raise ValueError(f"{program['slug']}: expected six included entries")
        records = [*summary["entries"], summary["excludedEntry"]]
        if len({entry["id"] for entry in records}) != 7:
            raise ValueError(f"{program['slug']}: duplicate fixture entry ID")
        record_dates = []
        for index, entry in enumerate(records):
            saved_date = date.fromisoformat(entry["date"])
            record_dates.append(saved_date)
            if saved_date.month != 10 or saved_date.year != 2026 or entry["displayDate"] != f"Oct {saved_date.day}, 2026":
                raise ValueError(f"{program['slug']}: fixture display date does not match its saved date")
            if not all(isinstance(entry[key], int) and not isinstance(entry[key], bool) and entry[key] >= 0 for key in ("completed", "skipped")):
                raise ValueError(f"{program['slug']}: invalid fixture counts")
            if entry["completed"] + entry["skipped"] != len(program["exercises"]):
                raise ValueError(f"{program['slug']}: fixture counts do not total the prescribed exercises")
            if entry["responseText"] != SUMMARY_RESPONSES[entry["response"]]:
                raise ValueError(f"{program['slug']}: invalid fixture response label")
            if not isinstance(entry["notes"], str) or not 1 <= len(entry["notes"]) <= 200:
                raise ValueError(f"{program['slug']}: invalid synthetic notes")
            if not isinstance(entry["goal"], str) or not 1 <= len(entry["goal"]) <= 140:
                raise ValueError(f"{program['slug']}: invalid synthetic entry goal")
            if index < 6 and (len(entry["notes"]) != 200 or len(entry["goal"]) != 140):
                raise ValueError(f"{program['slug']}: included fixture entries must exercise maximum-length wrapping")
            if not isinstance(entry["marker"], str) or entry["marker"] not in entry["notes"]:
                raise ValueError(f"{program['slug']}: missing synthetic entry marker")
        if record_dates != sorted(record_dates, reverse=True) or len(set(record_dates)) != 7:
            raise ValueError(f"{program['slug']}: fixture must be newest first with distinct dates")
        expected_files = [{"format": paper, "file": f"{program['slug']}-summary-{paper}.pdf"} for paper in ("Letter", "A4")]
        if summary["files"] != expected_files:
            raise ValueError(f"{program['slug']}: expected exactly Letter and A4 summary exports")
        other_markers = [marker for other in summaries if other["slug"] != summary["slug"]
                         for marker in [other["goal"], *[entry["marker"] for entry in other["entries"]]]]
        if summary["otherProgramMarkers"] != other_markers:
            raise ValueError(f"{program['slug']}: incomplete cross-program isolation oracle")
    return [(summary, sources[summary["slug"]]) for summary in summaries]


def summary_row_text(entry):
    return " ".join((entry["displayDate"], str(entry["completed"]), str(entry["skipped"]),
                     entry["responseText"], entry["notes"], f"Goal: {entry['goal']}"))


def validate_summary_pdf(path, paper, summary, program):
    issues = []
    try:
        reader = PdfReader(path)
        raw_pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as error:
        return [f"cannot read summary PDF: {error}"], 0
    if not raw_pages:
        return ["summary PDF contains no pages"], 0
    pages = [normalize(raw) for raw in raw_pages]
    full_text = "".join(pages)
    for index, (page, text) in enumerate(zip(reader.pages, pages), 1):
        width, height = (612, 792) if paper == "Letter" else (595.28, 841.89)
        if abs(float(page.mediabox.width) - width) > 2 or abs(float(page.mediabox.height) - height) > 2:
            issues.append(f"page {index}: unexpected {paper} paper dimensions {page.mediabox.width} x {page.mediabox.height}")
        body = text.replace(normalize(SUMMARY_CAPTION), "")
        for header in SUMMARY_HEADERS:
            body = body.replace(normalize(header), "")
        if not any(character.isalnum() for character in body):
            issues.append(f"page {index}: blank or contains only repeated table headers")
        if PAGE_NUMBER.findall(raw_pages[index - 1]):
            issues.append(f"page {index}: original program page-number footer leaked into summary")

    required = {
        "summary title": SUMMARY_TITLE, "patient-recorded label": "Patient-recorded",
        "source program title": program["title"], "latest entry count": "Latest 6 entries",
        "current activity goal": f"Current activity goal: {summary['goal']}",
        "table caption": SUMMARY_CAPTION, "patient-recorded disclosure": SUMMARY_DISCLOSURE,
        "source program link": f"Program: {summary['canonical']}",
        "print sharing notice": SUMMARY_PRINT_NOTICE,
        **{f"column {index}": header for index, header in enumerate(SUMMARY_HEADERS, 1)},
    }
    for index, entry in enumerate(summary["entries"], 1):
        required.update({
            f"entry {index} date": entry["displayDate"],
            f"entry {index} response": entry["responseText"],
            f"entry {index} complete long notes": entry["notes"],
            f"entry {index} complete activity goal": f"Goal: {entry['goal']}",
        })
    for label, value in required.items():
        if normalize(value) not in full_text:
            issues.append(f"missing or altered summary text: {label}")

    # Source text is an isolation oracle: even a partially leaked original guide
    # must fail, rather than only checking its prominent heading.
    forbidden = {
        "exercise running footer": MARGIN_FOOTER,
        "original print header": "Evidence-informed home exercise program",
        "six-week tracker": TRACKER_HEADING, "tracker columns": "Key sessions",
        "daily tracker column": "Daily or most-day work",
        "full guide footer": "Full guide and references:",
        "clinical review footer": "Clinical review:",
        "excluded seventh entry": summary["excludedEntry"]["marker"],
        "excluded seventh notes": summary["excludedEntry"]["notes"],
        "excluded seventh goal": summary["excludedEntry"]["goal"],
        **{f"other program marker {index}": marker for index, marker in enumerate(summary["otherProgramMarkers"], 1)},
        **{f"original guide {label}": value for label, value in expected_fields(program).items()
           if label not in ("title", "canonical guide URL")},
    }
    for label, value in forbidden.items():
        if normalize(value) in full_text:
            issues.append(f"summary contains excluded text: {label}")

    row_texts = [normalize(summary_row_text(entry)) for entry in summary["entries"]]
    positions = []
    for index, (entry, row) in enumerate(zip(summary["entries"], row_texts), 1):
        position = full_text.find(row)
        if position < 0:
            issues.append(f"entry {index}: date, done/skipped counts, response, notes, and goal must remain in one ordered table row")
        else:
            positions.append(position)
            if not any(row in page for page in pages):
                issues.append(f"entry {index}: table row split across pages")
        if full_text.count(normalize(entry["notes"])) != 1:
            issues.append(f"entry {index}: expected its notes exactly once")
    if len(positions) == 6 and positions != sorted(positions):
        issues.append("summary table entries are not in newest-first order")
    header_needles = [normalize(value) for value in (SUMMARY_CAPTION, *SUMMARY_HEADERS)]
    first_page_needles = [normalize(value) for value in (SUMMARY_TITLE, program["title"], "Latest 6 entries", f"Current activity goal: {summary['goal']}")]
    if row_texts[0] in full_text and not all(needle in pages[0] for needle in [*first_page_needles, *header_needles, row_texts[0]]):
        issues.append("summary heading, caption, column headings, and first table row must stay together on the first page")
    for index, page in enumerate(pages, 1):
        if any(row in page for row in row_texts) and not all(normalize(header) in page for header in SUMMARY_HEADERS):
            issues.append(f"page {index}: table rows missing intact repeated column headings")
    # Long notes may legitimately need multiple pages. No arbitrary page limit.
    return issues, len(pages)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path, help="Directory containing every SLUG-Letter.pdf and SLUG-A4.pdf")
    parser.add_argument("--programs", type=Path, default=Path(__file__).with_name("hep-programs.json"), help="Maintained HEP JSON (default: hep-programs.json beside this script)")
    args = parser.parse_args()
    try:
        programs = json.loads(args.programs.read_text(encoding="utf-8"))
        if not isinstance(programs, list) or len(programs) != EXPECTED_PROGRAM_COUNT:
            raise ValueError("expected exactly 25 maintained exercise programs")
        sources = []
        slugs = set()
        for program in programs:
            slug = program["slug"]
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or slug in slugs:
                raise ValueError(f"invalid or duplicate slug: {slug!r}")
            slugs.add(slug)
            if program.get("guidedSession") is not True:
                raise ValueError(f"{slug}: guided session must be enabled for every maintained program")
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
    summary_file_count = summary_page_count = 0
    summary_manifest = args.output_directory / "summary-manifest.json"
    try:
        summary_sources = load_summary_fixtures(summary_manifest, programs)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        failures.append(f"summary-manifest.json: cannot load synthetic summary fixtures: {error}")
        summary_sources = []
    for summary, program in summary_sources:
        for exported in summary["files"]:
            path = args.output_directory / exported["file"]
            if not path.is_file():
                failures.append(f"{path.name}: missing required summary PDF")
                continue
            issues, count = validate_summary_pdf(path, exported["format"], summary, program)
            summary_file_count += 1
            summary_page_count += count
            failures.extend(f"{path.name}: {issue}" for issue in issues)
    if failures:
        print("\n".join(f"FAIL {failure}" for failure in failures), file=sys.stderr)
        print(f"Failed: {len(failures)} issue(s); checked {file_count}/{len(programs) * 2} program PDFs ({page_count} pages), and {summary_file_count}/{len(programs) * 2} summary PDFs ({summary_page_count} pages).", file=sys.stderr)
        return 1
    print(f"Validated {file_count} PDFs for {len(programs)} programs in Letter and A4 ({page_count} pages): complete source text, intact exercises/stages, attached headings, tracker/footer, paper sizes, page numbering, and a non-exercise footer control.")
    print(f"Validated {summary_file_count} synthetic follow-up summary PDFs ({summary_page_count} pages): latest six entries, dates/counts/responses, complete long notes/goals, newest-first intact table rows, attached/repeated headings, paper sizes, no blank pages, and isolation from excluded entries, other programs, and the original guides.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

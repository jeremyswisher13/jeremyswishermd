#!/usr/bin/env python3
"""Validate CI-exported workout follow-up PDFs using pypdf and the seeded oracle.

Full text, page dimensions, intact rows/sets, and text origins complement visual
review; extraction alone cannot prove that every glyph is visually legible.
"""

import argparse
from datetime import date
import json
from pathlib import Path
import re
import sys
import unicodedata

from pypdf import PdfReader


FIXTURES = {
    "common-extensor-standard": ("lateral-elbow-tendinopathy-exercises", 2, False),
    "advanced-meniscus-standard": ("advanced-meniscus-rehabilitation-exercises", 6, False),
    "common-extensor-eight-sets": ("lateral-elbow-tendinopathy-exercises", 2, True),
}
RESPONSES = {
    "not-checked": "Not checked yet", "baseline": "Back to usual baseline",
    "more-symptomatic": "Still more symptomatic", "not-sure": "Not sure",
}
TITLE = "Exercise follow-up summary"
CAPTION = "Patient-recorded sessions and next-morning responses"
HEADERS = ("Date", "Done", "Skipped", "Next-morning response", "Notes / activity goal")
DISCLOSURE = (
    "These entries are patient-recorded and have not been reviewed by a clinician. "
    "Use the original program’s dose, frequency, and symptom rules."
)
PRINT_NOTICE = (
    "Printing or saving this summary does not send it to your doctor. "
    "Bring it to follow-up if helpful."
)
GUIDANCE_FIELDS = (
    "fitIntro", "fit", "assessFirst", "redFlags", "programHeading", "programIntro",
    "frequency", "equipment", "checkpoint", "goal", "responseIntro", "green",
    "yellow", "red", "evaluation",
)
EXERCISE_GUIDANCE_FIELDS = ("dose", "frequency", "how", "easier", "harder")
UNITS = {"none", "bodyweight", "lb", "kg", "band", "other"}
PAGE_NUMBER = re.compile(r"\bPage\s+\d+\s+of\s+\d+")


def normalize(text):
    # Preserve punctuation and ordering while allowing ordinary PDF line wraps.
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text).replace("\u00ad", ""))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, maximum):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= maximum


def number_or_null(value, maximum):
    return value is None or (isinstance(value, (int, float)) and not isinstance(value, bool)
                             and 0 <= value <= maximum)


def expected_set_text(value, label):
    # Independent of the browser's describeSet() and of its scraped DOM text.
    parts = []
    if value["amount"] is not None:
        parts.append(f"{label}: {value['amount']:g}")
    if value["holdSeconds"] is not None:
        parts.append(f"Timed variation: {value['holdSeconds']} seconds" if value["amount"] is None
                     else f"{value['holdSeconds']}-second holds")
    unit = value["unit"]
    if unit in ("lb", "kg"):
        parts.append(f"{unit} (weight not entered)" if value["load"] is None
                     else f"{value['load']:g} {unit}")
    elif unit == "bodyweight":
        parts.append("body weight")
    elif unit == "band":
        parts.append(f"Band: {value['resistance']}" if value["resistance"] else "Band (not described)")
    elif unit == "other":
        parts.append(f"Resistance: {value['resistance']}" if value["resistance"] else "Other resistance (not described)")
    if value["note"]:
        parts.append(value["note"])
    return " · ".join(parts)


def validate_workout(record, options):
    workout = record["workout"]
    require(isinstance(workout, list) and len(workout) == len(options), "workout must parallel the guided exercises")
    for index, (entry, option) in enumerate(zip(workout, options), 1):
        require(entry["status"] in ("done", "skipped"), f"exercise {index}: invalid status")
        require(entry["measure"] == option["measure"] and entry["label"] == option["label"],
                f"exercise {index}: label/measure differs from guided source options")
        sets = entry["sets"]
        require(isinstance(sets, list) and len(sets) <= 8, f"exercise {index}: invalid sets")
        require(entry["status"] != "skipped" or not sets, f"exercise {index}: skipped exercise contains sets")
        for value in sets:
            require(number_or_null(value["amount"], 10000) and number_or_null(value["load"], 1000),
                    f"exercise {index}: invalid amount/load")
            require(value["holdSeconds"] is None or integer(value["holdSeconds"], 3600),
                    f"exercise {index}: invalid hold seconds")
            require(entry["measure"] == "reps" or value["holdSeconds"] is None,
                    f"exercise {index}: hold-per-rep data on a non-repetition exercise")
            require(value["unit"] in UNITS, f"exercise {index}: invalid resistance unit")
            require(value["unit"] in ("lb", "kg") or value["load"] is None,
                    f"exercise {index}: load without a weight unit")
            require(isinstance(value["resistance"], str) and len(value["resistance"]) <= 60,
                    f"exercise {index}: invalid resistance description")
            require(value["unit"] in ("band", "other") or value["resistance"] == "",
                    f"exercise {index}: description without a described resistance unit")
            require(isinstance(value["note"], str) and len(value["note"]) <= 80,
                    f"exercise {index}: invalid set note")
    require(sum(entry["status"] == "done" for entry in workout) == record["completed"],
            "workout statuses do not match recorded summary counts")


def load_fixtures(directory, programs_path, options_path):
    programs = json.loads(programs_path.read_text(encoding="utf-8"))
    options_by_slug = json.loads(options_path.read_text(encoding="utf-8"))
    sources = {program["slug"]: program for program in programs}
    manifest = json.loads((directory / "workout-manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("version") == 1 and manifest.get("syntheticOnly") is True,
            "expected a version 1 synthetic-only workout manifest")
    fixtures = manifest["fixtures"]
    require(isinstance(fixtures, list) and len(fixtures) == len(FIXTURES)
            and {fixture["id"] for fixture in fixtures} == set(FIXTURES),
            "expected the standard common-extensor, advanced-meniscus, and eight-set fixtures")
    result = []
    for fixture in fixtures:
        slug, latest_index, stress = FIXTURES[fixture["id"]]
        require(fixture["slug"] == slug and fixture["latestWorkoutIndex"] == latest_index
                and fixture.get("stress", False) is stress, "fixture definition differs from its independent test case")
        program = sources[slug]
        require(program.get("guidedSession") is True, f"{slug}: guided session is disabled")
        order = program.get("guidedExerciseOrder", list(range(len(program["exercises"]))))
        require(fixture["guidedOrder"] == order and sorted(order) == list(range(len(program["exercises"]))),
                f"{slug}: fixture does not use the source guided exercise order")
        if slug == "advanced-meniscus-rehabilitation-exercises":
            require(order == [3, 4, 5, 0, 1, 2], "advanced meniscus guided order must remain [3,4,5,0,1,2]")
        options = [options_by_slug[slug][index] for index in order]
        require(fixture["title"] == program["title"] and fixture["canonical"] == f"https://jeremyswishermd.com/{slug}/",
                f"{slug}: fixture title/canonical differs from the maintained source")
        require(isinstance(fixture["goal"], str) and fixture["goal"].startswith("Synthetic QA ")
                and len(fixture["goal"]) <= 140, "current goal must be synthetic and within the saved limit")
        records = fixture["records"]
        require(len(records) == 8 and len({record["id"] for record in records}) == 8, "expected eight distinct seeded records")
        for index, record in enumerate(records):
            saved_date = date.fromisoformat(record["date"])
            require(record["date"] == f"2026-10-{8 - index:02d}" and record["displayDate"] == f"Oct {saved_date.day}, 2026",
                    f"entry {index + 1}: incorrect date/newest-first order")
            require(record["createdAt"] == record["updatedAt"] == 1000 - index, "record ordering stamps differ from the oracle")
            require(integer(record["completed"], len(options)) and integer(record["skipped"], len(options))
                    and record["completed"] + record["skipped"] == len(options), "invalid summary counts")
            require(record["responseText"] == RESPONSES[record["response"]], "response label differs from its saved value")
            for key, limit in (("notes", 200), ("goal", 140)):
                require(isinstance(record[key], str) and record[key].startswith("Synthetic QA ")
                        and 0 < len(record[key]) <= limit, f"invalid synthetic entry {key}")
            require(record["marker"] in record["notes"], "missing synthetic row marker")
            require(("workout" in record) == (index in (latest_index, 7)), "unexpected workout on a simple fixture record")
            if "workout" in record:
                validate_workout(record, options)
        latest = records[latest_index]
        require(fixture["latestWorkoutId"] == latest["id"], "latest-workout selector differs from the fixture")
        if fixture["id"] == "common-extensor-standard":
            timed = latest["workout"][3]["sets"][0]
            require(timed["amount"] is None and timed["holdSeconds"] == 30
                    and timed["note"] == "Synthetic QA time-only carry: Left side",
                    "standard extensor fixture must print a time-only carry without a rep count")
        for index, entry in enumerate(records[7]["workout"]):
            require(len(entry["sets"]) == 1 and entry["sets"][0]["amount"] == 901 + index
                    and entry["sets"][0]["note"] == f"OLDER_WORKOUT_SET {fixture['id']} E{index + 1}",
                    "older workout requires unique excluded amounts and notes")
        require(len(fixture["exercises"]) == len(options), "missing expected exercise details")
        all_units = set()
        for index, (expected, entry, source_index) in enumerate(zip(fixture["exercises"], latest["workout"], order)):
            require(expected["sourceIndex"] == source_index and expected["name"] == program["exercises"][source_index]["name"],
                    f"exercise {index + 1}: name does not match its guided source")
            require(all(expected[key] == entry[key] for key in ("status", "measure", "label")),
                    f"exercise {index + 1}: expected details differ from seeded record")
            require(entry["status"] == ("skipped" if index == len(options) - 1 else "done"), "fixture must include one skipped exercise")
            count = 8 if stress and index == 1 else 0 if entry["status"] == "skipped" or (latest_index == 6 and index == 4) else 3
            require(len(entry["sets"]) == count, f"exercise {index + 1}: fixture set count differs from the required coverage")
            lines = ["Skipped"] if entry["status"] == "skipped" else (
                [expected_set_text(value, entry["label"]) for value in entry["sets"]]
                if entry["sets"] else ["Done · No set details recorded"])
            require(expected["expectedLines"] == lines, f"exercise {index + 1}: independent expected set text is incorrect")
            require(expected["keepTogether"] is (not (stress and index == 1)), "unexpected pagination assertion")
            all_units.update(value["unit"] for value in entry["sets"])
            if stress and index == 1:
                for value in entry["sets"]:
                    require(len(value["note"]) == 80 and len(value["resistance"]) == 60
                            and '<b>plain</b> & "quoted"' in value["note"]
                            and '<band> & "quoted"' in value["resistance"],
                            "eight-set fixture must exercise maximum-length plain-text escaping")
        require({"none", "lb", "kg", "band"}.issubset(all_units), "fixture must cover unweighted, lb, kg, and described band sets")
        require(fixture["files"] == [{"format": paper, "file": f"{fixture['id']}-workout-{paper}.pdf"}
                                     for paper in ("Letter", "A4")], "expected exactly Letter and A4 exports")
        other_markers = [marker for other in fixtures if other["slug"] != slug
                         for marker in [other["title"], other["canonical"], other["goal"], *[exercise["name"] for exercise in other["exercises"]], *[record["marker"] for record in other["records"]],
                                        *[value["note"] for record in other["records"] for entry in record.get("workout", []) for value in entry["sets"]]]]
        require(fixture["otherProgramMarkers"] == other_markers, "incomplete other-program isolation oracle")
        result.append((fixture, program))
    return result


def summary_row(record):
    return " ".join((record["displayDate"], str(record["completed"]), str(record["skipped"]),
                     record["responseText"], record["notes"], f"Goal: {record['goal']}"))


def validate_pdf(path, paper, fixture, program):
    issues = []
    try:
        reader = PdfReader(path)
        raw_pages = []
        width, height = (612, 792) if paper == "Letter" else (595.28, 841.89)
        for index, page in enumerate(reader.pages, 1):
            box = page.mediabox
            if abs(float(box.width) - width) > 2 or abs(float(box.height) - height) > 2:
                issues.append(f"page {index}: unexpected {paper} paper dimensions {box.width} x {box.height}")
            outside = []

            def text_origin(text, cm, tm, _font, _size):
                if not any(character.isalnum() for character in text):
                    return
                x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
                y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
                if x < -2 or y < -2 or x > float(box.width) + 2 or y > float(box.height) + 2:
                    outside.append(text.strip()[:60])

            raw = page.extract_text(visitor_text=text_origin) or ""
            raw_pages.append(raw)
            if outside:
                issues.append(f"page {index}: text origins outside the paper box: {outside[:3]}")
    except Exception as error:
        return [f"cannot read PDF: {error}"], 0
    if not raw_pages:
        return ["PDF contains no pages"], 0
    pages = [normalize(raw) for raw in raw_pages]
    full = "".join(pages)
    for index, (raw, page) in enumerate(zip(raw_pages, pages), 1):
        body = page.replace(normalize(CAPTION), "")
        for header in HEADERS:
            body = body.replace(normalize(header), "")
        if not any(character.isalnum() for character in body):
            issues.append(f"page {index}: blank or contains only repeated table headers")
        if PAGE_NUMBER.search(raw):
            issues.append(f"page {index}: original guide page-number footer leaked into the summary")

    latest = fixture["records"][fixture["latestWorkoutIndex"]]
    detail_heading = f"Set details · Most recent workout entry: {latest['displayDate']}"
    required = {
        "summary title": TITLE, "patient-recorded label": "Patient-recorded", "program title": fixture["title"],
        "latest six count": "Latest 6 entries", "current goal": f"Current activity goal: {fixture['goal']}",
        "table caption": CAPTION, "workout date": detail_heading, "detail heading": "Recorded exercise details",
        "disclosure": DISCLOSURE, "canonical program": f"Program: {fixture['canonical']}", "print notice": PRINT_NOTICE,
        **{f"column {index}": header for index, header in enumerate(HEADERS, 1)},
    }
    for label, value in required.items():
        if normalize(value) not in full:
            issues.append(f"missing or altered text: {label}")

    row_positions = []
    for index, record in enumerate(fixture["records"][:6], 1):
        row = normalize(summary_row(record))
        position = full.find(row)
        if position < 0:
            issues.append(f"entry {index}: missing or altered ordered date/counts/response/notes/goal row")
        else:
            row_positions.append(position)
            if not any(row in page for page in pages):
                issues.append(f"entry {index}: summary table row split across pages")
        if full.count(normalize(record["notes"])) != 1:
            issues.append(f"entry {index}: expected its complete notes exactly once")
    if len(row_positions) == 6 and row_positions != sorted(row_positions):
        issues.append("summary rows are not in newest-first order")
    first_row = normalize(summary_row(fixture["records"][0]))
    if first_row in full and not all(normalize(value) in pages[0] for value in (
            TITLE, fixture["title"], "Latest 6 entries", CAPTION, *HEADERS, summary_row(fixture["records"][0]))):
        issues.append("summary heading, column headings, and first row must stay together on the first page")
    for index, page in enumerate(pages, 1):
        if any(normalize(summary_row(record)) in page for record in fixture["records"][:6]):
            if not all(normalize(header) in page for header in HEADERS):
                issues.append(f"page {index}: summary rows lack complete repeated column headings")

    exercise_positions = [full.find(normalize(exercise["name"])) for exercise in fixture["exercises"]]
    if all(position >= 0 for position in exercise_positions) and exercise_positions != sorted(exercise_positions):
        issues.append("workout exercise names are not in guided order")
    for index, exercise in enumerate(fixture["exercises"]):
        title = normalize(exercise["name"])
        if full.count(title) != 1:
            issues.append(f"exercise {index + 1}: expected its complete source title exactly once")
        start = exercise_positions[index]
        end = exercise_positions[index + 1] if index + 1 < len(exercise_positions) else full.find(normalize(DISCLOSURE))
        block = full[start:end] if start >= 0 and end > start else ""
        recorded = next(record for record in fixture["records"]
                        if record["id"] == fixture["latestWorkoutId"])["workout"][index]
        amount_count = sum(value["amount"] is not None for value in recorded["sets"])
        if block.count(normalize(exercise["label"] + ":")) != amount_count:
            issues.append(f"exercise {index + 1}: primary amounts are missing, duplicated, or fabricated on time-only sets")
        line_positions = []
        for set_index, line in enumerate(exercise["expectedLines"], 1):
            needle = normalize(line)
            position = block.find(needle)
            if position < 0:
                issues.append(f"exercise {index + 1} set/status {set_index}: missing or altered complete label/amount/resistance/hold/note text")
            else:
                line_positions.append(position)
                if block.count(needle) != 1:
                    issues.append(f"exercise {index + 1} set/status {set_index}: duplicate recorded details")
                if not any(needle in page for page in pages):
                    issues.append(f"exercise {index + 1} set/status {set_index}: recorded line split across pages")
        if line_positions != sorted(line_positions):
            issues.append(f"exercise {index + 1}: recorded sets are out of order")
        needles = [title, *[normalize(line) for line in exercise["expectedLines"]]]
        if exercise["keepTogether"] and all(needle in full for needle in needles):
            if not any(all(needle in page for needle in needles) for page in pages):
                issues.append(f"exercise {index + 1}: standard three-set exercise card split across pages")
        if all(needle in full for needle in needles[:2]) and not any(all(needle in page for needle in needles[:2]) for page in pages):
            issues.append(f"exercise {index + 1}: heading separated from its first recorded set/status")
    first_exercise = fixture["exercises"][0]
    if all(normalize(value) in full for value in (detail_heading, "Recorded exercise details", first_exercise["name"], first_exercise["expectedLines"][0])):
        if not any(all(normalize(value) in page for value in (detail_heading, "Recorded exercise details", first_exercise["name"], first_exercise["expectedLines"][0])) for page in pages):
            issues.append("workout heading/date separated from the first exercise and recorded set")

    forbidden = {
        "guide print header": "Evidence-informed home exercise program", "guide running footer": "Jeremy Swisher, MD - Home exercise program",
        "guide tracker": "Progress tracker", "guide tracker columns": "Key sessions", "guide daily tracker": "Daily or most-day work",
        "guide references": "Full guide and references:", "guide clinical review": "Clinical review:",
        **{f"guide {key}": program[key] for key in GUIDANCE_FIELDS},
        **{f"exercise {index} prescribed {key}": exercise[key] for index, exercise in enumerate(program["exercises"], 1) for key in EXERCISE_GUIDANCE_FIELDS},
        **{f"progression {index} {key}": stage[key] for index, stage in enumerate(program["progression"], 1) for key in ("title", "text")},
        **{f"readiness {index}": value for index, value in enumerate(program["readyItems"], 1)},
        **{f"excluded row {index} {key}": record[key] for index, record in enumerate(fixture["records"][6:], 7) for key in ("notes", "goal")},
        **{f"other program marker {index}": marker for index, marker in enumerate(fixture["otherProgramMarkers"], 1)},
        **{f"older workout exercise {index} set {set_index}": value["note"]
           for record in fixture["records"] if record["id"] != fixture["latestWorkoutId"]
           for index, entry in enumerate(record.get("workout", []), 1) for set_index, value in enumerate(entry["sets"], 1)},
        **{f"older workout exercise {index} set {set_index} amount": f"{entry['label']}: {value['amount']:g}"
           for record in fixture["records"] if record["id"] != fixture["latestWorkoutId"]
           for index, entry in enumerate(record.get("workout", []), 1) for set_index, value in enumerate(entry["sets"], 1)},
    }
    for label, value in forbidden.items():
        if normalize(value) in full:
            issues.append(f"excluded text leaked into workout summary: {label}")
    # Maximum-length notes can legitimately add pages. There is no page cap.
    return issues, len(pages)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path)
    parser.add_argument("--programs", type=Path, default=Path(__file__).with_name("hep-programs.json"))
    parser.add_argument("--options", type=Path, default=Path(__file__).with_name("hep-workout-options.json"))
    args = parser.parse_args()
    try:
        fixtures = load_fixtures(args.output_directory, args.programs, args.options)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        parser.error(f"cannot load synthetic workout oracle: {error}")
    failures = []
    files = pages = 0
    for fixture, program in fixtures:
        for export in fixture["files"]:
            path = args.output_directory / export["file"]
            if not path.is_file():
                failures.append(f"{path.name}: missing required workout PDF")
                continue
            issues, count = validate_pdf(path, export["format"], fixture, program)
            files += 1
            pages += count
            failures.extend(f"{path.name}: {issue}" for issue in issues)
    if failures:
        print("\n".join(f"FAIL {failure}" for failure in failures), file=sys.stderr)
        print(f"Failed: {len(failures)} issue(s); checked {files}/6 workout PDFs ({pages} pages).", file=sys.stderr)
        return 1
    print(f"Validated {files} synthetic workout PDFs in Letter and A4 ({pages} pages): latest-six ordered counts, most-recent workout selection, guided exercise order, exact sets/labels/units/notes, maximum-length plain-text escaping, intact rows/sets/standard cards, paper dimensions, no blank pages, and no older/other-program/prescribed-guidance leakage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

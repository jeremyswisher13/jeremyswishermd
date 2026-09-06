# Printable exercise handout checks

Run `npm run test:print-pdf` after installing the existing Node dependencies,
Playwright Chromium, and Python 3 with `pypdf==6.10.0`. The Python interpreter
must be available as `python3` on PATH. CI installs these dependencies explicitly.

The check exports every maintained exercise program in US Letter and A4 using
the real print styles, plus a non-exercise care-page control. Outputs stay in
the ignored `.quality-results/print/` directory; they are not patient downloads
or deployed assets. All remote requests are blocked during export.

Validation compares the actual PDF text with maintained clinical instructions,
checks intact exercise cards and progression steps, attached headings, the
tracker/footer block, page numbering, paper sizes, and footer scope. The browser
suite separately verifies print-visible text and print-button failure recovery.

These automated checks do not prove visual legibility, accessibility conformance,
or behavior in every browser/printer. After changing print layout, render the
PDFs and inspect page breaks, text, and tables visually before publishing.

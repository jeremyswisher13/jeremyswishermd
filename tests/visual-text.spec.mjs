import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = join(siteRoot, '.quality-results', 'visual-text');
const widths = [320, 390, 768, 1440];
const screenshotWidths = new Set([390, 1440]);
const excludedDirectories = new Set(['node_modules', 'tests', 'scripts', 'audits', 'test-results', 'playwright-report']);
const exercisePrograms = JSON.parse(readFileSync(join(siteRoot, 'scripts', 'hep-programs.json'), 'utf8'));
const programsByPath = new Map(exercisePrograms.map(program => [`/${program.slug}/`, program]));
const guidedExercises = program => program.guidedExerciseOrder
  ? program.guidedExerciseOrder.map(index => program.exercises[index]) : program.exercises;
const guidedExerciseCount = exercisePrograms.reduce((total, program) => total + guidedExercises(program).length, 0);

function findHTML(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || excludedDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? findHTML(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}

// Discover the deployed HTML rather than maintaining a second, incomplete route list.
const routes = findHTML(siteRoot).map(path => {
  const file = relative(siteRoot, path).replaceAll('\\', '/');
  return {
    file,
    name: file === 'index.html' ? 'homepage' : file.replace(/\/index\.html$|\.html$/g, '').replaceAll('/', '--'),
    path: file === '404.html' ? '/visual-text-missing-page/' : `/${file.replace(/index\.html$/, '')}`,
    status: file === '404.html' ? 404 : 200,
  };
}).sort((left, right) => left.file.localeCompare(right.file));

function writeJSON(name, value) {
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`);
}

/** Runs inside the page. Keep this function self-contained for page.evaluate. */
function renderedTextAudit({ scopeSelector = 'body' } = {}) {
  const scope = document.querySelector(scopeSelector);
  if (!scope) throw new Error(`Missing text-audit scope: ${scopeSelector}`);
  const tolerance = 2; // CSS pixels: fractional font/box rounding is not clipping.
  const viewportWidth = document.documentElement.clientWidth;
  const styleCache = new WeakMap();
  const clipCache = new WeakMap();
  const findings = [];
  const review = [];
  const scrollports = new Map();
  const skipped = {};
  const textSections = new Map();
  let textNodesChecked = 0;
  let textLinesChecked = 0;

  const styleFor = element => {
    if (!styleCache.has(element)) styleCache.set(element, getComputedStyle(element));
    return styleCache.get(element);
  };
  const rectJSON = rect => ({
    left: +rect.left.toFixed(2), top: +(rect.top + window.scrollY).toFixed(2),
    right: +rect.right.toFixed(2), bottom: +(rect.bottom + window.scrollY).toFixed(2),
    width: +(rect.right - rect.left).toFixed(2), height: +(rect.bottom - rect.top).toFixed(2),
  });
  const selectorFor = element => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts = [];
    for (let current = element; current && current !== document.body; current = current.parentElement) {
      const siblings = current.parentElement ? [...current.parentElement.children]
        .filter(sibling => sibling.tagName === current.tagName) : [];
      parts.unshift(`${current.localName}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''}`);
      if (current.parentElement?.id) {
        parts.unshift(`#${CSS.escape(current.parentElement.id)}`);
        break;
      }
    }
    return parts.join(' > ') || element.localName;
  };
  const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const isHidden = element => {
    if (element.closest('script, style, noscript, template, option, textarea')) return 'non-rendered-text';
    if (element.closest('[aria-hidden="true"], .sr-only, .visually-hidden, .material-symbols-outlined')) return 'intentional-hidden-or-icon';
    if (element.closest('.skip-link:not(:focus)')) return 'unfocused-skip-link';
    for (let current = element; current; current = current.parentElement) {
      const style = styleFor(current);
      if (current.hidden || style.display === 'none' || style.visibility === 'hidden'
        || style.visibility === 'collapse' || Number(style.opacity) === 0
        || style.contentVisibility === 'hidden') return 'css-hidden';
      if (current.localName === 'details' && !current.open) {
        const summary = [...current.children].find(child => child.localName === 'summary');
        if (!summary?.contains(element)) return 'closed-native-disclosure';
      }
      // Recognize standard visually-hidden utilities even when their class name differs.
      if (current.offsetWidth <= 2 && current.offsetHeight <= 2
        && (style.clip !== 'auto' || style.clipPath === 'inset(50%)')
        && ['absolute', 'fixed'].includes(style.position)) return 'visually-hidden-geometry';
    }
    return null;
  };
  const clipsFor = element => {
    if (clipCache.has(element)) return clipCache.get(element);
    const clips = [];
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = styleFor(ancestor);
      const paintContainment = /\b(paint|strict|content)\b/.test(style.contain);
      const xMode = paintContainment ? 'hidden' : style.overflowX;
      const yMode = paintContainment ? 'hidden' : style.overflowY;
      // The document's vertical scroll is reachable content, not a clipped paragraph.
      const documentScroller = ancestor === document.documentElement || ancestor === document.body;
      const xClip = ['hidden', 'clip'].includes(xMode);
      const yClip = !documentScroller && ['hidden', 'clip'].includes(yMode);
      const xScroll = !documentScroller && ['auto', 'scroll'].includes(xMode)
        && ancestor.scrollWidth > ancestor.clientWidth + tolerance;
      const yScroll = !documentScroller && ['auto', 'scroll'].includes(yMode)
        && ancestor.scrollHeight > ancestor.clientHeight + tolerance;
      if (!(xClip || yClip || xScroll || yScroll)) continue;
      const rect = ancestor.getBoundingClientRect();
      const clipMargin = Number.parseFloat(style.overflowClipMargin) || 0;
      const bounds = {
        left: rect.left + ancestor.clientLeft - (xMode === 'clip' ? clipMargin : 0),
        right: rect.left + ancestor.clientLeft + ancestor.clientWidth + (xMode === 'clip' ? clipMargin : 0),
        top: rect.top + ancestor.clientTop - (yMode === 'clip' ? clipMargin : 0),
        bottom: rect.top + ancestor.clientTop + ancestor.clientHeight + (yMode === 'clip' ? clipMargin : 0),
      };
      clips.push({ ancestor, xClip, yClip, xScroll, yScroll, xMode, yMode, bounds });
    }
    clipCache.set(element, clips);
    return clips;
  };

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.textContent || '';
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const element = node.parentElement;
    const hiddenReason = isHidden(element);
    if (hiddenReason) { skip(hiddenReason); continue; }
    const range = document.createRange();
    range.setStart(node, raw.search(/\S/));
    range.setEnd(node, raw.search(/\s*$/));
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0.1 && rect.height > 0.1);
    if (!rects.length) { skip('no-rendered-range'); continue; }
    textNodesChecked += 1;
    textLinesChecked += rects.length;
    const selector = selectorFor(element);
    const section = element.closest('section, article, aside, header, footer, nav, main') || scope;
    const sectionSelector = selectorFor(section);
    if (!textSections.has(sectionSelector)) textSections.set(sectionSelector, {
      selector: sectionSelector, heading: section.querySelector('h1, h2, h3')?.textContent.trim() || section.getAttribute('aria-label') || '',
      bounds: rectJSON(section.getBoundingClientRect()), textNodes: 0,
    });
    textSections.get(sectionSelector).textNodes += 1;
    const reasons = [];
    const clips = clipsFor(element);
    for (const [line, original] of rects.entries()) {
      let visible = { left: original.left, right: original.right, top: original.top, bottom: original.bottom };
      for (const clip of clips) {
        const { bounds } = clip;
        const horizontalLoss = clip.xClip && (visible.left < bounds.left - tolerance || visible.right > bounds.right + tolerance);
        const verticalLoss = clip.yClip && (visible.top < bounds.top - tolerance || visible.bottom > bounds.bottom + tolerance);
        if (horizontalLoss || verticalLoss) reasons.push({
          type: 'clipping-ancestor', line: line + 1, axes: [horizontalLoss && 'x', verticalLoss && 'y'].filter(Boolean),
          ancestor: selectorFor(clip.ancestor), overflowX: clip.xMode, overflowY: clip.yMode,
          textBounds: rectJSON(visible), clipBounds: rectJSON(bounds),
        });
        if (clip.xScroll || clip.yScroll) {
          const scrollSelector = selectorFor(clip.ancestor);
          if (!scrollports.has(scrollSelector)) scrollports.set(scrollSelector, {
            selector: scrollSelector, axes: [clip.xScroll && 'x', clip.yScroll && 'y'].filter(Boolean),
            bounds: rectJSON(bounds), scrollWidth: clip.ancestor.scrollWidth, scrollHeight: clip.ancestor.scrollHeight,
            explanation: 'Text outside this scrollport is reachable by scrolling; its inner hidden/clip ancestors are still checked.',
          });
        }
        if (clip.xClip || clip.xScroll) {
          visible.left = Math.max(visible.left, bounds.left);
          visible.right = Math.min(visible.right, bounds.right);
        }
        if (clip.yClip || clip.yScroll) {
          visible.top = Math.max(visible.top, bounds.top);
          visible.bottom = Math.min(visible.bottom, bounds.bottom);
        }
        if (visible.right <= visible.left || visible.bottom <= visible.top) break;
      }
      if (visible.right > visible.left && visible.bottom > visible.top
        && (visible.left < -tolerance || visible.right > viewportWidth + tolerance)) reasons.push({
        type: 'horizontal-viewport-overflow', line: line + 1, textBounds: rectJSON(visible), viewportWidth,
      });
    }
    if (reasons.length) findings.push({ selector, text, font: styleFor(element).font, reasons });
    const shapedClip = clips.some(clip => styleFor(clip.ancestor).clipPath !== 'none');
    if (shapedClip) review.push({ selector, text: text.slice(0, 200), reason: 'Non-rectangular clip-path needs screenshot review.' });
  }

  return {
    scope: scopeSelector, viewport: { width: window.innerWidth, height: window.innerHeight, contentWidth: viewportWidth },
    documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    toleranceCSSPixels: tolerance, textNodesChecked, textLinesChecked, findings,
    review, reachableScrollports: [...scrollports.values()], skipped, textSections: [...textSections.values()],
    limitations: ['Range geometry measures rectangular text layout; screenshots cover glyph appearance, overlaps, pseudo-elements, and native input/select values.'],
  };
}

async function settle(page, { scrollToTop = true } = {}) {
  await page.evaluate(async scrollToTop => {
    await document.fonts.ready;
    // Offscreen lazy images need not load before text is measurable; waiting for
    // their decode can stall forever until they enter the viewport.
    await Promise.all([...document.images].filter(image => image.complete)
      .map(image => image.decode().catch(() => {})));
    if (scrollToTop) window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  }, scrollToTop);
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.beforeAll(() => {
  writeJSON('manifest.json', {
    routes, widths, expectedRouteWidthAudits: routes.length * widths.length,
    fullPageScreenshotWidths: [...screenshotWidths],
    guidedSessions: {
      programs: exercisePrograms.length, exercises: guidedExerciseCount,
      expectedExerciseAudits: guidedExerciseCount * widths.length,
      expectedExerciseScreenshots: guidedExerciseCount * screenshotWidths.size,
      expectedUnsavedReviewAudits: exercisePrograms.length * widths.length,
      programExercises: exercisePrograms.map(program => ({ slug: program.slug, exercises: guidedExercises(program).map(exercise => exercise.name) })),
    },
    states: ['default', 'expanded-content when present', 'each publication filter when present', 'longest clinic program selected when present', 'every guided exercise with harder option and workout fields expanded', 'unsaved guided-session review', 'open mobile navigation when present'],
    results: routes.flatMap(route => widths.map(width => `${route.name}-${width}.audit.json`)),
  });
});

test('text geometry calibration detects real clipping and permits reachable or hidden content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 20px; font: 16px/24px sans-serif; }
    .wrap { width: 130px; overflow-wrap: anywhere; }
    .clip { width: 120px; overflow: hidden; }
    .wide { width: 300px; white-space: nowrap; }
    .vertical { width: 230px; height: 15px; overflow: hidden; }
    .scroll { width: 120px; overflow-x: auto; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
  </style></head><body>
    <p id="normal-wrap" class="wrap">A long heading should wrap into readable lines at a narrow width.</p>
    <div class="clip"><div><span id="nested-clipped" class="wide">Inaccessible clipped heading text continues beyond its hidden ancestor</span></div></div>
    <div class="vertical"><span id="vertical-clipped">A clipped line loses its bottom.</span></div>
    <div class="scroll"><div class="wide"><span id="reachable-scroll">Text that a visitor can reach by scrolling</span></div></div>
    <div class="scroll"><div class="wide"><div class="clip"><span id="clipped-inside-scroll">Clipping inside a scrollable ancestor is still an error</span></div></div></div>
    <span class="sr-only">Screen reader information</span>
    <details><summary>Closed disclosure label</summary><p id="closed-body" class="wide">Hidden disclosure content is not an overflow failure</p></details>
    <p id="below-fold" style="margin-top: 1000px">Normal text below the fold remains reachable.</p>
  </body></html>`);
  const audit = await page.evaluate(renderedTextAudit);
  writeJSON('calibration.json', audit);
  expect(audit.findings.map(finding => finding.selector).sort()).toEqual([
    '#clipped-inside-scroll', '#nested-clipped', '#vertical-clipped',
  ]);
  expect(audit.findings.find(finding => finding.selector === '#nested-clipped').reasons[0].axes).toContain('x');
  expect(audit.findings.find(finding => finding.selector === '#vertical-clipped').reasons[0].axes).toContain('y');
  expect(audit.reachableScrollports.length).toBe(2);
  expect(audit.skipped['closed-native-disclosure']).toBe(1);
  expect(audit.skipped['intentional-hidden-or-icon']).toBe(1);
});

for (const route of routes) {
  const program = programsByPath.get(route.path);
  for (const width of widths) {
    test(`${route.name}: visible text at ${width}px`, async ({ page }) => {
      if (program) test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width >= 1440 ? 1000 : 844 });
      const response = await page.goto(route.path, { waitUntil: 'load' });
      expect(response?.status()).toBe(route.status);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('html')).toHaveClass(/\bnav-ready\b/);
      await settle(page);
      const reports = [];
      const capture = async (state, { scopeSelector = 'body', fullPage = true, sectionSelector, guidedExercise } = {}) => {
        const audit = await page.evaluate(renderedTextAudit, { scopeSelector });
        const screenshots = [];
        if (screenshotWidths.has(width)) {
          const filename = `${route.name}-${width}-${state}.png`;
          const target = sectionSelector ? page.locator(sectionSelector) : page;
          await target.screenshot({ path: join(evidenceRoot, filename), ...(sectionSelector ? {} : { fullPage }), animations: 'disabled' });
          screenshots.push(filename);
        }
        reports.push({ state, ...audit, screenshots, ...(guidedExercise ? { guidedExercise } : {}) });
        // Persist after each state: a later interaction failure still leaves its preceding evidence.
        writeJSON(`${route.name}-${width}.audit.json`, {
          route, width, reports,
          guidedExerciseCoverage: {
            expected: program ? guidedExercises(program).length : 0,
            completed: reports.filter(report => report.guidedExercise).length,
          },
        });
      };

      await capture('default');
      const opened = await page.locator('details:not([data-page-jump]):not([class*="hep-workout"])').evaluateAll(details => {
        const closed = details.filter(detail => !detail.open);
        closed.forEach(detail => { detail.open = true; });
        return closed.length;
      });
      const publicationToggle = page.locator('#pubToggleBtn');
      const hasPublications = await publicationToggle.isVisible();
      if (hasPublications) {
        await publicationToggle.click();
        await expect(publicationToggle).toHaveAttribute('aria-expanded', 'true');
      }
      if (opened || hasPublications) {
        await settle(page);
        await capture('expanded-content');
      }
      if (hasPublications) {
        const filters = page.locator('.pub-filter');
        for (let index = 0; index < await filters.count(); index += 1) {
          const filter = filters.nth(index);
          if (await filter.getAttribute('aria-pressed') === 'true') continue;
          const filterName = await filter.getAttribute('data-filter');
          await filter.click();
          await expect(filter).toHaveAttribute('aria-pressed', 'true');
          await settle(page);
          await capture(`publications-${filterName}`, { sectionSelector: '#publications' });
        }
      }
      if (route.path === '/share-program/') {
        await page.locator('#clinic-program').selectOption('advanced-meniscus-rehabilitation-exercises');
        await expect(page.locator('#clinic-selected-title')).toHaveText('Advanced Nonoperative Meniscus Rehabilitation Program for Athletes');
        await expect(page.locator('[data-clinic-card]')).toBeVisible();
        await settle(page);
        await capture('longest-clinic-program');
      }
      if (program) {
        const session = page.locator('[data-hep-session]');
        const exercises = guidedExercises(program);
        const generated = JSON.parse(await page.locator('#hep-session-data').textContent());
        expect(generated.exercises.map(exercise => exercise.name)).toEqual(exercises.map(exercise => exercise.name));
        await expect(session).toHaveAttribute('data-hep-session-ready', 'true');
        await expect(session.locator('[data-hep-storage]')).not.toBeChecked();
        await session.locator('[data-hep-mode="workout"]').check();
        await session.locator('[data-hep-start]').click();
        for (const [index, exercise] of exercises.entries()) {
          const card = session.locator('[data-hep-exercise]');
          await expect(card.locator('[data-hep-exercise-title]')).toHaveText(exercise.name);
          await expect(card.locator('[data-hep-workout]')).toBeVisible();
          const addSet = card.locator('[data-hep-add-set]');
          if (await addSet.isEnabled()) await addSet.click();
          const sets = card.locator('[data-hep-set]');
          await expect(sets).toHaveCount(2);
          // Empty drafts expose both numeric and descriptive resistance labels
          // without fabricating completed work or saving personal information.
          const units = card.locator('[data-hep-set-unit]');
          if (await units.count()) {
            await units.nth(0).selectOption('kg');
            await units.nth(1).selectOption('band');
          }
          const expandedDisclosures = await card.locator('details').evaluateAll(details => {
            details.forEach(detail => { detail.open = true; });
            return details.length;
          });
          await settle(page, { scrollToTop: false });
          await capture(`guided-exercise-${String(index + 1).padStart(2, '0')}`, {
            scopeSelector: '[data-hep-session]', sectionSelector: '[data-hep-session]',
            guidedExercise: { index: index + 1, name: exercise.name, expandedDisclosures, emptySets: await sets.count() },
          });
          await card.locator('[data-hep-skip]').click();
        }
        await expect(session.locator('[data-hep-completed-count]')).toHaveText('0 done');
        await expect(session.locator('[data-hep-skipped-count]')).toHaveText(`${exercises.length} skipped`);
        await session.locator('details').evaluateAll(details => { details.forEach(detail => { detail.open = true; }); });
        await settle(page, { scrollToTop: false });
        await capture('guided-session-review', { scopeSelector: '[data-hep-session]', sectionSelector: '[data-hep-session]' });
        expect(reports.filter(report => report.guidedExercise)).toHaveLength(exercises.length);
        await expect(session.locator('[data-hep-storage]')).not.toBeChecked();
        expect(await page.evaluate(key => localStorage.getItem(key), `swishermd:hep-progress:v1:${program.slug}`)).toBeNull();
        await session.locator('[data-hep-finish]').click();
      }
      const navToggle = page.locator('#navToggle');
      if (await navToggle.isVisible()) {
        await settle(page);
        await navToggle.click();
        await expect(navToggle).toHaveAttribute('aria-expanded', 'true');
        await capture('open-navigation', { scopeSelector: '#navLinks', fullPage: false });
        await page.keyboard.press('Escape');
      }
      expect(reports.flatMap(report => report.findings.map(finding => ({ state: report.state, ...finding }))),
        `${route.path} at ${width}px: see .quality-results/visual-text/${route.name}-${width}.audit.json`)
        .toEqual([]);
    });
  }
}

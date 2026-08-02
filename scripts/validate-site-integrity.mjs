import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const hepPrograms = JSON.parse(readFileSync(join(scriptDirectory, 'hep-programs.json'), 'utf8'));
const htmlFiles = [];
const errors = [];
const analyticsEventCounts = new Map();
const expectedScriptCacheKey = '20260802-acq1';
const supportedMaterialIcons = new Set([
    'accessibility', 'accessibility_new', 'airline_seat_flat', 'arrow_forward', 'badge', 'balance',
    'bedtime', 'block', 'bloodtype', 'calculate', 'calendar_month', 'call', 'chair', 'check_circle',
    'chevron_right', 'clinical_notes', 'diagnosis', 'directions_run', 'directions_walk', 'emergency',
    'event_note', 'event_repeat', 'exercise', 'fact_check', 'fitness_center', 'flag', 'footprint',
    'front_hand', 'groups', 'handshake', 'healing', 'history', 'hourglass_top', 'image_search',
    'info', 'jump_to_element', 'link', 'location_on', 'medical_services', 'medication', 'menu_book',
    'monitor_heart', 'monitoring', 'motion_photos_on', 'my_location', 'open_in_full', 'open_in_new',
    'orthopedics', 'pause_circle', 'person_check', 'photo_camera', 'print', 'query_stats', 'radiology',
    'receipt_long', 'route', 'schedule', 'school', 'science', 'speed', 'sports_baseball',
    'sports_basketball', 'sports_golf', 'stairs', 'target', 'traffic', 'tune', 'vaccines', 'verified',
    'verified_user', 'warning', 'water_drop', 'wb_sunny', 'work'
]);
const forbiddenEmDashes = [
    String.fromCodePoint(0x2014),
    '&' + 'mdash;',
    '&#' + '8212;',
    '&#x' + '2014;'
];

function collectHtmlFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) collectHtmlFiles(fullPath);
        if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(fullPath);
    }
}

function count(text, pattern) {
    return (text.match(pattern) || []).length;
}

function decodeAttribute(value) {
    return value
        .replaceAll('&amp;', '&')
        .replaceAll('&#38;', '&')
        .replaceAll('&#x26;', '&');
}

function splitLocalReference(value) {
    const decoded = decodeAttribute(value);
    const hashIndex = decoded.indexOf('#');
    const queryIndex = decoded.indexOf('?');
    const pathEnd = [hashIndex, queryIndex]
        .filter((index) => index >= 0)
        .reduce((minimum, index) => Math.min(minimum, index), decoded.length);
    const fragment = hashIndex >= 0 ? decoded.slice(hashIndex + 1).split('?')[0] : '';
    return { path: decoded.slice(0, pathEnd), fragment: decodeURIComponent(fragment) };
}

function resolveLocalTarget(reference, sourceFile) {
    const { path, fragment } = splitLocalReference(reference);
    let target = path.startsWith('/')
        ? join(root, path.replace(/^\/+/, ''))
        : resolve(dirname(sourceFile), path || '.');

    if (path === '' && fragment) target = sourceFile;
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
    if (!existsSync(target) && !extname(target)) target = join(target, 'index.html');

    return { target, fragment };
}

function isLocalReference(value) {
    return !/^(?:[a-z]+:|\/\/)/i.test(decodeAttribute(value));
}

function checkLocalReference(reference, sourceFile, sourceLabel) {
    if (!isLocalReference(reference)) return;
    const { target, fragment } = resolveLocalTarget(reference, sourceFile);
    const displaySource = relative(root, sourceFile);

    if (!existsSync(target)) {
        errors.push(displaySource + ': missing local ' + sourceLabel + ' target ' + reference);
        return;
    }

    if (fragment && target.endsWith('.html')) {
        const targetHtml = readFileSync(target, 'utf8');
        const ids = new Set([...targetHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
        if (!ids.has(fragment)) {
            errors.push(displaySource + ': missing fragment #' + fragment + ' in ' + relative(root, target));
        }
    }
}

collectHtmlFiles(root);

for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    const displayFile = relative(root, file);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

    if (count(html, /<main\b/g) !== 1) errors.push(displayFile + ': expected exactly one main element');
    if (count(html, /<h1\b/g) !== 1) errors.push(displayFile + ': expected exactly one h1 element');
    if (duplicateIds.length > 0) errors.push(displayFile + ': duplicate id ' + duplicateIds[0]);
    if (forbiddenEmDashes.some((dash) => html.toLowerCase().includes(dash.toLowerCase()))) {
        errors.push(displayFile + ': contains an em dash');
    }
    if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) {
        errors.push(displayFile + ': contains a remote Google Fonts dependency');
    }
    if (!/rel="preload" as="font"[^>]+inter-site\.woff2/.test(html)) {
        errors.push(displayFile + ': missing the local Inter preload');
    }
    if (!/rel="preload" as="font"[^>]+newsreader-site\.woff2/.test(html)) {
        errors.push(displayFile + ': missing the local Newsreader preload');
    }
    if (!/rel="preload" as="font"[^>]+material-symbols-site\.woff2/.test(html)) {
        errors.push(displayFile + ': missing the local Material Symbols preload');
    }

    const sharedScriptReferences = [...html.matchAll(/<script\b[^>]*\bsrc="[^"]*script\.js\?v=([^"]+)"/gi)];
    if (sharedScriptReferences.length !== 1) {
        errors.push(displayFile + ': expected exactly one versioned shared script reference');
    } else if (sharedScriptReferences[0][1] !== expectedScriptCacheKey) {
        errors.push(displayFile + ': shared script cache key is not ' + expectedScriptCacheKey);
    }

    for (const [, iconName] of html.matchAll(/\sdata-icon="([^"]+)"/g)) {
        if (!supportedMaterialIcons.has(iconName)) {
            errors.push(displayFile + ': icon ' + iconName + ' is missing from the local Material Symbols subset');
        }
    }

    for (const [, eventName] of html.matchAll(/\sdata-analytics-event="([^"]+)"/g)) {
        analyticsEventCounts.set(eventName, (analyticsEventCounts.get(eventName) || 0) + 1);
    }

    for (const match of html.matchAll(/<a\b([^>]*?)href="([^"]+)"([^>]*)>/gi)) {
        const attributes = match[1] + match[3];
        const href = match[2];
        checkLocalReference(href, file, 'link');

        if (/\btarget="_blank"/i.test(attributes)) {
            const relMatch = /\brel="([^"]+)"/i.exec(attributes);
            const relValues = new Set((relMatch?.[1] || '').toLowerCase().split(/\s+/));
            if (!relValues.has('noopener') || !relValues.has('noreferrer')) {
                errors.push(displayFile + ': target="_blank" link is missing noopener noreferrer');
            }
        }
    }

    for (const [, source] of html.matchAll(/\s(?:src|poster)="([^"]+)"/gi)) {
        checkLocalReference(source, file, 'asset');
    }

    for (const [, sourceSet] of html.matchAll(/\ssrcset="([^"]+)"/gi)) {
        for (const candidate of sourceSet.split(',')) {
            const source = candidate.trim().split(/\s+/)[0];
            if (source) checkLocalReference(source, file, 'responsive image');
        }
    }
}

const expectedAnalyticsMinimums = new Map([
    ['exercise_program_print', hepPrograms.length * 2],
    ['exercise_video_load', hepPrograms.filter((program) => program.video).length],
    ['referral_instructions_click', 6]
]);
const automaticAnalyticsEvents = [
    'page_view',
    'location_page_click',
    'directions_click',
    'official_profile_click'
];
const sharedScript = readFileSync(join(root, 'script.js'), 'utf8');
const privacyPage = readFileSync(join(root, 'privacy', 'index.html'), 'utf8');
const homePage = readFileSync(join(root, 'index.html'), 'utf8');
const exerciseHubPage = readFileSync(join(root, 'home-exercise-programs', 'index.html'), 'utf8');
const notFoundPage = readFileSync(join(root, '404.html'), 'utf8');

for (const [eventName, minimum] of expectedAnalyticsMinimums) {
    const countFound = analyticsEventCounts.get(eventName) || 0;
    if (countFound < minimum) {
        errors.push('Expected at least ' + minimum + ' controls for analytics event ' + eventName + ', found ' + countFound);
    }
    if (!sharedScript.includes("'" + eventName + "'")) {
        errors.push('Shared script does not allow analytics event ' + eventName);
    }
}

for (const eventName of automaticAnalyticsEvents) {
    if (!sharedScript.includes("'" + eventName + "'")) {
        errors.push('Shared script does not implement analytics event ' + eventName);
    }
}
if (!sharedScript.includes("destinationPath === '/locations'")) {
    errors.push('Shared script does not classify internal clinic-location links');
}
if (!sharedScript.includes("destinationPath.startsWith('/locations/')")) {
    errors.push('Shared script does not classify official UCLA Health directions links');
}
if (
    !sharedScript.includes("destination.hostname === 'www.google.com'")
    || !sharedScript.includes("destination.hostname === 'maps.google.com'")
    || !sharedScript.includes("destinationPath.startsWith('/maps/')")
) {
    errors.push('Shared script does not classify direct Google Maps clinic-direction links');
}
if (!sharedScript.includes("destinationPath === '/providers/jeremy-swisher'")) {
    errors.push('Shared script does not classify the official UCLA Health profile link');
}
if (
    !sharedScript.includes("window.sa_event('page_view'")
    || !sharedScript.includes("cta_location: 'page'")
) {
    errors.push('Shared script does not send the minimal path-only page-view event');
}

for (const program of hepPrograms) {
    const programPage = readFileSync(join(root, program.slug, 'index.html'), 'utf8');
    const printButtonCount = count(programPage, /<button\b[^>]*\bdata-print-program\b[^>]*>/g);
    const measuredPrintButtonCount = count(
        programPage,
        /<button\b(?=[^>]*\bdata-print-program\b)(?=[^>]*\bdata-analytics-event="exercise_program_print")[^>]*>/g
    );
    if (printButtonCount !== 2 || measuredPrintButtonCount !== printButtonCount) {
        errors.push(program.slug + ': every exercise-program print button must use exercise_program_print measurement');
    }
}

if (!privacyPage.includes('exercise-program print button')) {
    errors.push('Privacy page is missing the exercise-program measurement disclosure');
}
if (!privacyPage.includes('button that loads an optional exercise video')) {
    errors.push('Privacy page is missing the optional-video measurement disclosure');
}
if (!privacyPage.includes('one minimal <code>page_view</code> event')) {
    errors.push('Privacy page is missing the path-only page-view measurement disclosure');
}
if (!privacyPage.includes('a coarse browser-brand list and whether the device is classified as mobile')) {
    errors.push('Privacy page is missing the coarse browser and mobile classification disclosure');
}
if (!privacyPage.includes('a link to the clinic-locations page')) {
    errors.push('Privacy page is missing the clinic-location measurement disclosure');
}
if (!privacyPage.includes('a clinic directions link through UCLA Health or Google Maps')) {
    errors.push('Privacy page is missing the directions measurement disclosure');
}
if (!privacyPage.includes("Dr. Swisher's official UCLA Health profile")) {
    errors.push('Privacy page is missing the official-profile measurement disclosure');
}
if (!sharedScript.includes("document.body?.classList.contains('not-found-page')")) {
    errors.push('Shared script does not suppress analytics on the error page');
}
if (!privacyPage.includes('The error page does not load analytics')) {
    errors.push('Privacy page is missing the error-page analytics disclosure');
}
if (
    !sharedScript.includes('window.sa_event(eventName, metadata, continueNavigation)')
    || !sharedScript.includes('window.setTimeout(continueNavigation, 350)')
) {
    errors.push('Shared script does not preserve measured same-tab navigation with a timeout fallback');
}
if (!privacyPage.includes('Fonts and icons are self-hosted by this website and do not require a request to Google Fonts.')) {
    errors.push('Privacy page must disclose that fonts and icons are self-hosted');
}
if (privacyPage.includes('loads font and icon files from Google Fonts')) {
    errors.push('Privacy page incorrectly says that font and icon files load from Google Fonts');
}
if (
    !sharedScript.includes("classList.contains('not-found-page')")
    || !sharedScript.includes("return '/404/'")
) {
    errors.push('Shared script does not reduce unknown error-page addresses to the fixed /404/ path');
}
if (/class="hero-referral-link"[^>]*data-analytics-event/.test(homePage)) {
    errors.push('Homepage in-page referral jump must not be counted as outbound referral instructions');
}
if (!/body class="[^"]*\bnot-found-page\b/.test(notFoundPage)) {
    errors.push('404 page is missing the not-found-page privacy marker');
}
if (!/<meta name="robots" content="noindex, follow">/.test(notFoundPage)) {
    errors.push('404 page must remain noindex, follow');
}

const expectedProgramRegionCounts = new Map([
    ['knee-thigh', 8],
    ['shoulder', 2],
    ['elbow', 2],
    ['hip', 2],
    ['foot-ankle', 5],
    ['hand-wrist', 2],
    ['back', 1]
]);
const exerciseHubRegions = [...exerciseHubPage.matchAll(/\sdata-program-region="([^"]+)"/g)]
    .map((match) => match[1]);
const exerciseHubFilters = [...exerciseHubPage.matchAll(/name="program-region"\s+value="([^"]+)"/g)]
    .map((match) => match[1]);
const exerciseHubFilterBadges = [...exerciseHubPage.matchAll(/<label for="hep-filter-([^"]+)">[^<]+<span>(\d+)<\/span><\/label>/g)]
    .map((match) => [match[1], Number.parseInt(match[2], 10)]);

if (exerciseHubRegions.length !== hepPrograms.length) {
    errors.push('Exercise library program-card count does not match hep-programs.json');
}
for (const [region, expectedCount] of expectedProgramRegionCounts) {
    const actualCount = exerciseHubRegions.filter(value => value === region).length;
    if (actualCount !== expectedCount) {
        errors.push('Exercise library region ' + region + ' expected ' + expectedCount + ' programs, found ' + actualCount);
    }
    if (!exerciseHubFilters.includes(region)) {
        errors.push('Exercise library is missing the ' + region + ' filter');
    }
    if (!sharedScript.includes("['" + region + "',")) {
        errors.push('Shared script is missing the ' + region + ' filter label');
    }
}
if (!exerciseHubFilters.includes('all')) {
    errors.push('Exercise library is missing the all-programs filter');
}
if (!homePage.includes('Explore all ' + exerciseHubRegions.length + ' exercise programs')) {
    errors.push('Homepage exercise-library link count does not match the program-card count');
}
if (count(exerciseHubPage, /name="program-region"[^>]*\schecked(?:\s|>)/g) !== 1) {
    errors.push('Exercise library must have exactly one default checked region filter');
}
for (const [filterId, visibleCount] of exerciseHubFilterBadges) {
    const region = filterId === 'all' ? 'all' : filterId;
    const expectedCount = region === 'all'
        ? exerciseHubRegions.length
        : expectedProgramRegionCounts.get(region);
    if (visibleCount !== expectedCount) {
        errors.push('Exercise library visible count for ' + region + ' expected ' + expectedCount + ', found ' + visibleCount);
    }
}
if (exerciseHubFilterBadges.length !== expectedProgramRegionCounts.size + 1) {
    errors.push('Exercise library must show a count for every region filter');
}
if (!/<fieldset class="hep-filter-controls" data-program-filter hidden>/.test(exerciseHubPage)) {
    errors.push('Exercise library filter must remain hidden until its script is ready');
}
if (exerciseHubPage.indexOf('id="programs"') > exerciseHubPage.indexOf('class="clinician-panel"')) {
    errors.push('Exercise library must present the program chooser before the clinician panel');
}
if (/\bdata-analytics-event=/.test(exerciseHubPage.match(/<fieldset class="hep-filter-controls"[\s\S]*?<\/fieldset>/)?.[0] || '')) {
    errors.push('Exercise library body-region filters must not record health-related selections');
}

if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
} else {
    console.log('Validated structure, duplicate IDs, local links, fragments, assets, external-link security, and dash policy across ' + htmlFiles.length + ' HTML files.');
}

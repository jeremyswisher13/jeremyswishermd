import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const hepPrograms = JSON.parse(readFileSync(join(scriptDirectory, 'hep-programs.json'), 'utf8'));
const htmlFiles = [];
const errors = [];
const ignoredHtmlDirectories = new Set([
    '.git',
    '.quality-results',
    'audits',
    'node_modules',
    'playwright-report',
    'test-results'
]);
const analyticsEventCounts = new Map();
const expectedAssetCacheKey = '20260904-patients2';
const expectedScriptCacheKey = '20260904-fixes1';
const expectedPrimaryNavigationLabels = [
    'Conditions &amp; Care',
    'Appointments &amp; Insurance',
    'Exercise Library',
    'Locations',
    'About',
    'Research',
    'Call 310-319-1234'
];
const expectedPrimaryNavigationTargets = [
    '#expertise',
    'locations/#scheduling',
    'home-exercise-programs/',
    'locations/',
    '#about',
    '#publications',
    'tel:310-319-1234'
];
const hepProgramFiles = new Set(hepPrograms.map((program) => program.slug + '/index.html'));
const expectedPrimaryNavigationCurrent = new Map([
    ['sports-injuries/index.html', { index: 0, value: 'location' }],
    ['tendon-pain/index.html', { index: 0, value: 'location' }],
    ['knee-hip-shoulder-pain/index.html', { index: 0, value: 'location' }],
    ['osteoarthritis-care/index.html', { index: 0, value: 'location' }],
    ['msk-ultrasound-guided-procedures/index.html', { index: 0, value: 'location' }],
    ['knee-osteoarthritis/index.html', { index: 0, value: 'location' }],
    ['hyaluronic-acid-knee-osteoarthritis/index.html', { index: 0, value: 'location' }],
    ['knee-osteoarthritis-injection-comparison/index.html', { index: 0, value: 'location' }],
    ['prp-knee-osteoarthritis/index.html', { index: 0, value: 'location' }],
    ['orthobiologics/index.html', { index: 0, value: 'location' }],
    ['home-exercise-programs/index.html', { index: 2, value: 'page' }],
    ['locations/index.html', { index: 3, value: 'page' }]
]);
const guideExperienceExpectations = new Map([
    ['orthobiologics/index.html', {
        handoffTarget: '../prp-knee-osteoarthritis/',
        jumpTargets: [
            '#overview',
            '#where-prp-may-fit',
            '#product-characterization',
            '#claims-and-safety',
            '#what-to-expect',
            '#faq'
        ],
        rehabilitationTargets: [
            '../knee-osteoarthritis-exercises/',
            '../knee-osteoarthritis-advanced-exercises/',
            '../rotator-cuff-pain-exercises/',
            '../lateral-elbow-tendinopathy-exercises/',
            '../patellar-tendinopathy-exercises/',
            '../achilles-tendinopathy-exercises/',
            '../plantar-fasciitis-exercises/'
        ]
    }],
    ['prp-knee-osteoarthritis/index.html', {
        handoffTarget: '../orthobiologics/',
        jumpTargets: [
            '#start-here',
            '#evidence',
            '#dose',
            '#candidacy',
            '#process',
            '#medications-supplements',
            '#safety',
            '#guidelines',
            '#cost',
            '#locations',
            '#prp-faq-title'
        ]
    }]
]);
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
        if (entry.isDirectory() && ignoredHtmlDirectories.has(entry.name)) continue;
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) collectHtmlFiles(fullPath);
        if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(fullPath);
    }
}

function count(text, pattern) {
    return (text.match(pattern) || []).length;
}

function visibleAnchorText(contents) {
    return contents
        .replace(/<span\b[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>\s*\(opens in a new tab\)\s*<\/span>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function decodeAttribute(value) {
    return value
        .replaceAll('&amp;', '&')
        .replaceAll('&#38;', '&')
        .replaceAll('&#x26;', '&');
}

function normalizeProgramSearchForValidation(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']s\b/gi, 's')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
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
    const sourceNumberById = new Map();
    let appointmentLinkCount = 0;
    const newTabLinkLabels = [];

    for (const sourceListMatch of html.matchAll(/<ul\b[^>]*\bclass="[^"]*\bsource-list\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi)) {
        let sourceNumber = 0;
        for (const sourceItemMatch of sourceListMatch[1].matchAll(/<li\b([^>]*)>/gi)) {
            sourceNumber += 1;
            const sourceId = /\bid="([^"]+)"/i.exec(sourceItemMatch[1])?.[1];
            if (sourceId) sourceNumberById.set(sourceId, sourceNumber);
        }
    }

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

    const sharedStyleReferences = [...html.matchAll(/<link\b[^>]*\bhref="[^"]*styles\.css\?v=([^"]+)"/gi)];
    if (sharedStyleReferences.length !== 1) {
        errors.push(displayFile + ': expected exactly one versioned shared stylesheet reference');
    } else if (sharedStyleReferences[0][1] !== expectedAssetCacheKey) {
        errors.push(displayFile + ': shared stylesheet cache key is not ' + expectedAssetCacheKey);
    }

    const landingStyleReferences = [...html.matchAll(/<link\b[^>]*\bhref="[^"]*landing-pages\.css\?v=([^"]+)"/gi)];
    if (!/<noscript><link rel="stylesheet" href="[^"]*navigation-nojs\.css\?v=20260904-patients2"><\/noscript>/.test(html)) {
        errors.push(displayFile + ': expanded navigation styles must be isolated to the no-JavaScript fallback');
    }
    if (landingStyleReferences.length > 1) {
        errors.push(displayFile + ': expected no more than one landing-page stylesheet reference');
    } else if (landingStyleReferences.length === 1 && landingStyleReferences[0][1] !== expectedAssetCacheKey) {
        errors.push(displayFile + ': landing-page stylesheet cache key is not ' + expectedAssetCacheKey);
    }

    const primaryNavigation = /<nav class="nav-links" id="navLinks" aria-label="Primary navigation">([\s\S]*?)<\/nav>/i.exec(html)?.[1];
    if (!primaryNavigation) {
        errors.push(displayFile + ': missing primary navigation');
    } else {
        const navigationAnchors = [...primaryNavigation.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
        const navigationLabels = navigationAnchors
            .map((match) => match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
        const navigationTargets = navigationAnchors
            .map((match) => /\bhref="([^"]+)"/i.exec(match[1])?.[1] || '')
            .map((target) => target.replace(/^\.\.\//, '').replace(/^\//, ''));
        if (navigationLabels.join('|') !== expectedPrimaryNavigationLabels.join('|')) {
            errors.push(displayFile + ': primary navigation labels or order do not match the patient-first menu');
        }
        if (navigationTargets.join('|') !== expectedPrimaryNavigationTargets.join('|')) {
            errors.push(displayFile + ': primary navigation destinations do not match the patient-first menu');
        }
        navigationAnchors.forEach((match, index) => {
            const ariaLabel = /\baria-label="([^"]+)"/i.exec(match[1])?.[1] || '';
            if (ariaLabel && !ariaLabel.toLowerCase().includes(navigationLabels[index].toLowerCase())) {
                errors.push(displayFile + ': primary navigation accessible name must include its visible label');
            }
        });

        const expectedCurrent = hepProgramFiles.has(displayFile)
            ? { index: 2, value: 'location' }
            : expectedPrimaryNavigationCurrent.get(displayFile);
        const activeIndexes = navigationAnchors
            .map((match, index) => /\bclass="[^"]*\bactive\b[^"]*"/i.test(match[1]) ? index : -1)
            .filter((index) => index >= 0);
        const currentEntries = navigationAnchors
            .map((match, index) => ({
                index,
                value: /\baria-current="([^"]+)"/i.exec(match[1])?.[1] || ''
            }))
            .filter((entry) => entry.value);

        if (expectedCurrent) {
            if (activeIndexes.length !== 1 || activeIndexes[0] !== expectedCurrent.index) {
                errors.push(displayFile + ': primary navigation active state is incorrect');
            }
            if (
                currentEntries.length !== 1
                || currentEntries[0].index !== expectedCurrent.index
                || currentEntries[0].value !== expectedCurrent.value
            ) {
                errors.push(displayFile + ': primary navigation aria-current state is incorrect');
            }
        } else if (activeIndexes.length > 0 || currentEntries.length > 0) {
            errors.push(displayFile + ': primary navigation has an unexpected active or aria-current state');
        }
    }

    for (const [, iconName] of html.matchAll(/\sdata-icon="([^"]+)"/g)) {
        if (!supportedMaterialIcons.has(iconName)) {
            errors.push(displayFile + ': icon ' + iconName + ' is missing from the local Material Symbols subset');
        }
    }

    for (const [, eventName] of html.matchAll(/\sdata-analytics-event="([^"]+)"/g)) {
        analyticsEventCounts.set(eventName, (analyticsEventCounts.get(eventName) || 0) + 1);
    }

    for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        const attributes = match[1];
        const contents = match[2];
        const href = /\bhref="([^"]+)"/i.exec(attributes)?.[1] || '';
        const opensInNewTab = /\btarget="_blank"/i.test(attributes);
        checkLocalReference(href, file, 'link');

        if (opensInNewTab) {
            newTabLinkLabels.push(visibleAnchorText(contents));
            const relMatch = /\brel="([^"]+)"/i.exec(attributes);
            const relValues = new Set((relMatch?.[1] || '').toLowerCase().split(/\s+/));
            if (!relValues.has('noopener') || !relValues.has('noreferrer')) {
                errors.push(displayFile + ': target="_blank" link is missing noopener noreferrer');
            }
            const newTabCues = contents.match(/<span\b[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>\s*\(opens in a new tab\)\s*<\/span>/gi) || [];
            if (newTabCues.length !== 1) {
                errors.push(displayFile + ': target="_blank" link must contain exactly one hidden new-tab cue');
            }
            if (/\baria-(?:label|labelledby)="/i.test(attributes)) {
                errors.push(displayFile + ': target="_blank" link must not override its descendant new-tab cue');
            }
        } else if (/\(opens in a new tab\)/i.test(contents)) {
            errors.push(displayFile + ': hidden new-tab cue appears on a link without target="_blank"');
        }

        for (const icon of contents.matchAll(/<span\b([^>]*\bdata-icon="open_in_new"[^>]*)>/gi)) {
            if (!/\baria-hidden="true"/i.test(icon[1])) {
                errors.push(displayFile + ': open-in-new icon must remain aria-hidden');
            }
        }
    }

    for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        const attributes = match[1];
        const href = /\bhref="([^"]+)"/i.exec(attributes)?.[1] || '';
        if (href.startsWith('https://cloud.h.uclahealth.org/appointment-request')) {
            appointmentLinkCount += 1;
            const appointmentLabel = visibleAnchorText(match[2]);
            if (appointmentLabel !== 'Request on UCLA Health') {
                errors.push(displayFile + ': UCLA appointment link must use the standard visible label');
            }
        }
        if (!/\bclass="[^"]*\boa-cite\b[^"]*"/i.test(attributes)) continue;

        const citationTarget = /\bhref="#([^"]+)"/i.exec(attributes)?.[1];
        const visibleCitationNumber = Number.parseInt(match[2].replace(/<[^>]+>/g, '').trim(), 10);
        const expectedCitationNumber = citationTarget ? sourceNumberById.get(citationTarget) : undefined;

        if (!citationTarget || !Number.isInteger(visibleCitationNumber)) {
            errors.push(displayFile + ': malformed numbered source citation');
        } else if (expectedCitationNumber === undefined) {
            errors.push(displayFile + ': numbered citation does not target a numbered source #' + citationTarget);
        } else if (visibleCitationNumber !== expectedCitationNumber) {
            errors.push(
                displayFile + ': citation #' + citationTarget + ' displays '
                + visibleCitationNumber + ' but is source ' + expectedCitationNumber
            );
        }

        const citationAriaLabel = /\baria-label="([^"]+)"/i.exec(attributes)?.[1] || '';
        if (!citationAriaLabel.includes(String(visibleCitationNumber))) {
            errors.push(displayFile + ': numbered citation accessible name must include its visible number');
        }
    }

    if (displayFile === 'orthobiologics/index.html' && appointmentLinkCount !== 3) {
        errors.push(displayFile + ': expected three UCLA appointment paths');
    }
    const expectedDirectionLabels = displayFile === 'index.html'
        ? ['Directions to Westwood', 'Directions to West Hills']
        : displayFile === 'locations/index.html'
            ? [
                'Westwood clinic page and directions',
                'West Hills clinic page and directions',
                'Open Westwood in Google Maps',
                'Open West Hills in Google Maps'
            ]
            : [];
    for (const label of expectedDirectionLabels) {
        if (newTabLinkLabels.filter((candidate) => candidate === label).length !== 1) {
            errors.push(displayFile + ': expected one external direction link labeled "' + label + '"');
        }
    }

    const guideExpectation = guideExperienceExpectations.get(displayFile);
    if (guideExpectation) {
        const pageJumpNavigation = /<nav class="page-jump page-jump-disclosure" aria-label="On this page">([\s\S]*?)<\/nav>/i
            .exec(html)?.[1] || '';
        const jumpTargets = [...pageJumpNavigation.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)]
            .map((match) => match[1]);

        if (!pageJumpNavigation) {
            errors.push(displayFile + ': missing the responsive on-page disclosure');
        } else {
            if (!/<details\b[^>]*\bopen\b[^>]*\bdata-page-jump\b[^>]*>/i.test(pageJumpNavigation)) {
                errors.push(displayFile + ': on-page disclosure must be open as its no-script fallback');
            }
            if (!/<summary>\s*On this page\s*<\/summary>/i.test(pageJumpNavigation)) {
                errors.push(displayFile + ': on-page disclosure is missing its visible summary');
            }
            if (jumpTargets.join('|') !== guideExpectation.jumpTargets.join('|')) {
                errors.push(displayFile + ': on-page disclosure destinations or order are incorrect');
            }
        }

        const guideHandoff = /<section class="guide-handoff"[^>]*>([\s\S]*?)<\/section>/i
            .exec(html)?.[1] || '';
        if (!guideHandoff || !guideHandoff.includes(`href="${guideExpectation.handoffTarget}"`)) {
            errors.push(displayFile + ': guide-choice handoff is missing its companion-guide destination');
        }
        if (count(guideHandoff, /class="guide-handoff-option is-current"/g) !== 1) {
            errors.push(displayFile + ': guide-choice handoff must identify exactly one current guide');
        }

        if (guideExpectation.rehabilitationTargets) {
            const rehabilitationTargets = [...html.matchAll(
                /<p class="rehab-handoff">([\s\S]*?)<\/p>/gi
            )].flatMap((match) => [...match[1].matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)]
                .map((linkMatch) => linkMatch[1]));
            if (rehabilitationTargets.join('|') !== guideExpectation.rehabilitationTargets.join('|')) {
                errors.push(displayFile + ': diagnosis-specific rehabilitation handoffs are incomplete or out of order');
            }
        }
    }

    if (displayFile === 'prp-knee-osteoarthritis/index.html') {
        const heroActions = /<div class="landing-actions">([\s\S]*?)<\/div>/i.exec(html)?.[1] || '';
        const heroActionLabels = [...heroActions.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
            .map((match) => visibleAnchorText(match[1]));
        const expectedHeroActionLabels = [
            'Call 310-319-1234',
            'Request on UCLA Health',
            'Could PRP fit me?'
        ];
        if (heroActionLabels.join('|') !== expectedHeroActionLabels.join('|')) {
            errors.push(displayFile + ': hero scheduling and candidacy actions are missing or out of order');
        }

        const rehabilitationCard = /<div class="oa-answer-card"[^>]*>[\s\S]*?<h3>Keep rehabilitation central<\/h3>([\s\S]*?)<\/div>/i
            .exec(html)?.[1] || '';
        for (const target of [
            '../knee-osteoarthritis-exercises/',
            '../knee-osteoarthritis-advanced-exercises/'
        ]) {
            if (!rehabilitationCard.includes(`href="${target}"`)) {
                errors.push(displayFile + ': early rehabilitation card is missing ' + target);
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

const hepTemplate = readFileSync(join(scriptDirectory, 'hep-page.template'), 'utf8');
const hepTemplateNavigation = /<nav class="nav-links" id="navLinks" aria-label="Primary navigation">([\s\S]*?)<\/nav>/i
    .exec(hepTemplate)?.[1];
if (!hepTemplateNavigation) {
    errors.push('HEP page template is missing primary navigation');
} else {
    const templateAnchors = [...hepTemplateNavigation.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    const templateLabels = templateAnchors
        .map((match) => match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    const templateTargets = templateAnchors
        .map((match) => /\bhref="([^"]+)"/i.exec(match[1])?.[1] || '')
        .map((target) => target.replace(/^\.\.\//, '').replace(/^\//, ''));
    const templateActiveIndexes = templateAnchors
        .map((match, index) => /\bclass="[^"]*\bactive\b[^"]*"/i.test(match[1]) ? index : -1)
        .filter((index) => index >= 0);
    const templateCurrentEntries = templateAnchors
        .map((match, index) => ({
            index,
            value: /\baria-current="([^"]+)"/i.exec(match[1])?.[1] || ''
        }))
        .filter((entry) => entry.value);

    if (templateLabels.join('|') !== expectedPrimaryNavigationLabels.join('|')) {
        errors.push('HEP page template navigation labels or order do not match the patient-first menu');
    }
    if (templateTargets.join('|') !== expectedPrimaryNavigationTargets.join('|')) {
        errors.push('HEP page template navigation destinations do not match the patient-first menu');
    }
    templateAnchors.forEach((match, index) => {
        const ariaLabel = /\baria-label="([^"]+)"/i.exec(match[1])?.[1] || '';
        if (ariaLabel && !ariaLabel.toLowerCase().includes(templateLabels[index].toLowerCase())) {
            errors.push('HEP page template navigation accessible name must include its visible label');
        }
    });
    if (templateActiveIndexes.length !== 1 || templateActiveIndexes[0] !== 2) {
        errors.push('HEP page template must mark Exercise Library as active');
    }
    if (
        templateCurrentEntries.length !== 1
        || templateCurrentEntries[0].index !== 2
        || templateCurrentEntries[0].value !== 'location'
    ) {
        errors.push('HEP page template must mark Exercise Library as the current location');
    }
}

for (const match of hepTemplate.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1];
    const contents = match[2];
    const opensInNewTab = /\btarget="_blank"/i.test(attributes);
    const href = /\bhref="([^"]+)"/i.exec(attributes)?.[1] || '';
    const newTabCues = contents.match(/<span\b[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>\s*\(opens in a new tab\)\s*<\/span>/gi) || [];
    if (opensInNewTab && newTabCues.length !== 1) {
        errors.push('HEP page template target="_blank" link must contain exactly one hidden new-tab cue');
    }
    if (!opensInNewTab && newTabCues.length > 0) {
        errors.push('HEP page template has a hidden new-tab cue on a same-tab link');
    }
    if (opensInNewTab && /\baria-(?:label|labelledby)="/i.test(attributes)) {
        errors.push('HEP page template target="_blank" link must not override its descendant new-tab cue');
    }
    if (
        href.startsWith('https://cloud.h.uclahealth.org/appointment-request')
        && visibleAnchorText(contents) !== 'Request on UCLA Health'
    ) {
        errors.push('HEP page template UCLA appointment link must use the standard visible label');
    }
}

const expectedAnalyticsMinimums = new Map([
    ['exercise_program_print', hepPrograms.length * 2],
    ['exercise_video_load', hepPrograms.filter((program) => program.video).length],
    ['referral_instructions_click', 6]
]);
const expectedActionAnalyticsEvents = [
    'call_click',
    'appointment_request_click',
    'location_page_click',
    'directions_click',
    'official_profile_click',
    'exercise_program_print',
    'referral_instructions_click',
    'exercise_video_load'
];
const automaticAnalyticsEvents = [
    'page_view',
    ...expectedActionAnalyticsEvents
];
const actionCountWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const expectedActionDisclosure = `Only ${actionCountWords[expectedActionAnalyticsEvents.length]} intentional action types are measured`;
const sharedScript = readFileSync(join(root, 'script.js'), 'utf8');
const privacyPage = readFileSync(join(root, 'privacy', 'index.html'), 'utf8');
const homePage = readFileSync(join(root, 'index.html'), 'utf8');
const exerciseHubPage = readFileSync(join(root, 'home-exercise-programs', 'index.html'), 'utf8');
const notFoundPage = readFileSync(join(root, '404.html'), 'utf8');
const prpPage = readFileSync(join(root, 'prp-knee-osteoarthritis', 'index.html'), 'utf8');
const hyaluronicAcidPage = readFileSync(join(root, 'hyaluronic-acid-knee-osteoarthritis', 'index.html'), 'utf8');
const injectionComparisonPage = readFileSync(join(root, 'knee-osteoarthritis-injection-comparison', 'index.html'), 'utf8');
const locationsPage = readFileSync(join(root, 'locations', 'index.html'), 'utf8');

const homeHeroTitleMarkup = /<h1 class="hero-title" id="hero-title"[^>]*>([\s\S]*?)<\/h1>/i
    .exec(homePage)?.[1] || '';
const homeHeroTitleText = homeHeroTitleMarkup
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
if (homeHeroTitleText !== 'Nonsurgical care for joint pain and sports injuries.') {
    errors.push('Homepage hero H1 source text must retain literal whitespace between its visual lines');
}

// Keep the approved patient and referring-office pathways intact.
const hero = /<div class="hero-text">([\s\S]*?)<\/div>\s*<figure/i.exec(homePage)?.[1] || '';
for (const required of ['Westwood and West Hills', 'Jeremy Swisher, MD', 'locations/#insurance', 'locations/#referrals']) {
    if (!hero.includes(required)) errors.push('Homepage hero is missing patient-pathway detail: ' + required);
}
if (homePage.indexOf('id="expertise"') > homePage.indexOf('id="about"')) {
    errors.push('Homepage condition entry points should appear before the biography');
}
for (const required of ['id="insurance"', 'exact plan', 'referral or approval', 'self-pay estimate', 'not a confirmed appointment', 'UCLA&rsquo;s approved referral channels']) {
    if (!locationsPage.includes(required)) errors.push('Locations is missing appointment/referral guidance: ' + required);
}
if (locationsPage.includes('310-825-2631')) errors.push('Locations must use the currently verified clinic routing number');
const referralPdfPath = join(root, 'resources', 'jeremy-swisher-referral-guide.pdf');
if (!existsSync(referralPdfPath) || readFileSync(referralPdfPath).subarray(0, 5).toString() !== '%PDF-') {
    errors.push('Missing or invalid referral guide PDF');
}
for (const [name, html] of [['Homepage', homePage], ['Locations', locationsPage]]) {
    if (!/<a\b[^>]+href="(?:\.\.\/)?resources\/jeremy-swisher-referral-guide\.pdf"[^>]*\bdownload\b/.test(html)) {
        errors.push(name + ' must provide the downloadable referral guide');
    }
}

const firstSchedulingStep = /<ol class="care-steps">\s*<li class="care-step">([\s\S]*?)<\/li>/i
    .exec(locationsPage)?.[1] || '';
const firstSchedulingStepText = firstSchedulingStep
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
if (
    !/<h3>\s*Ask for Jeremy Swisher, MD\s*<\/h3>/i.test(firstSchedulingStep)
    || !firstSchedulingStepText.includes(
        'Request a new or follow-up sports medicine appointment with Jeremy Swisher, MD, then describe the body area, how long symptoms have been present, and whether there was a recent injury.'
    )
) {
    errors.push('Locations scheduling must tell callers to ask for Jeremy Swisher, MD');
}

const expectedWestHillsMapHref = 'https://www.google.com/maps/search/?api=1&amp;query=UCLA+Health+West+Hills+Orthopedic+Surgery%2C+7230+Medical+Center+Drive%2C+Suite+604%2C+West+Hills%2C+CA+91307';
for (const [label, page] of [
    ['Homepage', homePage],
    ['Locations page', locationsPage]
]) {
    const westHillsMapAnchor = /<a\b([^>]*)>(?:Directions to West Hills|Open West Hills in Google Maps)[\s\S]*?<\/a>/i
        .exec(page)?.[1] || '';
    const westHillsMapHref = /\bhref="([^"]+)"/i.exec(westHillsMapAnchor)?.[1] || '';
    if (westHillsMapHref !== expectedWestHillsMapHref) {
        errors.push(`${label} West Hills directions must point to the explicit 7230 Medical Center Drive address`);
    }
    if (/query_place_id=/i.test(westHillsMapHref)) {
        errors.push(`${label} West Hills directions must not reuse the physician's Westwood Google place ID`);
    }
}

for (const subtitle of [
    'Medical coverage &middot; NBA &middot; 2024&ndash;2025',
    'Medical coverage &middot; WNBA &middot; 2024&ndash;2025',
    'Medical coverage &middot; MLB &middot; 2024&ndash;2025'
]) {
    if (count(homePage, new RegExp('<span class="coverage-league">' + subtitle + '<\\/span>', 'g')) !== 1) {
        errors.push('Homepage professional coverage card is missing the exact subtitle: ' + subtitle);
    }
}

if (
    !homePage.includes('href="orthobiologics/" class="text-link">Explore the Orthobiologics overview')
) {
    errors.push('Homepage is missing the Orthobiologics discovery link');
}
if (!/<nav class="footer-care-nav"[\s\S]*?href="#publications">Research<\/a>[\s\S]*?<\/nav>/.test(homePage)) {
    errors.push('Homepage footer must retain a secondary link to Research');
}
for (const [label, page] of [
    ['PRP page', prpPage],
    ['Hyaluronic acid page', hyaluronicAcidPage],
    ['Injection comparison page', injectionComparisonPage]
]) {
    if (!/<a class="related-card" href="\.\.\/orthobiologics\/">/.test(page)) {
        errors.push(label + ' is missing its contextual Orthobiologics link');
    }
}

if (
    !homePage.includes('#pubToggleBtn,.pub-filters{display:none!important}')
    || !homePage.includes('#pubFullList,.pub-list.hidden{display:block!important}')
) {
    errors.push('Homepage must expose all publication content when JavaScript is unavailable');
}

const publicationPanel = /<div class="pub-full-list hidden" id="pubFullList">([\s\S]*?)<\/div><!-- end pub-full-list -->/i
    .exec(homePage)?.[1] || '';
const publicationCounts = [...publicationPanel.matchAll(
    /<button class="pub-filter(?: active)?"[^>]*>(?:Peer-Reviewed Work|Book Chapters|Other Scholarly Work) \((\d+)\)<\/button>/g
)].map((match) => Number(match[1]));
const publicationCardCount = (publicationPanel.match(/<(?:article|div) class="pub-card">/g) || []).length;
const publicationFilterTotal = publicationCounts.reduce((total, value) => total + value, 0);
const homepagePeerReviewedCount = Number(
    /<span>(\d+) Peer-Reviewed Works<\/span>/i.exec(homePage)?.[1] || 0
);
const homepagePublicationToggleCount = Number(
    /id="pubToggleBtn"[^>]*>Browse All (\d+) Scholarly Works<\/button>/i.exec(homePage)?.[1] || 0
);

if (publicationCounts.length !== 3) {
    errors.push('Homepage publication filters must expose counts for all three scholarly-work groups');
}
if (publicationCardCount !== publicationFilterTotal) {
    errors.push(
        `Homepage publication filters total ${publicationFilterTotal}, but the disclosure contains ${publicationCardCount} cards`
    );
}
if (homepagePeerReviewedCount !== publicationCounts[0]) {
    errors.push(
        `Homepage hero says ${homepagePeerReviewedCount} peer-reviewed works, but the publication filter contains ${publicationCounts[0] || 0}`
    );
}
if (homepagePublicationToggleCount !== publicationCardCount) {
    errors.push(
        `Homepage publication button says ${homepagePublicationToggleCount} scholarly works, but the disclosure contains ${publicationCardCount}`
    );
}
if (
    !sharedScript.includes("pubFullList?.querySelectorAll('.pub-card').length")
    || /TOTAL_PUBLICATIONS\s*=\s*\d+/.test(sharedScript)
) {
    errors.push('Shared script must derive the publication disclosure count from the rendered publication cards');
}

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
if (!privacyPage.includes(expectedActionDisclosure)) {
    errors.push('Privacy page must accurately disclose the intentional action count');
}
if (!sharedScript.includes("document.body?.classList.contains('not-found-page')")) {
    errors.push('Shared script does not suppress analytics on the error page');
}
if (
    !sharedScript.includes("actionElement.protocol === 'http:'")
    || !sharedScript.includes("actionElement.protocol === 'https:'")
) {
    errors.push('Shared script may delay phone or other custom-protocol links while measuring analytics');
}
if (
    sharedScript.indexOf("element.closest('.referral-card, section#referrals .clinician-panel')")
    > sharedScript.indexOf("element.closest('.contact-card, #contact')")
) {
    errors.push('Shared script classifies referral-card actions as generic contact actions');
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
    ['knee-thigh', 9],
    ['shoulder', 2],
    ['elbow', 2],
    ['hip', 2],
    ['foot-ankle', 7],
    ['hand-wrist', 2],
    ['back', 1]
]);
const exerciseHubRegions = [...exerciseHubPage.matchAll(/\sdata-program-region="([^"]+)"/g)]
    .map((match) => match[1]);
const exerciseHubProgramCardCount = count(exerciseHubPage, /<a class="program-card"(?:\s|>)/g);
const exerciseHubSearchAliases = [...exerciseHubPage.matchAll(/\sdata-program-search="([^"]+)"/g)]
    .map((match) => match[1].trim());
const exerciseHubAthleteCardCount = [...exerciseHubPage.matchAll(/\sdata-program-audience="([^"]+)"/g)]
    .filter((match) => match[1].split(/\s+/).includes('athlete')).length;
const exerciseHubSearchCards = [...exerciseHubPage.matchAll(/<a class="program-card"([^>]*)>([\s\S]*?)<\/a>/g)]
    .map((match) => {
        const attributes = match[1];
        const title = /<h3>([^<]+)<\/h3>/.exec(match[2])?.[1] || '';
        const aliases = /\bdata-program-search="([^"]+)"/.exec(attributes)?.[1] || '';
        const href = /\bhref="([^"]+)"/.exec(attributes)?.[1] || '';
        const text = normalizeProgramSearchForValidation(title + ' ' + aliases);
        return { href, text, words: new Set(text.split(' ')) };
    });
const exerciseHubFilters = [...exerciseHubPage.matchAll(/name="program-region"\s+value="([^"]+)"/g)]
    .map((match) => match[1]);
const exerciseHubFilterBadges = [...exerciseHubPage.matchAll(/<label for="hep-filter-([^"]+)">[^<]+<span>(\d+)<\/span><\/label>/g)]
    .map((match) => [match[1], Number.parseInt(match[2], 10)]);

if (exerciseHubRegions.length !== hepPrograms.length) {
    errors.push('Exercise library program-card count does not match hep-programs.json');
}
if (exerciseHubProgramCardCount !== exerciseHubRegions.length) {
    errors.push('Every exercise library program card must declare a supported body region');
}
if (
    exerciseHubSearchAliases.length !== hepPrograms.length
    || exerciseHubSearchAliases.some((aliases) => aliases.length < 12)
) {
    errors.push('Every exercise library program card must provide useful patient-friendly search aliases');
}
if (exerciseHubSearchCards.length !== hepPrograms.length) {
    errors.push('Exercise library search index does not map cleanly to every program card');
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
if (exerciseHubAthleteCardCount !== 7) {
    errors.push('Exercise library expected seven athlete progressions, found ' + exerciseHubAthleteCardCount);
}
if (!/<input type="checkbox"[^>]*\bdata-program-audience-filter\b/.test(exerciseHubPage)) {
    errors.push('Exercise library is missing the athlete-progression filter');
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
if (!/<input type="search"[^>]*\bdata-program-search\b[^>]*\bmaxlength="80"/.test(exerciseHubPage)) {
    errors.push('Exercise library is missing its length-limited program search input');
}
if (!/\bdata-program-search-clear\b/.test(exerciseHubPage)) {
    errors.push('Exercise library is missing its clear-search control');
}
if (!/\bdata-program-empty\b[^>]*\shidden/.test(exerciseHubPage)) {
    errors.push('Exercise library is missing its initially hidden no-results guidance');
}
if (!/\bdata-program-reset\b/.test(exerciseHubPage)) {
    errors.push('Exercise library is missing its reset-search control');
}
if (
    !sharedScript.includes('searchTokens.every')
    || !sharedScript.includes('matchesAudience')
    || !sharedScript.includes("programAudienceFilter.addEventListener('change'")
    || !sharedScript.includes('programEmptyState.hidden = visibleCount !== 0')
    || !sharedScript.includes("programSearchInput.addEventListener('input'")
) {
    errors.push('Shared script does not fully implement exercise-library search and empty-state behavior');
}

const patientSearchStopWords = new Set([
    'a', 'an', 'and', 'exercise', 'exercises', 'for', 'home', 'my', 'of', 'plan', 'plans',
    'physical', 'program', 'programs', 'pt', 'rehab', 'rehabilitation', 'routine', 'routines',
    'the', 'therapy', 'to', 'treatment', 'treatments'
]);
const patientSearchExpectations = new Map([
    ['OA', ['../hip-osteoarthritis-exercises/', '../knee-osteoarthritis-advanced-exercises/', '../knee-osteoarthritis-exercises/']],
    ['IT', ['../iliotibial-band-syndrome-exercises/']],
    ['ITBS', ['../iliotibial-band-syndrome-exercises/']],
    ['PFPS', ['../patellofemoral-pain-exercises/', '../patellofemoral-pain-return-to-running-exercises/']],
    ["runner's knee exercises", ['../patellofemoral-pain-exercises/', '../patellofemoral-pain-return-to-running-exercises/']],
    ['frozen shoulder rehab', ['../adhesive-capsulitis-exercises/']],
    ['tennis elbow exercises', ['../lateral-elbow-tendinopathy-exercises/']],
    ["golfer's elbow exercises", ['../medial-elbow-tendinopathy-exercises/']],
    ['plantar fasciopathy', ['../plantar-fasciitis-exercises/']],
    ['PTTD', ['../tibialis-posterior-tendinopathy-exercises/']],
    ['posterior tibial tendonitis exercises', ['../tibialis-posterior-tendinopathy-exercises/']],
    ['thumb CMC arthritis', ['../thumb-cmc-osteoarthritis-exercises/']],
    ["De Quervain's exercises", ['../de-quervain-tenosynovitis-exercises/']],
    ['heel pain exercises', ['../achilles-tendinopathy-exercises/', '../plantar-fasciitis-exercises/']],
    ['low back pain program', ['../low-back-pain-exercises/']],
    ['hip pain', ['../gluteal-tendinopathy-exercises/', '../hip-osteoarthritis-exercises/']],
    ['knee arthritis exercises', ['../knee-osteoarthritis-advanced-exercises/', '../knee-osteoarthritis-exercises/']],
    ['ankle instability rehab', ['../ankle-sprain-return-to-sport-exercises/', '../lateral-ankle-sprain-exercises/']],
    ['mommy thumb', ['../de-quervain-tenosynovitis-exercises/']]
]);

for (const [query, expectedHrefs] of patientSearchExpectations) {
    const normalizedQuery = normalizeProgramSearchForValidation(query);
    const tokens = normalizedQuery
        ? normalizedQuery.split(' ').filter((token) => !patientSearchStopWords.has(token))
        : [];
    const actualHrefs = exerciseHubSearchCards
        .filter((card) => tokens.every((token) => (
            token.length <= 2 ? card.words.has(token) : card.text.includes(token)
        )))
        .map((card) => card.href)
        .sort();
    const expected = [...expectedHrefs].sort();
    if (JSON.stringify(actualHrefs) !== JSON.stringify(expected)) {
        errors.push(
            'Exercise library search query "' + query + '" expected '
            + expected.join(', ') + ', found ' + actualHrefs.join(', ')
        );
    }
}
if (exerciseHubPage.indexOf('id="programs"') > exerciseHubPage.indexOf('class="clinician-panel"')) {
    errors.push('Exercise library must present the program chooser before the clinician panel');
}
if (/\bdata-analytics-event=/.test(exerciseHubPage.match(/<fieldset class="hep-filter-controls"[\s\S]*?<\/fieldset>/)?.[0] || '')) {
    errors.push('Exercise library search and body-region filters must not record health-related selections');
}

if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
} else {
    console.log('Validated structure, duplicate IDs, local links, fragments, assets, external-link security and new-tab disclosure, and dash policy across ' + htmlFiles.length + ' HTML files.');
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const programs = JSON.parse(readFileSync(join(scriptDirectory, 'hep-programs.json'), 'utf8'));
const hub = readFileSync(join(root, 'home-exercise-programs', 'index.html'), 'utf8');
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const requiredProgramFields = [
    'slug',
    'title',
    'seoTitle',
    'shortTitle',
    'conditionName',
    'reviewedDate',
    'metaDescription',
    'breadcrumb',
    'kicker',
    'h1',
    'summary',
    'authorityTitle',
    'fitIntro',
    'fit',
    'assessFirst',
    'redFlags',
    'programHeading',
    'programIntro',
    'frequency',
    'equipment',
    'checkpoint',
    'goal',
    'responseIntro',
    'green',
    'yellow',
    'red',
    'evaluation'
];
const requiredExerciseFields = ['name', 'dose', 'frequency', 'how', 'easier', 'harder'];
const errors = [];
const slugs = new Set();

function assert(condition, message) {
    if (!condition) errors.push(message);
}

function count(value, pattern) {
    return (value.match(pattern) || []).length;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function validateDate(value, field, slug) {
    assert(typeof value === 'string' && isoDatePattern.test(value), `${slug}: invalid ${field}`);
    if (typeof value !== 'string' || !isoDatePattern.test(value)) return;

    const date = new Date(value + 'T00:00:00Z');
    assert(!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value, `${slug}: invalid ${field}`);
}

function validateLocalHref(href, pagePath, page, slug) {
    if (
        !href
        || /^(?:https?:|mailto:|tel:)/.test(href)
        || href.startsWith('javascript:')
    ) {
        return;
    }

    const [pathPart, fragment] = href.split('#', 2);
    let targetPath = pagePath;
    if (pathPart) {
        const cleanPath = pathPart.split('?', 1)[0];
        targetPath = resolve(dirname(pagePath), cleanPath);
        if (cleanPath.endsWith('/')) targetPath = join(targetPath, 'index.html');
    }

    assert(existsSync(targetPath), `${slug}: missing local link target ${href}`);
    if (!existsSync(targetPath) || !fragment) return;

    const targetPage = targetPath === pagePath ? page : readFileSync(targetPath, 'utf8');
    assert(targetPage.includes(`id="${fragment}"`), `${slug}: missing local link fragment ${href}`);
}

for (const program of programs) {
    const slug = program.slug || '(missing slug)';
    assert(slugPattern.test(slug), `${slug}: invalid slug`);
    assert(!slugs.has(slug), `${slug}: duplicate slug`);
    slugs.add(slug);

    for (const field of requiredProgramFields) {
        assert(typeof program[field] === 'string' && program[field].trim(), `${slug}: missing ${field}`);
    }

    const publishedDate = program.publishedDate || '2026-07-17';
    const modifiedDate = program.modifiedDate || program.reviewedDate;
    validateDate(publishedDate, 'publishedDate', slug);
    validateDate(program.reviewedDate, 'reviewedDate', slug);
    validateDate(modifiedDate, 'modifiedDate', slug);
    assert(publishedDate <= modifiedDate, `${slug}: publishedDate is after modifiedDate`);
    assert(program.reviewedDate <= modifiedDate, `${slug}: reviewedDate is after modifiedDate`);

    assert(Array.isArray(program.authorityItems) && program.authorityItems.length === 3, `${slug}: expected three authority items`);
    assert(Array.isArray(program.proof) && program.proof.length === 3, `${slug}: expected three proof items`);
    assert(Array.isArray(program.exercises) && program.exercises.length >= 4 && program.exercises.length <= 6, `${slug}: expected four to six exercises`);
    assert(Array.isArray(program.progression) && program.progression.length >= 3, `${slug}: expected at least three progression stages`);
    assert(Array.isArray(program.readyItems) && program.readyItems.length >= 4, `${slug}: expected at least four readiness items`);
    assert(Array.isArray(program.faqs) && program.faqs.length >= 4, `${slug}: expected at least four FAQs`);
    assert(Array.isArray(program.sources) && program.sources.length >= 3, `${slug}: expected at least three sources`);
    assert(Array.isArray(program.related) && program.related.length === 3, `${slug}: expected three related links`);

    const exerciseNames = new Set();
    for (const exercise of program.exercises || []) {
        for (const field of requiredExerciseFields) {
            assert(typeof exercise[field] === 'string' && exercise[field].trim(), `${slug}: exercise is missing ${field}`);
        }
        assert(!exerciseNames.has(exercise.name), `${slug}: duplicate exercise name ${exercise.name}`);
        exerciseNames.add(exercise.name);
    }

    for (const source of program.sources || []) {
        assert(/^https:\/\//.test(source.href), `${slug}: source is not HTTPS: ${source.href}`);
        assert(typeof source.label === 'string' && source.label.trim(), `${slug}: source label is missing`);
    }

    for (const related of program.related || []) {
        assert(typeof related.eyebrow === 'string' && related.eyebrow.trim(), `${slug}: related link eyebrow is missing`);
        assert(typeof related.title === 'string' && related.title.trim(), `${slug}: related link title is missing`);
        if (related.description !== undefined) {
            assert(typeof related.description === 'string' && related.description.trim(), `${slug}: related link description is empty`);
        }
        if (related.linkLabel !== undefined) {
            assert(typeof related.linkLabel === 'string' && related.linkLabel.trim(), `${slug}: related link label is empty`);
        }
        const relatedMatch = /^\.\.\/([a-z0-9-]+)\/(?:#([a-z0-9-]+))?$/.exec(related.href);
        assert(Boolean(relatedMatch), `${slug}: invalid related link ${related.href}`);
        if (!relatedMatch) continue;

        const target = join(root, relatedMatch[1], 'index.html');
        assert(existsSync(target), `${slug}: missing related-link target ${related.href}`);
        if (existsSync(target) && relatedMatch[2]) {
            const targetPage = readFileSync(target, 'utf8');
            assert(targetPage.includes(`id="${relatedMatch[2]}"`), `${slug}: missing related-link fragment ${related.href}`);
        }
    }

    const pagePath = join(root, slug, 'index.html');
    assert(existsSync(pagePath), `${slug}: generated page is missing`);
    if (!existsSync(pagePath)) continue;

    const page = readFileSync(pagePath, 'utf8');
    const canonical = `https://jeremyswishermd.com/${slug}/`;
    assert(count(page, /<h1\b/g) === 1, `${slug}: expected one h1`);
    assert(page.includes(`class="landing-page hep-page hep-program-${slug}"`), `${slug}: program body class is incorrect`);
    assert(page.includes(`<link rel="canonical" href="${canonical}">`), `${slug}: canonical is incorrect`);
    assert(page.includes(`"datePublished": "${publishedDate}"`), `${slug}: schema published date is incorrect`);
    assert(page.includes(`"dateModified": "${modifiedDate}"`), `${slug}: schema modified date is incorrect`);
    assert(page.includes(`"lastReviewed": "${program.reviewedDate}"`), `${slug}: schema reviewed date is incorrect`);
    assert(!page.includes('{{'), `${slug}: unresolved template token`);
    assert(!page.includes('\u2014'), `${slug}: contains an em dash`);

    const renderedProgramFields = [
        'metaDescription',
        'breadcrumb',
        'kicker',
        'h1',
        'summary',
        'authorityTitle',
        'fitIntro',
        'fit',
        'assessFirst',
        'redFlags',
        'programHeading',
        'programIntro',
        'frequency',
        'equipment',
        'checkpoint',
        'goal',
        'responseIntro',
        'green',
        'yellow',
        'red',
        'evaluation'
    ];
    for (const field of renderedProgramFields) {
        assert(page.includes(escapeHtml(program[field])), `${slug}: generated page is stale for ${field}`);
    }

    const renderedGroups = [
        ['authorityItems', ['text']],
        ['proof', ['strong', 'span']],
        ['exercises', requiredExerciseFields],
        ['progression', ['title', 'text']],
        ['faqs', ['q', 'a']],
        ['sources', ['href', 'label']],
        ['related', ['href', 'eyebrow', 'title']]
    ];
    for (const [groupName, fields] of renderedGroups) {
        for (const item of program[groupName] || []) {
            for (const field of fields) {
                assert(page.includes(escapeHtml(item[field])), `${slug}: generated page is stale for ${groupName}.${field}`);
            }
        }
    }
    for (const related of program.related || []) {
        for (const optionalField of ['description', 'linkLabel']) {
            if (related[optionalField] !== undefined) {
                assert(page.includes(escapeHtml(related[optionalField])), `${slug}: generated page is stale for related.${optionalField}`);
            }
        }
    }
    for (const item of program.readyItems || []) {
        assert(page.includes(escapeHtml(item)), `${slug}: generated page is stale for readyItems`);
    }

    const idMatches = [...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const duplicateIds = idMatches.filter((id, index) => idMatches.indexOf(id) !== index);
    assert(duplicateIds.length === 0, `${slug}: duplicate id ${duplicateIds[0]}`);

    for (const [, href] of page.matchAll(/\shref="([^"]+)"/g)) {
        validateLocalHref(href, pagePath, page, slug);
    }

    assert(hub.includes(`href="../${slug}/"`), `${slug}: missing library card`);
    assert(
        sitemap.split(`<loc>${canonical}</loc>`).length - 1 === 1,
        `${slug}: sitemap must contain the canonical exactly once`
    );
}

assert(!hub.includes('\u2014'), 'Home exercise library contains an em dash');
assert(
    hub.includes('beginner and advanced describe exercise demand, not arthritis severity'),
    'Home exercise library must explain the knee OA beginner and advanced labels'
);
assert(count(hub, /class="program-card"/g) === programs.length, 'Library card count does not match program count');
assert(hub.includes(`"numberOfItems": ${programs.length}`), 'Library ItemList count does not match program count');

const cardSlugs = [...hub.matchAll(/<a class="program-card"[^>]*href="\.\.\/([a-z0-9-]+)\/"/g)]
    .map((match) => match[1]);
const itemListEntries = [...hub.matchAll(
    /\{\s*"@type":\s*"ListItem",\s*"position":\s*(\d+),\s*"name":\s*"[^"]+",\s*"url":\s*"https:\/\/jeremyswishermd\.com\/([a-z0-9-]+)\/"\s*\}/g
)].map((match) => ({ position: Number.parseInt(match[1], 10), slug: match[2] }));
const itemListSlugs = itemListEntries.map((entry) => entry.slug);

assert(cardSlugs.length === programs.length, 'Library card slug count does not match program count');
assert(new Set(cardSlugs).size === cardSlugs.length, 'Library contains a duplicate program card');
assert(itemListEntries.length === programs.length, 'Library ItemList entry count does not match program count');
assert(new Set(itemListSlugs).size === itemListSlugs.length, 'Library ItemList contains a duplicate program');
assert(
    itemListEntries.every((entry, index) => entry.position === index + 1),
    'Library ItemList positions must be continuous and start at one'
);
assert(
    cardSlugs.every((slug, index) => itemListSlugs[index] === slug),
    'Library ItemList order does not match the visible program-card order'
);

if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
} else {
    console.log(`Validated ${programs.length} home exercise programs, generated pages, library cards, dates, local relationships, and sitemap entries.`);
}

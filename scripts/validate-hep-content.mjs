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
    assert(page.includes(`<link rel="canonical" href="${canonical}">`), `${slug}: canonical is incorrect`);
    assert(page.includes(`"datePublished": "${publishedDate}"`), `${slug}: schema published date is incorrect`);
    assert(page.includes(`"dateModified": "${modifiedDate}"`), `${slug}: schema modified date is incorrect`);
    assert(page.includes(`"lastReviewed": "${program.reviewedDate}"`), `${slug}: schema reviewed date is incorrect`);
    assert(!page.includes('{{'), `${slug}: unresolved template token`);
    assert(!page.includes('\u2014'), `${slug}: contains an em dash`);

    const idMatches = [...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const duplicateIds = idMatches.filter((id, index) => idMatches.indexOf(id) !== index);
    assert(duplicateIds.length === 0, `${slug}: duplicate id ${duplicateIds[0]}`);

    for (const [, href] of page.matchAll(/\shref="([^"]+)"/g)) {
        validateLocalHref(href, pagePath, page, slug);
    }

    assert(hub.includes(`href="../${slug}/"`), `${slug}: missing library card`);
    assert(sitemap.includes(`<loc>${canonical}</loc>`), `${slug}: missing sitemap entry`);
}

assert(!hub.includes('\u2014'), 'Home exercise library contains an em dash');
assert(count(hub, /class="program-card"/g) === programs.length, 'Library card count does not match program count');
assert(hub.includes(`"numberOfItems": ${programs.length}`), 'Library ItemList count does not match program count');

if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
} else {
    console.log(`Validated ${programs.length} home exercise programs, generated pages, library cards, dates, local relationships, and sitemap entries.`);
}

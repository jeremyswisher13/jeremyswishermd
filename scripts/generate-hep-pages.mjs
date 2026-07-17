import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const template = readFileSync(join(scriptDirectory, 'hep-page.template'), 'utf8');
const programs = JSON.parse(readFileSync(join(scriptDirectory, 'hep-programs.json'), 'utf8'));
const siteRoot = 'https://jeremyswishermd.com';

function formatReviewedDate(value, slug) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error('Invalid reviewedDate for ' + slug + ': expected YYYY-MM-DD');
    }

    const date = new Date(value + 'T00:00:00Z');
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new Error('Invalid reviewedDate for ' + slug + ': ' + value);
    }

    return new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(date);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderAuthorityItems(items) {
    return items.map((item) => [
        '                            <li>',
        '                                <span class="material-symbols-outlined" aria-hidden="true">' + escapeHtml(item.icon) + '</span>',
        '                                <span>' + escapeHtml(item.text) + '</span>',
        '                            </li>'
    ].join('\n')).join('\n');
}

function renderProofItems(items) {
    return items.map((item) =>
        '                <li class="proof-stat"><strong>' + escapeHtml(item.strong) + '</strong><span>' + escapeHtml(item.span) + '</span></li>'
    ).join('\n');
}

function renderExercises(items) {
    return items.map((item, index) => [
        '                            <li class="exercise-item">',
        '                                <span class="exercise-number" aria-hidden="true">' + String(index + 1).padStart(2, '0') + '</span>',
        '                                <div class="exercise-content">',
        '                                    <div class="exercise-heading">',
        '                                        <div><span class="exercise-label">Exercise ' + (index + 1) + '</span><h3>' + escapeHtml(item.name) + '</h3></div>',
        '                                        <span class="exercise-frequency">' + escapeHtml(item.frequency) + '</span>',
        '                                    </div>',
        '                                    <p class="exercise-dose"><strong>Dose</strong><span>' + escapeHtml(item.dose) + '</span></p>',
        '                                    <p>' + escapeHtml(item.how) + '</p>',
        '                                    <div class="exercise-cues">',
        '                                        <div><strong>Make it easier</strong><p>' + escapeHtml(item.easier) + '</p></div>',
        '                                        <div><strong>Progress it</strong><p>' + escapeHtml(item.harder) + '</p></div>',
        '                                    </div>',
        '                                    <p class="print-only print-exercise-prescription"><strong>My starting dose or notes</strong><span aria-hidden="true"></span></p>',
        '                                </div>',
        '                            </li>'
    ].join('\n')).join('\n');
}

function renderProgression(items) {
    return items.map((item) => [
        '                            <li class="care-step">',
        '                                <div><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.text) + '</p></div>',
        '                            </li>'
    ].join('\n')).join('\n');
}

function renderReadyItems(items) {
    return items.map((item) => '                            <li>' + escapeHtml(item) + '</li>').join('\n');
}

function renderFaqs(items) {
    return items.map((item) =>
        '                        <details class="faq-item"><summary>' + escapeHtml(item.q) + '</summary><p>' + escapeHtml(item.a) + '</p></details>'
    ).join('\n');
}

function renderSources(items) {
    return items.map((item) =>
        '                            <li><a href="' + escapeHtml(item.href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.label) + '</a></li>'
    ).join('\n');
}

function renderRelated(items) {
    return items.map((item) => [
        '                    <a class="related-card" href="' + escapeHtml(item.href) + '">',
        '                        <span>' + escapeHtml(item.eyebrow) + '</span><strong>' + escapeHtml(item.title) + '</strong>',
        '                        <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>',
        '                    </a>'
    ].join('\n')).join('\n');
}

function buildSchema(program) {
    const canonical = siteRoot + '/' + program.slug + '/';
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'MedicalWebPage',
                '@id': canonical + '#webpage',
                url: canonical,
                name: program.seoTitle + ' | Jeremy Swisher, MD',
                description: program.metaDescription,
                inLanguage: 'en-US',
                datePublished: '2026-07-17',
                dateModified: program.reviewedDate,
                lastReviewed: program.reviewedDate,
                author: { '@id': siteRoot + '/#jeremy-swisher' },
                reviewedBy: { '@id': siteRoot + '/#jeremy-swisher' },
                medicalAudience: { '@type': 'MedicalAudience', audienceType: 'Patient' },
                about: { '@id': canonical + '#condition' },
                mainEntity: { '@id': canonical + '#exercise-plan' },
                breadcrumb: { '@id': canonical + '#breadcrumb' }
            },
            {
                '@type': 'ExercisePlan',
                '@id': canonical + '#exercise-plan',
                name: program.title,
                description: program.summary,
                url: canonical,
                about: { '@id': canonical + '#condition' },
                activityFrequency: program.frequency
            },
            {
                '@type': 'MedicalCondition',
                '@id': canonical + '#condition',
                name: program.conditionName
            },
            {
                '@type': 'BreadcrumbList',
                '@id': canonical + '#breadcrumb',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: siteRoot + '/' },
                    { '@type': 'ListItem', position: 2, name: 'Home Exercise Programs', item: siteRoot + '/home-exercise-programs/' },
                    { '@type': 'ListItem', position: 3, name: program.breadcrumb, item: canonical }
                ]
            },
            {
                '@type': 'Person',
                '@id': siteRoot + '/#jeremy-swisher',
                name: 'Jeremy R. Swisher',
                honorificSuffix: 'MD',
                jobTitle: 'Primary Care Sports Medicine Physician',
                url: siteRoot + '/',
                worksFor: {
                    '@type': 'Organization',
                    name: 'UCLA Health',
                    url: 'https://www.uclahealth.org/'
                },
                sameAs: ['https://www.uclahealth.org/providers/jeremy-swisher']
            }
        ]
    };
}

for (const program of programs) {
    const canonical = siteRoot + '/' + program.slug + '/';
    const reviewedDate = formatReviewedDate(program.reviewedDate, program.slug);
    const replacements = {
        TITLE: program.title,
        SEO_TITLE: program.seoTitle,
        SHORT_TITLE: program.shortTitle,
        META_DESCRIPTION: program.metaDescription,
        CANONICAL: canonical,
        REVIEWED_DATE_ISO: program.reviewedDate,
        REVIEWED_DATE: reviewedDate,
        SCHEMA: JSON.stringify(buildSchema(program), null, 2).split('\n').map((line) => '    ' + line).join('\n'),
        BREADCRUMB: program.breadcrumb,
        KICKER: program.kicker,
        H1: program.h1,
        SUMMARY: program.summary,
        PROGRAM_LEVEL: program.programLevel || 'Starter program',
        AUTHORITY_TITLE: program.authorityTitle,
        AUTHORITY_ITEMS: renderAuthorityItems(program.authorityItems),
        PROOF_ITEMS: renderProofItems(program.proof),
        FIT_INTRO: program.fitIntro,
        FIT: program.fit,
        ASSESS_FIRST: program.assessFirst,
        RED_FLAGS: program.redFlags,
        PROGRAM_HEADING: program.programHeading,
        PROGRAM_INTRO: program.programIntro,
        FREQUENCY: program.frequency,
        EQUIPMENT: program.equipment,
        CHECKPOINT: program.checkpoint,
        GOAL: program.goal,
        EXERCISES: renderExercises(program.exercises),
        RESPONSE_INTRO: program.responseIntro,
        GREEN: program.green,
        YELLOW: program.yellow,
        RED: program.red,
        PROGRESSION: renderProgression(program.progression),
        READY_ITEMS: renderReadyItems(program.readyItems),
        EVALUATION: program.evaluation,
        FAQS: renderFaqs(program.faqs),
        SOURCES: renderSources(program.sources),
        RELATED: renderRelated(program.related)
    };

    let output = template;
    for (const [token, value] of Object.entries(replacements)) {
        output = output.replaceAll('{{' + token + '}}', escapeHtml(value));
    }

    const htmlTokens = [
        'SCHEMA',
        'AUTHORITY_ITEMS',
        'PROOF_ITEMS',
        'EXERCISES',
        'PROGRESSION',
        'READY_ITEMS',
        'FAQS',
        'SOURCES',
        'RELATED'
    ];
    for (const token of htmlTokens) {
        output = output.replaceAll(escapeHtml(replacements[token]), replacements[token]);
    }

    if (output.includes('{{')) {
        throw new Error('Unresolved template token in ' + program.slug);
    }

    const outputDirectory = join(root, program.slug);
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(join(outputDirectory, 'index.html'), output);
}

console.log('Generated ' + programs.length + ' home exercise program pages.');

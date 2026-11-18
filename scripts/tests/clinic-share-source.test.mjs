import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../../share-program/index.html', import.meta.url), 'utf8');
const programs = JSON.parse(readFileSync(new URL('../hep-programs.json', import.meta.url), 'utf8'));
const vendor = readFileSync(new URL('../../share-program/vendor/qrcodegen-v1.8.0.js', import.meta.url), 'utf8');

test('clinic select and embedded sharing data match all maintained programs', () => {
    const embedded = JSON.parse(html.match(/id="clinic-program-data">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(embedded, programs.map(({slug, title}) => ({slug, title})));
    const optionValues = [...html.matchAll(/<option value="([^"]+)" id="program=[^"]+">/g)].map(match => match[1]);
    assert.deepEqual(optionValues, programs.map(program => program.slug));
    for (const {slug} of programs) assert.ok(html.includes(`id="program=${slug}"`));
    assert.match(html, /<option value="">Choose a program<\/option>/);
    assert.match(html, /<textarea[^>]+id="clinic-program-url"[^>]+readonly/);
    assert.doesNotMatch(html, /<input\b/);
});

// These addresses are already encoded on patient handouts in circulation.
test('printed patient QR destinations retain their published canonical URLs', () => {
    const sitemap = readFileSync(new URL('../../sitemap.xml', import.meta.url), 'utf8');
    const printedRoutes = [
        'achilles-tendinopathy-exercises',
        'adhesive-capsulitis-exercises',
        'gluteal-tendinopathy-exercises',
        'home-exercise-programs',
        'hyaluronic-acid-knee-osteoarthritis',
        'knee-osteoarthritis-exercises',
        'knee-osteoarthritis',
        'lateral-elbow-tendinopathy-exercises',
        'msk-ultrasound-guided-procedures',
        'orthobiologics',
        'patellar-tendinopathy-exercises',
        'patellofemoral-pain-exercises',
        'plantar-fasciitis-exercises',
        'prp-knee-osteoarthritis',
        'rotator-cuff-pain-exercises',
        'tendon-pain',
    ];
    for (const route of printedRoutes) {
        const url = `https://jeremyswishermd.com/${route}/`;
        const page = readFileSync(new URL(`../../${route}/index.html`, import.meta.url), 'utf8');
        assert.ok(sitemap.includes(`<loc>${url}</loc>`), url);
        assert.ok(page.includes(`<link rel="canonical" href="${url}">`), url);
    }
});

test('official vendored QR release is unchanged and generates a distinct valid-size symbol for every canonical program', () => {
    assert.equal(createHash('sha256').update(vendor).digest('hex'), '6a1116192ed1dd67fa1bf31e77f5817103d71c23bbac24c382e698b7668bdd01');
    const context = vm.createContext({});
    vm.runInContext(vendor, context);
    const matrices = new Set();
    for (const program of programs) {
        const { QrCode } = context.qrcodegen;
        const qr = QrCode.encodeText(`https://jeremyswishermd.com/${program.slug}/`, QrCode.Ecc.MEDIUM);
        assert.equal(qr.size, qr.version * 4 + 17);
        assert.ok(qr.version >= 1 && qr.version <= 40);
        assert.ok(qr.errorCorrectionLevel.ordinal >= QrCode.Ecc.MEDIUM.ordinal);
        const matrix = [];
        for (let y = 0; y < qr.size; y += 1) {
            for (let x = 0; x < qr.size; x += 1) matrix.push(qr.getModule(x, y) ? '1' : '0');
        }
        matrices.add(matrix.join(''));
    }
    assert.equal(matrices.size, programs.length);
});

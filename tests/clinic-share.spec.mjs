import { readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const programs = JSON.parse(readFileSync(new URL('../scripts/hep-programs.json', import.meta.url), 'utf8'));
const canonical = program => `https://jeremyswishermd.com/${program.slug}/`;
const vendorSource = readFileSync(new URL('../share-program/vendor/qrcodegen-v1.8.0.js', import.meta.url), 'utf8');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' });

async function localOnly(context, baseURL) {
    const origin = new URL(baseURL).origin;
    const externalRequests = [];
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
            externalRequests.push(url.href);
            return route.abort();
        }
        return route.continue();
    });
    return externalRequests;
}

test('clinic tool starts with an explicit choice and shares every maintained canonical program', async ({ context, page, baseURL }) => {
    const externalRequests = await localOnly(context, baseURL);
    // Record the input to the actual bundled encoder, before the sharing tool runs.
    await context.route('**/share-program/vendor/qrcodegen-v1.8.0.js*', route => route.fulfill({
        contentType: 'application/javascript',
        body: `${vendorSource}\nwindow.__qrInputs = []; const originalEncodeText = qrcodegen.QrCode.encodeText; qrcodegen.QrCode.encodeText = function(text, ecc) { window.__qrInputs.push(text); return originalEncodeText.call(this, text, ecc); };`,
    }));
    await page.goto('/share-program/');
    const select = page.getByLabel('Home exercise program', { exact: true });
    await expect(select).toHaveValue('');
    await expect(select.locator('option')).toHaveCount(programs.length + 1);
    await expect(page.locator('[data-clinic-card]')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print program card', exact: true })).toBeHidden();
    for (const program of programs) {
        await select.selectOption(program.slug);
        await expect(page.locator('[data-clinic-title]')).toHaveText(program.title);
        await expect(page.getByLabel('Program link', { exact: true })).toHaveValue(canonical(program));
        await expect(page.locator('[data-clinic-open]')).toHaveAttribute('href', canonical(program));
        await expect(page.locator('[data-clinic-card-url]')).toHaveText(canonical(program));
        await expect(page.locator('[data-clinic-card-url]')).toHaveAttribute('href', canonical(program));
        const svg = page.locator('[data-clinic-qr] svg');
        await expect(svg).toBeVisible();
        await expect(svg).toHaveAttribute('role', 'img');
        await expect(svg).toHaveAttribute('aria-label', `QR code for ${program.title}. The same program link is below.`);
        expect(await page.evaluate(() => window.__qrInputs.at(-1))).toBe(canonical(program));
        // Check all rendered modules against the encoder's complete matrix, including its quiet zone.
        expect(await svg.evaluate((element, url) => {
            const qr = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM);
            const expected = [];
            for (let y = 0; y < qr.size; y += 1) {
                for (let x = 0; x < qr.size; x += 1) {
                    if (qr.getModule(x, y)) expected.push(`M${x + 4},${y + 4}h1v1h-1z`);
                }
            }
            return element.getAttribute('viewBox') === `0 0 ${qr.size + 8} ${qr.size + 8}`
                && element.querySelector('path').getAttribute('d') === expected.join('')
                && element.querySelector('rect').getAttribute('fill') === '#fff';
        }, canonical(program))).toBe(true);
    }
    await select.selectOption('');
    await expect(page.locator('[data-clinic-card]')).toBeHidden();
    await expect(page.locator('[data-clinic-status]')).toHaveText('Choose a program to create its card.');
    expect(externalRequests).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('copy succeeds locally and clipboard rejection selects the visible manual link', async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await context.addInitScript(() => {
        window.__copiedLinks = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async text => {
                if (window.__rejectCopy) throw new Error('Clipboard permission denied');
                window.__copiedLinks.push(text);
            },
        } });
    });
    await page.goto(`/share-program/#program=${programs[0].slug}`);
    await page.getByRole('button', { name: 'Copy program link', exact: true }).click();
    await expect(page.locator('[data-clinic-status]')).toHaveText('Program link copied.');
    expect(await page.evaluate(() => window.__copiedLinks)).toEqual([canonical(programs[0])]);
    await page.evaluate(() => { window.__rejectCopy = true; });
    await page.getByRole('button', { name: 'Copy program link', exact: true }).click();
    const field = page.getByLabel('Program link', { exact: true });
    await expect(field).toBeFocused();
    expect(await field.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd))).toBe(canonical(programs[0]));
    await expect(page.locator('[data-clinic-status]')).toContainText('The program link is selected');
});

test('fragment links only preselect maintained programs and unknown values stay unselected', async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await page.goto(`/share-program/#program=${programs.at(-1).slug}`);
    await expect(page.getByLabel('Home exercise program', { exact: true })).toHaveValue(programs.at(-1).slug);
    await page.goto('/share-program/#program=https%3A%2F%2Fexample.com%2F');
    await expect(page.getByLabel('Home exercise program', { exact: true })).toHaveValue('');
    await expect(page.locator('[data-clinic-card]')).toBeHidden();
    await expect(page.locator('[data-clinic-status]')).toContainText('Choose a program from the list.');
});

test('QR script failure preserves a complete printable link card', async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await context.route('**/share-program/vendor/qrcodegen-v1.8.0.js*', route => route.abort());
    await page.goto(`/share-program/#program=${programs[0].slug}`);
    await expect(page.locator('[data-clinic-card]')).toBeVisible();
    await expect(page.locator('[data-clinic-qr-fallback]')).toBeVisible();
    await expect(page.locator('[data-clinic-card-url]')).toHaveAttribute('href', canonical(programs[0]));
    await expect(page.getByRole('button', { name: 'Print program card', exact: true })).toBeVisible();
});

test('print shows one small card with the full link and program fitting guidance', async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await context.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; });
    const program = programs.find(item => item.slug === 'advanced-meniscus-rehabilitation-exercises');
    await page.goto(`/share-program/#program=${program.slug}`);
    await page.getByRole('button', { name: 'Print program card', exact: true }).click();
    expect(await page.evaluate(() => window.__printCalls)).toBe(1);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.navbar')).toBeHidden();
    await expect(page.locator('.clinic-controls')).toBeHidden();
    await expect(page.locator('.footer')).toBeHidden();
    await expect(page.locator('[data-clinic-card]')).toBeVisible();
    await expect(page.locator('[data-clinic-card-url]')).toHaveText(canonical(program));
    await expect(page.locator('.clinic-card-note')).toContainText('This program was chosen by your clinician.');
    await expect(page.locator('.clinic-card-note')).toContainText('stages, exercise frequency');
    const box = await page.locator('[data-clinic-card]').boundingBox();
    expect(box.height).toBeLessThan(9.3 * 96);
    expect(box.width).toBeLessThanOrEqual(5.8 * 96 + 1);
    for (const format of ['Letter', 'A4']) {
        const pdf = await page.pdf({ format, printBackground: false, preferCSSPageSize: true });
        expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    }
});

test('keyboard controls, mobile layout, and accessibility remain usable for a long program name', async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto('/share-program/');
    const select = page.getByLabel('Home exercise program', { exact: true });
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-clinic-card]')).toBeVisible();
    await select.selectOption('advanced-meniscus-rehabilitation-exercises');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Copy program link', exact: true }).focus();
    await expect(page.getByRole('button', { name: 'Copy program link', exact: true })).toBeFocused();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
});

test('without JavaScript the exercise library remains available', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 320, height: 812 } });
    await localOnly(context, baseURL);
    const page = await context.newPage();
    await page.goto('/share-program/');
    await expect(page.locator('[data-clinic-workspace]')).toBeHidden();
    await expect(page.locator('[data-clinic-fallback]')).toBeVisible();
    await expect(page.locator('[data-clinic-fallback] a')).toHaveAttribute('href', '../home-exercise-programs/');
    await context.close();
});

test('production analytics receive no program choice, canonical link, copy, QR, or card-print event', async ({ context, page }) => {
    const origin = 'https://jeremyswishermd.com';
    const requests = [];
    const contentTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        requests.push({ url: url.href, body: route.request().postData() });
        if (url.origin !== origin) return route.abort();
        const file = resolve(root, `.${decodeURIComponent(url.pathname)}`, ...(url.pathname.endsWith('/') ? ['index.html'] : []));
        if (!file.startsWith(root + sep)) return route.abort();
        try {
            return route.fulfill({ contentType: contentTypes[extname(file)] || 'application/octet-stream', body: readFileSync(file) });
        } catch {
            return route.fulfill({ status: 404, body: 'Not found' });
        }
    });
    await context.addInitScript(() => {
        window.__clinicAnalyticsEvents = [];
        window.sa_loaded = true;
        window.sa_event = (name, metadata) => window.__clinicAnalyticsEvents.push({ name, metadata });
        window.print = () => {};
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
    });
    const program = programs.at(-1);
    await page.goto(`${origin}/share-program/#program=${program.slug}`);
    await page.getByLabel('Home exercise program', { exact: true }).selectOption(programs[0].slug);
    await page.getByRole('button', { name: 'Copy program link', exact: true }).click();
    await page.getByRole('button', { name: 'Print program card', exact: true }).click();
    expect(await page.evaluate(() => window.__clinicAnalyticsEvents)).toEqual([
        { name: 'page_view', metadata: { page: '/share-program/', cta_location: 'page' } },
    ]);
    const sent = JSON.stringify(requests);
    expect(sent).not.toContain(program.slug);
    expect(sent).not.toContain(programs[0].slug);
});

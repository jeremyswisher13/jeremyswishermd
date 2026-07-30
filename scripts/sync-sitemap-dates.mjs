import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const sitemapPath = join(root, 'sitemap.xml');
const siteOrigin = 'https://jeremyswishermd.com';
const checkOnly = process.argv.includes('--check');

function pagePathForUrl(url) {
    const parsed = new URL(url);
    if (parsed.origin !== siteOrigin) {
        throw new Error('Unexpected sitemap origin: ' + parsed.origin);
    }

    const relativePath = parsed.pathname.replace(/^\/|\/$/g, '');
    return relativePath ? join(root, relativePath, 'index.html') : join(root, 'index.html');
}

function modifiedDateForPage(pagePath) {
    const page = readFileSync(pagePath, 'utf8');
    const matches = [...page.matchAll(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})(?:T[^"]*)?"/g)];
    if (matches.length === 0) {
        throw new Error('Missing structured dateModified in ' + pagePath);
    }

    const dates = new Set(matches.map((match) => match[1]));
    if (dates.size !== 1) {
        throw new Error('Conflicting structured dateModified values in ' + pagePath);
    }

    return matches[0][1];
}

const sitemap = readFileSync(sitemapPath, 'utf8');
let updatedCount = 0;

const updatedSitemap = sitemap.replace(
    /(<url>\s*<loc>)(https:\/\/jeremyswishermd\.com\/[^<]*)(<\/loc>\s*<lastmod>)(\d{4}-\d{2}-\d{2})(<\/lastmod>\s*<\/url>)/g,
    (block, prefix, url, middle, currentDate, suffix) => {
        const modifiedDate = modifiedDateForPage(pagePathForUrl(url));
        updatedCount += 1;
        return prefix + url + middle + modifiedDate + suffix;
    }
);

if (updatedCount === 0) {
    throw new Error('No sitemap entries were updated.');
}

if (checkOnly) {
    if (updatedSitemap !== sitemap) {
        throw new Error('Sitemap dates are out of sync. Run node scripts/sync-sitemap-dates.mjs.');
    }
    console.log('Validated ' + updatedCount + ' sitemap dates against structured page metadata.');
} else {
    writeFileSync(sitemapPath, updatedSitemap);
    console.log('Synchronized ' + updatedCount + ' sitemap dates from structured page metadata.');
}

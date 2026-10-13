import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { packageSite, publicSiteFiles } from '../package-site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('the release artifact preserves public bytes and excludes tooling and reports', t => {
  const destination = mkdtempSync(join(tmpdir(), 'swishermd-public-'));
  t.after(() => rmSync(destination, { recursive: true, force: true }));
  const files = packageSite(root, destination);
  for (const file of files) assert.deepEqual(readFileSync(join(destination, file)), readFileSync(join(root, file)), file);
  for (const file of ['scripts', 'tests', '.github', '.git', '.claude', '.quality-results', 'node_modules', 'package.json', 'playwright.config.mjs', 'share-program/vendor/README.md']) {
    assert.equal(existsSync(join(destination, file)), false, `${file} is not public`);
  }
  for (const file of ['CNAME', '404.html', 'privacy/index.html', 'share-program/index.html', 'resources/jeremy-swisher-referral-guide.pdf', 'share-program/vendor/qrcodegen-v1.8.0.js']) {
    assert.ok(files.includes(file), `${file} must remain available`);
  }

  // A new public dependency cannot silently disappear from the allowlisted
  // deployment. Resolve local links, responsive images, and CSS assets against
  // the actual release file list, rather than the full repository.
  const available = new Set(files);
  for (const file of files.filter(file => /\.(?:html|css)$/.test(file))) {
    const source = readFileSync(join(destination, file), 'utf8');
    const references = [
      ...[...source.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map(match => match[1]),
      ...[...source.matchAll(/\bsrcset=["']([^"']+)["']/g)].flatMap(match => match[1].split(',').map(candidate => candidate.trim().split(/\s+/)[0])),
      ...[...source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)].map(match => match[1]),
    ];
    for (const reference of references) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) continue;
      const url = new URL(reference.replaceAll('&amp;', '&'), `https://jeremyswishermd.com/${file}`);
      let target = decodeURIComponent(url.pathname).slice(1);
      if (target.endsWith('/') || !target) target += 'index.html';
      assert.ok(available.has(target), `${file}: public dependency ${reference} is missing from the release`);
    }
  }
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'swishermd-package-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of publicSiteFiles(root)) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file === 'sitemap.xml' ? readFileSync(join(root, file)) : 'public fixture');
  }
  return directory;
}

test('packaging rejects symlinks rather than exposing their targets', t => {
  const directory = fixture(t);
  unlinkSync(join(directory, 'script.js'));
  symlinkSync(join(root, 'package.json'), join(directory, 'script.js'));
  assert.throws(() => publicSiteFiles(directory), /symlink/);
});

test('packaging rejects internal sitemap routes and nonempty output directories', t => {
  const directory = fixture(t);
  const original = readFileSync(join(directory, 'sitemap.xml'), 'utf8');
  for (const route of ['https://jeremyswishermd.com/scripts/', 'https://jeremyswishermd.com/.github/', 'https://example.com/']) {
    writeFileSync(join(directory, 'sitemap.xml'), `<urlset><url><loc>${route}</loc></url></urlset>`);
    assert.throws(() => publicSiteFiles(directory), /(?:Internal directory|Unsupported public sitemap)/);
  }
  writeFileSync(join(directory, 'sitemap.xml'), original);
  assert.throws(() => packageSite(directory, directory), /destination must be empty/);
});

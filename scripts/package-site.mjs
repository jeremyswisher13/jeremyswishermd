import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');

// Everything outside this public allowlist stays out of GitHub Pages, including
// tests, authoring scripts, dependencies, reports, and repository metadata.
const fixedPublicFiles = [
  'index.html', '404.html', 'CNAME', 'robots.txt', 'sitemap.xml',
  'styles.css', 'landing-pages.css', 'navigation-nojs.css', 'script.js',
  'hep-session.css', 'hep-session.js', 'hep-workout.js',
  'resources/jeremy-swisher-referral-guide.pdf',
  'share-program/share-program.css', 'share-program/share-program.js',
  'share-program/vendor/qrcodegen-v1.8.0.js',
  'fonts/INTER-OFL.txt', 'fonts/MATERIAL-SYMBOLS-APACHE-2.0.txt', 'fonts/NEWSREADER-OFL.txt',
];

export function publicSiteFiles(root) {
  const files = new Set(fixedPublicFiles);
  const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)];
  if (!locations.length) throw new Error('The public sitemap must contain page routes.');
  for (const [, location] of locations) {
    const url = new URL(location);
    // Page routes are currently flat. A new route format requires an explicit
    // packaging change instead of allowing a sitemap entry to expose internals.
    if (url.origin !== 'https://jeremyswishermd.com' || url.search || url.hash
      || !/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?$/.test(url.pathname)) {
      throw new Error(`Unsupported public sitemap route: ${location}`);
    }
    const route = url.pathname.slice(1);
    if (['scripts/', 'tests/', 'node-modules/', 'audits/'].includes(route)) {
      throw new Error(`Internal directory cannot be a public route: ${route}`);
    }
    files.add(`${route}index.html`);
  }
  for (const [directory, extension] of [
    ['images', /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i],
    ['fonts', /\.woff2$/i],
  ]) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (extension.test(entry.name) && !entry.name.startsWith('.')) files.add(`${directory}/${entry.name}`);
    }
  }
  for (const file of files) {
    let path = root;
    for (const part of file.split('/')) {
      path = join(path, part);
      if (lstatSync(path).isSymbolicLink()) throw new Error(`Public file cannot contain a symlink: ${file}`);
    }
    if (!lstatSync(path).isFile()) throw new Error(`Public asset must be a regular file: ${file}`);
  }
  return [...files].sort();
}

export function packageSite(root, destination) {
  const files = publicSiteFiles(root);
  if (existsSync(destination) && readdirSync(destination).length) {
    throw new Error('Public artifact destination must be empty.');
  }
  mkdirSync(destination, { recursive: true });
  for (const file of files) {
    const target = join(destination, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const destination = join(repositoryRoot, '.quality-results/pages');
  rmSync(destination, { recursive: true, force: true });
  const files = packageSite(repositoryRoot, destination);
  console.log(`Packaged ${files.length} public files in ${destination}`);
}

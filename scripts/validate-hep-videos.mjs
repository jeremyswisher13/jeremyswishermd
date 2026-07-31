import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const programs = JSON.parse(readFileSync(join(scriptDirectory, 'hep-programs.json'), 'utf8'));
const template = readFileSync(join(scriptDirectory, 'hep-page.template'), 'utf8');
const sharedScript = readFileSync(join(root, 'script.js'), 'utf8');
const privacyPage = readFileSync(join(root, 'privacy', 'index.html'), 'utf8');
const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;

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

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(template.includes('{{VIDEO_SECTION}}'), 'HEP template is missing the video section token.');
assert(template.includes('{{VIDEO_PRINT_NOTE}}'), 'HEP template is missing the print video note token.');
assert(sharedScript.includes('https://www.youtube-nocookie.com/embed/'), 'Shared script is missing the privacy-enhanced YouTube player.');
assert(!sharedScript.includes('autoplay=1'), 'Video player must not autoplay.');
assert(sharedScript.includes("iframe.referrerPolicy = 'strict-origin-when-cross-origin'"), 'YouTube iframe needs the required referrer policy.');
assert(privacyPage.includes('No YouTube player, thumbnail, or video content is requested until'), 'Privacy page is missing the click-to-load disclosure.');

for (const program of programs) {
    const video = program.video;
    if (!video) {
        const page = readFileSync(join(root, program.slug, 'index.html'), 'utf8');
        assert(count(page, /data-video-resource/g) === 0, 'Unexpected video facade on ' + program.slug);
        assert(count(page, /data-load-video/g) === 0, 'Unexpected video control on ' + program.slug);
        assert(!page.includes('id="video"'), 'Unexpected video section on ' + program.slug);
        assert(!page.includes('<strong>Optional video:</strong>'), 'Unexpected printed video attribution on ' + program.slug);
        assert(!page.includes('<iframe'), 'Initial page must not contain a YouTube iframe on ' + program.slug);
        assert(!page.includes('{{'), 'Unresolved template token on ' + program.slug);
        continue;
    }

    assert(typeof video === 'object', 'Invalid video configuration for ' + program.slug);
    assert(youtubeIdPattern.test(video.id), 'Invalid YouTube ID for ' + program.slug);
    assert(typeof video.title === 'string' && video.title.trim(), 'Missing video title for ' + program.slug);
    assert(typeof video.description === 'string' && video.description.trim(), 'Missing video description for ' + program.slug);
    assert(typeof video.caution === 'string' && video.caution.trim(), 'Missing video caution for ' + program.slug);

    if (video.startSeconds !== undefined || video.endSeconds !== undefined) {
        assert(
            Number.isInteger(video.startSeconds)
            && Number.isInteger(video.endSeconds)
            && video.startSeconds >= 0
            && video.endSeconds > video.startSeconds,
            'Invalid video chapter timing for ' + program.slug
        );
    }

    const page = readFileSync(join(root, program.slug, 'index.html'), 'utf8');
    assert(count(page, /data-video-resource/g) === 1, 'Expected one video facade on ' + program.slug);
    assert(count(page, /data-load-video/g) === 1, 'Expected one load control on ' + program.slug);
    assert(count(page, /Watch on YouTube/g) === 1, 'Expected one YouTube fallback link on ' + program.slug);
    assert(page.includes('data-video-id="' + video.id + '"'), 'Generated page has the wrong video ID for ' + program.slug);
    assert(page.includes(escapeHtml(video.title)), 'Generated page has a stale video title for ' + program.slug);
    assert(page.includes(escapeHtml(video.description)), 'Generated page has a stale video description for ' + program.slug);
    assert(page.includes(escapeHtml(video.caution)), 'Generated page has a stale video caution for ' + program.slug);
    assert(page.includes('<section class="content-section no-print video-section"'), 'Video must be hidden from print on ' + program.slug);
    assert(page.includes('<strong>Optional video:</strong>'), 'Printed attribution is missing on ' + program.slug);
    assert(!page.includes('<iframe'), 'Initial page must not contain a YouTube iframe on ' + program.slug);
    assert(!page.includes('youtube-nocookie.com'), 'Initial page must not contact YouTube on ' + program.slug);
    assert(!page.includes('ytimg.com'), 'Initial page must not load a YouTube thumbnail on ' + program.slug);
    assert(!page.includes('googlevideo.com'), 'Initial page must not contact Google video hosts on ' + program.slug);
    assert(page.indexOf('id="video"') > page.indexOf('</ol>'), 'Video must follow the written exercise list on ' + program.slug);
    assert(!page.includes('{{'), 'Unresolved template token on ' + program.slug);

    if (Number.isInteger(video.startSeconds)) {
        assert(page.includes('data-video-start="' + video.startSeconds + '"'), 'Generated page has a stale video start time for ' + program.slug);
        assert(page.includes('data-video-end="' + video.endSeconds + '"'), 'Generated page has a stale video end time for ' + program.slug);
        assert(
            page.includes('href="https://www.youtube.com/watch?v=' + video.id + '&amp;t=' + video.startSeconds + 's"'),
            'Generated page has a stale YouTube chapter link for ' + program.slug
        );
    }

    if (video.related) {
        assert(page.includes('href="' + escapeHtml(video.related.href) + '"'), 'Generated page has a stale related video link for ' + program.slug);
        assert(page.includes(escapeHtml(video.related.label)), 'Generated page has a stale related video label for ' + program.slug);
    }
}

const videoCount = programs.filter(program => program.video).length;
console.log('Validated ' + videoCount + ' click-to-load E3 Rehab video companions across ' + programs.length + ' home exercise programs.');

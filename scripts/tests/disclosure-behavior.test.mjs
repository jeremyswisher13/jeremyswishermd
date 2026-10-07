import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../script.js', import.meta.url), 'utf8');

function sectionBetween(start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    assert.ok(startIndex >= 0 && endIndex > startIndex, 'behavior section exists');
    return source.slice(startIndex, endIndex);
}

const fragmentSource = sectionBetween('// Fragment links can target', '// End fragment disclosure behavior.');
const printSource = sectionBetween('// Print the complete page', '// Privacy-conscious video companions');

class ElementStub {
    constructor(parentElement = null) {
        this.parentElement = parentElement;
    }

    closest(selector) {
        return this.parentElement?.closest(selector) || null;
    }
}

class DisclosureStub extends ElementStub {
    constructor(parentElement = null, { open = false, pageJump = false } = {}) {
        super(parentElement);
        this.open = open;
        this.pageJump = pageJump;
    }

    closest(selector) {
        assert.equal(selector, 'details:not([open])');
        return this.open ? super.closest(selector) : this;
    }
}

class TargetStub extends ElementStub {
    scrollIntoView() {
        this.scrollCount = (this.scrollCount || 0) + 1;
    }
}

class LinkStub extends ElementStub {
    constructor(href, attributes = {}) {
        super();
        this.attributes = { href, ...attributes };
    }

    closest(selector) {
        assert.equal(selector, 'a[href]');
        return this;
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    hasAttribute(name) {
        return Object.hasOwn(this.attributes, name);
    }
}

function eventTarget() {
    const handlers = new Map();
    return {
        addEventListener(name, handler) {
            if (!handlers.has(name)) handlers.set(name, []);
            handlers.get(name).push(handler);
        },
        dispatch(name, event = {}) {
            for (const handler of handlers.get(name) || []) handler(event);
        },
    };
}

function fragmentHarness(href = 'https://jeremyswishermd.com/knee-osteoarthritis/') {
    const outer = new DisclosureStub();
    const inner = new DisclosureStub(outer);
    const target = new TargetStub(inner);
    const document = {
        ...eventTarget(),
        getElementById(id) {
            return id === 'source one' ? target : null;
        },
    };
    const window = eventTarget();
    const location = { href, hash: new URL(href).hash };
    runInNewContext(fragmentSource, { document, window, location, URL, Element: ElementStub });
    return {
        outer, inner, target, document, window, location,
        click(href, options = {}, attributes = {}) {
            document.dispatch('click', {
                target: new LinkStub(href, attributes),
                button: 0,
                ...options,
            });
        },
    };
}

test('an initial encoded fragment opens nested disclosures and reveals the target', () => {
    const state = fragmentHarness('https://jeremyswishermd.com/knee-osteoarthritis/#source%20one');
    assert.equal(state.inner.open, true);
    assert.equal(state.outer.open, true);
    assert.equal(state.target.scrollCount, 1);
});

test('hash changes reveal nested targets and tolerate missing or malformed IDs', () => {
    const state = fragmentHarness();
    state.location.hash = '#source%20one';
    state.window.dispatch('hashchange');
    assert.equal(state.inner.open, true);
    assert.equal(state.outer.open, true);
    assert.equal(state.target.scrollCount, 1);
    state.location.hash = '#missing';
    assert.doesNotThrow(() => state.window.dispatch('hashchange'));
    state.location.hash = '#invalid%';
    assert.doesNotThrow(() => state.window.dispatch('hashchange'));
});

test('fragment, relative, and absolute links to the same document open disclosures', () => {
    for (const href of [
        '#source%20one',
        './#source%20one',
        '/knee-osteoarthritis/#source%20one',
        'https://jeremyswishermd.com/knee-osteoarthritis/#source%20one',
    ]) {
        const state = fragmentHarness();
        state.click(href);
        assert.equal(state.inner.open, true, href);
        assert.equal(state.outer.open, true, href);
        // Default browser navigation performs the click's scroll.
        assert.equal(state.target.scrollCount, undefined);
    }
});

test('external, other-page, and other-query fragment links leave this page unchanged', () => {
    for (const href of [
        'https://example.com/knee-osteoarthritis/#source%20one',
        '/prp-knee-osteoarthritis/#source%20one',
        '?version=other#source%20one',
        'mailto:test@example.com#source%20one',
    ]) {
        const state = fragmentHarness();
        state.click(href);
        assert.equal(state.inner.open, false, href);
        assert.equal(state.outer.open, false, href);
    }
});

test('modified, cancelled, download, and new-tab clicks retain normal browser behavior', () => {
    for (const options of [
        { button: 1 }, { metaKey: true }, { ctrlKey: true },
        { shiftKey: true }, { altKey: true }, { defaultPrevented: true },
    ]) {
        const state = fragmentHarness();
        state.click('#source%20one', options);
        assert.equal(state.inner.open, false);
    }
    for (const attributes of [{ target: '_blank' }, { download: '' }]) {
        const state = fragmentHarness();
        state.click('#source%20one', {}, attributes);
        assert.equal(state.inner.open, false);
    }
});

test('print opens closed content, preserves existing open states, and restores repeated sessions', () => {
    const closed = new DisclosureStub();
    const nested = new DisclosureStub(closed);
    const alreadyOpen = new DisclosureStub(null, { open: true });
    const pageJump = new DisclosureStub(null, { pageJump: true });
    const disclosures = [closed, nested, alreadyOpen, pageJump];
    const bodyClasses = new Set();
    const document = {
        body: { classList: { add: name => bodyClasses.add(name) } },
        querySelectorAll(selector) {
            assert.equal(selector, 'details:not([open]):not([data-page-jump])');
            return disclosures.filter(item => !item.open && !item.pageJump);
        },
    };
    const window = eventTarget();
    let reveals = 0;
    let resets = 0;
    runInNewContext(printSource, {
        document, window,
        fadeElements: [{}],
        revealFadeElementsImmediately: () => { reveals += 1; },
        resetPrintProgramState(announce) {
            assert.equal(announce, true);
            bodyClasses.delete('is-printing');
            resets += 1;
        },
    });

    window.dispatch('beforeprint');
    window.dispatch('beforeprint');
    assert.equal(closed.open, true);
    assert.equal(nested.open, true);
    assert.equal(alreadyOpen.open, true);
    assert.equal(pageJump.open, false);
    assert.equal(bodyClasses.has('is-printing'), true);
    assert.equal(reveals, 2);

    window.dispatch('afterprint');
    assert.equal(closed.open, false);
    assert.equal(nested.open, false);
    assert.equal(alreadyOpen.open, true);
    assert.equal(pageJump.open, false);
    assert.equal(bodyClasses.has('is-printing'), false);
    assert.equal(resets, 1);

    // A visitor's newly opened disclosure must survive the next print session.
    closed.open = true;
    window.dispatch('beforeprint');
    window.dispatch('afterprint');
    assert.equal(closed.open, true);
    assert.equal(nested.open, false);
    assert.equal(resets, 2);
});

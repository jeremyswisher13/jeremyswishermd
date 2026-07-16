// Mobile Navigation Toggle
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');
const MOBILE_NAV_BREAKPOINT = 1024;
const mobileNavMedia = typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width: ${MOBILE_NAV_BREAKPOINT}px)`)
    : null;

function setMobileNavOpen(isOpen, options = {}) {
    if (!navToggle || !navLinks) return;

    const { focusFirst = false, returnFocus = false } = options;
    const isMobile = mobileNavMedia
        ? mobileNavMedia.matches
        : window.innerWidth <= MOBILE_NAV_BREAKPOINT;
    const shouldOpen = Boolean(isOpen && isMobile);

    navLinks.classList.toggle('open', shouldOpen);
    navToggle.classList.toggle('active', shouldOpen);
    navToggle.setAttribute('aria-expanded', String(shouldOpen));
    navToggle.setAttribute('aria-label', shouldOpen ? 'Close navigation' : 'Open navigation');

    if (shouldOpen && focusFirst) {
        const firstNavLink = navLinks.querySelector('a[href]');
        firstNavLink?.focus();
    } else if (!shouldOpen && returnFocus) {
        navToggle.focus();
    }
}

if (navToggle && navLinks) {
    navToggle.setAttribute('aria-controls', navLinks.id);
    setMobileNavOpen(navLinks.classList.contains('open'));

    navToggle.addEventListener('click', () => {
        const willOpen = !navLinks.classList.contains('open');
        setMobileNavOpen(willOpen, { focusFirst: willOpen });
    });

    // Close mobile navigation after any navigation link is selected.
    navLinks.querySelectorAll('a[href]').forEach(link => {
        link.addEventListener('click', () => setMobileNavOpen(false));
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && navLinks.classList.contains('open')) {
            event.preventDefault();
            setMobileNavOpen(false, { returnFocus: true });
        }
    });

    document.addEventListener('click', event => {
        if (
            navLinks.classList.contains('open')
            && event.target instanceof Node
            && !navLinks.contains(event.target)
            && !navToggle.contains(event.target)
        ) {
            setMobileNavOpen(false);
        }
    });

    const closeNavAboveMobile = event => {
        const isMobile = typeof event.matches === 'boolean'
            ? event.matches
            : window.innerWidth <= MOBILE_NAV_BREAKPOINT;

        if (!isMobile) setMobileNavOpen(false);
    };

    if (mobileNavMedia?.addEventListener) {
        mobileNavMedia.addEventListener('change', closeNavAboveMobile);
    } else if (mobileNavMedia?.addListener) {
        mobileNavMedia.addListener(closeNavAboveMobile);
    } else {
        window.addEventListener('resize', closeNavAboveMobile);
    }
}

// Navbar scroll effect
const navbar = document.getElementById('navbar');

function updateNavbarScrollState() {
    navbar?.classList.toggle('scrolled', window.scrollY > 50);
}

if (navbar) {
    updateNavbarScrollState();
    window.addEventListener('scroll', updateNavbarScrollState, { passive: true });
}

// Active nav link highlighting based on scroll position
const allNavLinkElements = Array.from(document.querySelectorAll('.nav-link'));

function getInPageTargetId(link) {
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#') || href.length === 1) return null;

    try {
        return decodeURIComponent(href.slice(1));
    } catch {
        return href.slice(1);
    }
}

const inPageNavLinks = allNavLinkElements
    .map(link => ({ link, targetId: getInPageTargetId(link) }))
    .filter(item => item.targetId && document.getElementById(item.targetId));
const inPageTargetIds = new Set(inPageNavLinks.map(item => item.targetId));

// External CTA links do not participate in the current-section state.
allNavLinkElements.forEach(link => {
    if (!inPageNavLinks.some(item => item.link === link)) {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
    }
});

function navTargetForSection(sectionId) {
    // Clinical Care spans both the expertise and procedures sections.
    return sectionId === 'procedures' ? 'expertise' : sectionId;
}

const trackedSections = Array.from(document.querySelectorAll('section[id]'))
    .filter(section => inPageTargetIds.has(navTargetForSection(section.id)));

function highlightNav() {
    if (!inPageNavLinks.length || !trackedSections.length) return;

    const scrollPosition = window.scrollY + 120;
    let activeSection = null;

    trackedSections.forEach(section => {
        if (scrollPosition >= section.offsetTop) activeSection = section;
    });

    const activeTargetId = activeSection ? navTargetForSection(activeSection.id) : null;
    inPageNavLinks.forEach(({ link, targetId }) => {
        const isActive = targetId === activeTargetId;
        link.classList.toggle('active', isActive);

        if (isActive) {
            link.setAttribute('aria-current', 'location');
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

if (inPageNavLinks.length && trackedSections.length) {
    highlightNav();
    window.addEventListener('scroll', highlightNav, { passive: true });
    window.addEventListener('load', highlightNav);
}

// Intersection Observer for fade-in animations (only larger elements, not individual cards)
const fadeElements = Array.from(document.querySelectorAll(
    '.about-text, .about-sidebar, .expertise-card, .treat-card, .procedure-card, .media-card, .coverage-category, .contact-card, .contact-links'
));
const reducedMotionMedia = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
const fadeTimeouts = new Set();
let fadeObserver = null;

function revealFadeElementsImmediately() {
    fadeTimeouts.forEach(timeoutId => window.clearTimeout(timeoutId));
    fadeTimeouts.clear();
    fadeObserver?.disconnect();

    fadeElements.forEach(element => {
        element.classList.remove('fade-in');
        element.classList.add('visible');
    });
}

if (fadeElements.length) {
    if (reducedMotionMedia?.matches || !('IntersectionObserver' in window)) {
        revealFadeElementsImmediately();
    } else {
        fadeObserver = new IntersectionObserver((entries) => {
            let visibleIndex = 0;

            entries.forEach(entry => {
                if (!entry.isIntersecting) return;

                const delay = visibleIndex * 50;
                const timeoutId = window.setTimeout(() => {
                    entry.target.classList.add('visible');
                    fadeTimeouts.delete(timeoutId);
                }, delay);

                fadeTimeouts.add(timeoutId);
                visibleIndex += 1;
                fadeObserver?.unobserve(entry.target);
            });
        }, {
            threshold: 0.05,
            rootMargin: '0px 0px -20px 0px'
        });

        fadeElements.forEach(element => {
            element.classList.add('fade-in');
            fadeObserver?.observe(element);
        });
    }

    const handleReducedMotionChange = event => {
        if (event.matches) revealFadeElementsImmediately();
    };

    if (reducedMotionMedia?.addEventListener) {
        reducedMotionMedia.addEventListener('change', handleReducedMotionChange);
    } else if (reducedMotionMedia?.addListener) {
        reducedMotionMedia.addListener(handleReducedMotionChange);
    }
}

// Publication disclosure toggle
const TOTAL_PUBLICATIONS = 38;
const pubToggleBtn = document.getElementById('pubToggleBtn');
const pubFullList = document.getElementById('pubFullList');

function syncPublicationDisclosure() {
    if (!pubToggleBtn || !pubFullList) return;

    const isExpanded = !pubFullList.classList.contains('hidden');
    pubToggleBtn.setAttribute('aria-expanded', String(isExpanded));
    pubToggleBtn.textContent = isExpanded
        ? 'Show Less'
        : `Browse All ${TOTAL_PUBLICATIONS} Publications`;
}

if (pubToggleBtn && pubFullList) {
    pubToggleBtn.setAttribute('aria-controls', pubFullList.id);
    syncPublicationDisclosure();

    pubToggleBtn.addEventListener('click', () => {
        pubFullList.classList.toggle('hidden');
        syncPublicationDisclosure();
    });
}

// Publication filter tabs
const filterButtons = Array.from(document.querySelectorAll('.pub-filter'));
const publicationFilters = filterButtons.map(button => {
    const targetId = button.dataset.filter;
    const panel = targetId ? document.getElementById(targetId) : null;

    if (panel) button.setAttribute('aria-controls', panel.id);
    return { button, panel };
});

function selectPublicationFilter(selectedFilter) {
    if (!selectedFilter?.panel) return;

    publicationFilters.forEach(filter => {
        const isSelected = filter === selectedFilter;
        filter.button.classList.toggle('active', isSelected);
        filter.button.setAttribute('aria-pressed', String(isSelected));

        if (filter.panel) {
            filter.panel.classList.toggle('hidden', !isSelected);
        }
    });
}

publicationFilters.forEach(filter => {
    filter.button.setAttribute('aria-pressed', 'false');

    if (filter.panel) {
        filter.button.addEventListener('click', () => selectPublicationFilter(filter));
    }
});

const initialPublicationFilter = publicationFilters.find(filter => (
    filter.panel && filter.button.classList.contains('active')
)) || publicationFilters.find(filter => filter.panel && !filter.panel.classList.contains('hidden'))
    || publicationFilters.find(filter => filter.panel);

if (initialPublicationFilter) selectPublicationFilter(initialPublicationFilter);

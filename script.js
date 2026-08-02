// Mobile Navigation Toggle
// The navigation remains visible if this script does not load. Once JavaScript is
// ready, the mobile menu becomes a compact toggle.
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');
const MOBILE_NAV_BREAKPOINT = 1180;
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
        link.addEventListener('click', () => {
            const targetId = getInPageTargetId(link);
            const target = targetId ? document.getElementById(targetId) : null;

            setMobileNavOpen(false);

            if (target) {
                window.requestAnimationFrame(() => {
                    const focusTarget = target.querySelector('h1, h2') || target;
                    const hadTabindex = focusTarget.hasAttribute('tabindex');
                    focusTarget.classList.add('in-page-focus-target');
                    focusTarget.setAttribute('tabindex', '-1');
                    focusTarget.focus({ preventScroll: true });

                    if (!hadTabindex) {
                        focusTarget.addEventListener('blur', () => {
                            focusTarget.removeAttribute('tabindex');
                            focusTarget.classList.remove('in-page-focus-target');
                        }, { once: true });
                    }
                });
            }
        });
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

    // Only switch to the collapsed mobile-menu presentation after every
    // navigation handler has been installed successfully.
    document.documentElement.classList.add('nav-ready');
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
        const currentState = link.getAttribute('aria-current');
        if (currentState !== 'page' && currentState !== 'location') {
            link.classList.remove('active');
            link.removeAttribute('aria-current');
        }
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
        : `Browse All ${TOTAL_PUBLICATIONS} Scholarly Works`;
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

// Open the native print dialog for patient home exercise programs.
const printProgramButtons = Array.from(document.querySelectorAll('[data-print-program]'));
const printProgramStatus = document.getElementById('printStatus');

let printProgramResetTimer = null;

function resetPrintProgramState(announce = false) {
    if (printProgramResetTimer) {
        window.clearTimeout(printProgramResetTimer);
        printProgramResetTimer = null;
    }

    document.body.classList.remove('is-printing');
    printProgramButtons.forEach(button => {
        button.disabled = false;
        button.removeAttribute('aria-busy');
    });

    if (announce && printProgramStatus) {
        printProgramStatus.textContent = 'Print dialog closed. Your program is ready on the page.';
    }
}

function openPrintProgram(button) {
    if (typeof window.print !== 'function') {
        if (printProgramStatus) {
            printProgramStatus.textContent = 'Printing is unavailable in this browser. Use the browser menu and choose Print.';
        }
        return;
    }

    document.body.classList.add('is-printing');
    printProgramButtons.forEach(printButton => {
        printButton.disabled = true;
        printButton.setAttribute('aria-busy', 'true');
    });

    if (printProgramStatus) {
        printProgramStatus.textContent = 'Print dialog opened. Choose a printer or Save as PDF.';
    }

    try {
        const printRequest = new CustomEvent('hep:print-request', { cancelable: true });
        if (!document.dispatchEvent(printRequest)) return;
        window.print();
    } catch {
        if (printProgramStatus) {
            printProgramStatus.textContent = 'The print dialog could not open. Use the browser menu and choose Print.';
        }
    } finally {
        printProgramResetTimer = window.setTimeout(() => resetPrintProgramState(false), 500);
    }
}

printProgramButtons.forEach(button => {
    button.addEventListener('click', () => openPrintProgram(button));
});

window.addEventListener('beforeprint', () => document.body.classList.add('is-printing'));
window.addEventListener('afterprint', () => resetPrintProgramState(true));

// Privacy-conscious video companions for home exercise programs.
//
// YouTube is contacted only after a visitor explicitly loads a player.
const videoResources = Array.from(document.querySelectorAll('[data-video-resource]'));
const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const videoLoadTimeoutMilliseconds = 15000;
let youtubeIframeApiPromise;

function loadYoutubeIframeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (youtubeIframeApiPromise) return youtubeIframeApiPromise;

    youtubeIframeApiPromise = new Promise((resolve, reject) => {
        const existingScript = document.getElementById('youtube-iframe-api');
        existingScript?.remove();

        const previousReadyHandler = window.onYouTubeIframeAPIReady;
        const script = document.createElement('script');
        script.id = 'youtube-iframe-api';
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;

        window.onYouTubeIframeAPIReady = () => {
            if (typeof previousReadyHandler === 'function') previousReadyHandler();
            resolve(window.YT);
        };

        script.addEventListener('error', () => {
            window.onYouTubeIframeAPIReady = previousReadyHandler;
            youtubeIframeApiPromise = undefined;
            script.remove();
            reject(new Error('The YouTube player API could not load.'));
        }, { once: true });

        document.head.append(script);
    });

    return youtubeIframeApiPromise;
}

function loadVideoResource(resource) {
    const videoId = resource.dataset.videoId;
    const videoTitle = resource.dataset.videoTitle;
    const stage = resource.querySelector('[data-video-stage]');
    const status = resource.closest('.video-section')?.querySelector('[data-video-status]');
    const loadButton = resource.querySelector('[data-load-video]');

    if (!youtubeVideoIdPattern.test(videoId || '') || !videoTitle || !stage) {
        if (status) status.textContent = 'The embedded player is unavailable. Use the Watch on YouTube link below.';
        return;
    }

    if (resource.dataset.videoLoading === 'true') return;

    const facade = stage.firstElementChild?.cloneNode(true);
    resource.dataset.videoLoading = 'true';
    resource.classList.add('is-loading');
    stage.setAttribute('aria-busy', 'true');

    if (loadButton) {
        loadButton.disabled = true;
        loadButton.setAttribute('aria-disabled', 'true');
    }
    if (status) status.textContent = 'Loading the YouTube video player.';

    const parameters = new URLSearchParams({
        cc_load_policy: '1',
        cc_lang_pref: 'en',
        enablejsapi: '1',
        hl: 'en',
        playsinline: '1',
        rel: '0'
    });
    if (location.protocol === 'http:' || location.protocol === 'https:') {
        parameters.set('origin', location.origin);
    }
    const startSeconds = Number.parseInt(resource.dataset.videoStart || '', 10);
    const endSeconds = Number.parseInt(resource.dataset.videoEnd || '', 10);

    if (
        Number.isInteger(startSeconds)
        && Number.isInteger(endSeconds)
        && startSeconds >= 0
        && endSeconds > startSeconds
    ) {
        parameters.set('start', String(startSeconds));
        parameters.set('end', String(endSeconds));
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'video-frame';
    iframe.width = '560';
    iframe.height = '315';
    iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?${parameters.toString()}`;
    iframe.title = `${videoTitle} | E3 Rehab`;
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'encrypted-media; picture-in-picture; web-share';
    iframe.allowFullscreen = true;

    let loadFinished = false;
    let loadTimeout;
    let player;

    const finishLoad = () => {
        if (loadFinished) return;
        loadFinished = true;
        window.clearTimeout(loadTimeout);
        delete resource.dataset.videoLoading;
        resource.classList.remove('is-loading');
        resource.classList.add('is-loaded');
        stage.removeAttribute('aria-busy');
        if (status) status.textContent = 'YouTube video player loaded.';
        const playerIframe = player?.getIframe?.() || iframe;
        window.requestAnimationFrame(() => playerIframe.focus());
    };

    const restoreFacade = (allowAfterReady = false) => {
        if (loadFinished && !allowAfterReady) return;
        loadFinished = true;
        window.clearTimeout(loadTimeout);
        try {
            player?.destroy();
        } catch {
            // The iframe may already be unavailable after a failed navigation.
        }
        if (!window.YT?.Player) {
            youtubeIframeApiPromise = undefined;
            document.getElementById('youtube-iframe-api')?.remove();
        }
        delete resource.dataset.videoLoading;
        resource.classList.remove('is-loading', 'is-loaded');
        stage.removeAttribute('aria-busy');

        if (facade) {
            stage.replaceChildren(facade);
            const retryButton = resource.querySelector('[data-load-video]');
            if (retryButton) {
                const retryLabel = retryButton.querySelector('span:last-child');
                if (retryLabel) retryLabel.textContent = 'Retry video player';
                retryButton.disabled = false;
                retryButton.removeAttribute('aria-disabled');
                retryButton.addEventListener('click', () => loadVideoResource(resource));
                window.requestAnimationFrame(() => retryButton.focus());
            }
        } else {
            stage.replaceChildren();
        }

        if (status) {
            status.textContent = 'The embedded player could not load. Retry or use the Watch on YouTube link below.';
        }
    };

    stage.replaceChildren(iframe);
    loadTimeout = window.setTimeout(restoreFacade, videoLoadTimeoutMilliseconds);

    loadYoutubeIframeApi()
        .then(YT => {
            if (loadFinished) return;
            player = new YT.Player(iframe, {
                events: {
                    onReady: finishLoad,
                    onError: () => restoreFacade(true)
                }
            });
        })
        .catch(restoreFacade);
}

videoResources.forEach(resource => {
    const loadButton = resource.querySelector('[data-load-video]');
    if (!loadButton) return;
    loadButton.addEventListener('click', () => loadVideoResource(resource));
});

// Exercise-library body-region filter
//
// Every program remains visible in the source. The controls appear only after
// the complete radio group and card set have been verified and wired.
const programFilter = document.querySelector('[data-program-filter]');
const programFilterStatus = programFilter?.querySelector('[data-program-filter-status]');
const programFilterInputs = programFilter
    ? Array.from(programFilter.querySelectorAll('input[name="program-region"]'))
    : [];
const programCards = Array.from(document.querySelectorAll('#program-grid .program-card[data-program-region]'));
const programRegionLabels = new Map([
    ['knee-thigh', 'knee and thigh'],
    ['shoulder', 'shoulder'],
    ['elbow', 'elbow'],
    ['hip', 'hip'],
    ['foot-ankle', 'foot and ankle'],
    ['hand-wrist', 'hand and wrist'],
    ['back', 'low back']
]);
const expectedProgramRegions = new Set(programRegionLabels.keys());
const inputRegions = new Set(programFilterInputs.map(input => input.value));
const hasCompleteProgramFilter = (
    programFilter instanceof HTMLFieldSetElement
    && programFilterStatus instanceof HTMLElement
    && programCards.length > 0
    && programFilterInputs.length === expectedProgramRegions.size + 1
    && inputRegions.has('all')
    && [...expectedProgramRegions].every(region => inputRegions.has(region))
    && programCards.every(card => expectedProgramRegions.has(card.dataset.programRegion))
);

if (hasCompleteProgramFilter) {
    const updateProgramFilter = () => {
        const selectedInput = programFilterInputs.find(input => input.checked);
        const selectedRegion = selectedInput?.value || 'all';
        let visibleCount = 0;

        programCards.forEach(card => {
            const isVisible = selectedRegion === 'all' || card.dataset.programRegion === selectedRegion;
            card.hidden = !isVisible;
            if (isVisible) visibleCount += 1;
        });

        programFilterStatus.textContent = selectedRegion === 'all'
            ? `Showing all ${programCards.length} programs.`
            : `Showing ${visibleCount} of ${programCards.length} programs for ${programRegionLabels.get(selectedRegion)}.`;
    };

    programFilterInputs.forEach(input => {
        input.addEventListener('change', updateProgramFilter);
    });

    updateProgramFilter();
    programFilter.hidden = false;
}

// Privacy-safe action measurement
//
// This site records one minimal path-only page-load event plus selected actions:
// choosing a phone link, UCLA Health appointment request, clinic location,
// directions, official profile, exercise-program print, referral instructions,
// or optional exercise video. Events never include a phone number, destination
// URL, link text, query string, referrer, video ID, or page contents.
const ANALYTICS_PRODUCTION_HOSTS = new Set([
    'jeremyswishermd.com',
    'www.jeremyswishermd.com'
]);
const ANALYTICS_EXPLICIT_EVENTS = new Set([
    'exercise_program_print',
    'exercise_video_load',
    'referral_instructions_click'
]);
const ANALYTICS_LOCATIONS = new Set([
    'page',
    'navigation',
    'hero',
    'patient',
    'final_cta',
    'sidebar',
    'contact',
    'referral',
    'footer',
    'content'
]);
const ANALYTICS_IGNORED_METRICS = [
    'referrer',
    'utm',
    'country',
    'session',
    'timeonpage',
    'scrolled',
    'useragent',
    'screensize',
    'viewportsize',
    'language'
].join(',');

function hasAnalyticsPrivacySignal() {
    if (navigator.globalPrivacyControl === true) return true;

    const doNotTrackSignals = [
        navigator.doNotTrack,
        window.doNotTrack,
        navigator.msDoNotTrack
    ];

    return doNotTrackSignals.some(value => (
        value === '1' || value === 1 || value === 'yes'
    ));
}

function analyticsPagePath() {
    if (document.body?.classList.contains('not-found-page')) return '/404/';

    const path = window.location.pathname.replace(/\/{2,}/g, '/');
    return path.startsWith('/') ? path : '/';
}

function analyticsLocationForElement(element) {
    const explicitLocation = element.dataset.analyticsLocation;
    if (ANALYTICS_LOCATIONS.has(explicitLocation)) return explicitLocation;

    if (element.closest('#navbar')) return 'navigation';
    if (element.closest('.landing-hero, .hero')) return 'hero';
    if (element.closest('.patient-card')) return 'patient';
    if (element.closest('.conversion-band')) return 'final_cta';
    if (element.closest('.landing-sidebar, aside')) return 'sidebar';
    if (element.closest('.contact-card, #contact')) return 'contact';
    if (element.closest('.referral-card, section#referrals .clinician-panel')) return 'referral';
    if (element.closest('footer')) return 'footer';
    return 'content';
}

function siteActionEventName(element) {
    const explicitEvent = element.dataset.analyticsEvent;
    if (ANALYTICS_EXPLICIT_EVENTS.has(explicitEvent)) return explicitEvent;

    if (!(element instanceof HTMLAnchorElement)) return null;

    const rawHref = element.getAttribute('href')?.trim();
    if (!rawHref) return null;
    if (rawHref.toLowerCase().startsWith('tel:')) return 'call_click';

    try {
        const destination = new URL(rawHref, window.location.href);
        const isUclaAppointmentRequest = destination.hostname === 'cloud.h.uclahealth.org'
            && destination.pathname === '/appointment-request';
        if (isUclaAppointmentRequest) return 'appointment_request_click';

        const currentPath = analyticsPagePath().replace(/\/+$/, '') || '/';
        const destinationPath = destination.pathname.replace(/\/+$/, '') || '/';
        const isInternalLocationPage = destination.origin === window.location.origin
            && destinationPath === '/locations'
            && currentPath !== '/locations';
        if (isInternalLocationPage) return 'location_page_click';

        const isGoogleMapsHost = destination.hostname === 'www.google.com'
            || destination.hostname === 'google.com'
            || destination.hostname === 'maps.google.com';
        const isGoogleMapsDirections = isGoogleMapsHost
            && (destinationPath === '/maps' || destinationPath.startsWith('/maps/'));
        if (isGoogleMapsDirections) return 'directions_click';

        const isUclaHealth = destination.hostname === 'www.uclahealth.org'
            || destination.hostname === 'uclahealth.org';
        if (!isUclaHealth) return null;

        if (destinationPath === '/providers/jeremy-swisher') return 'official_profile_click';
        if (destinationPath.startsWith('/locations/')) return 'directions_click';
        return null;
    } catch {
        return null;
    }
}

function measurePageView() {
    if (typeof window.sa_event !== 'function') return;

    try {
        window.sa_event('page_view', {
            page: analyticsPagePath(),
            cta_location: 'page'
        });
    } catch {
        // Measurement must never interrupt the page experience.
    }
}

function loadSiteAnalytics() {
    if (!ANALYTICS_PRODUCTION_HOSTS.has(window.location.hostname)) return false;
    if (hasAnalyticsPrivacySignal()) return false;
    if (document.body?.classList.contains('not-found-page')) return false;
    if (document.querySelector('script[data-site-analytics]')) return true;

    window.sa_event = window.sa_event || function queueSimpleAnalyticsEvent(...args) {
        window.sa_event.q = window.sa_event.q || [];
        window.sa_event.q.push(args);
    };

    const analyticsScript = document.createElement('script');
    analyticsScript.async = true;
    analyticsScript.src = 'https://scripts.simpleanalyticscdn.com/sri/v11.js';
    analyticsScript.integrity = 'sha384-rfv15RJy1bBYZ1Mf4xizO26jorXb2myipCvHXy4rkG0SuEET96S+m0sTzu5vfbSI';
    analyticsScript.crossOrigin = 'anonymous';
    analyticsScript.referrerPolicy = 'no-referrer';
    analyticsScript.dataset.siteAnalytics = 'true';
    analyticsScript.dataset.autoCollect = 'false';
    analyticsScript.dataset.hostname = 'jeremyswishermd.com';
    analyticsScript.dataset.ignoreMetrics = ANALYTICS_IGNORED_METRICS;
    document.head.appendChild(analyticsScript);
    return true;
}

function measureSiteAction(event) {
    if (!(event.target instanceof Element)) return;
    if (event.type === 'auxclick' && event.button !== 1) return;

    const actionElement = event.target.closest('[data-analytics-event], a[href]');
    if (!actionElement) return;

    const eventName = siteActionEventName(actionElement);
    if (!eventName || typeof window.sa_event !== 'function') return;

    const metadata = {
        page: analyticsPagePath(),
        cta_location: analyticsLocationForElement(actionElement)
    };
    const canWaitForMeasurement = event.type === 'click'
        && event.button === 0
        && !event.defaultPrevented
        && !event.metaKey
        && !event.ctrlKey
        && !event.shiftKey
        && !event.altKey
        && actionElement instanceof HTMLAnchorElement
        && (!actionElement.target || actionElement.target.toLowerCase() === '_self')
        && window.sa_loaded === true;

    try {
        if (canWaitForMeasurement) {
            event.preventDefault();
            let navigationStarted = false;
            const continueNavigation = () => {
                if (navigationStarted) return;
                navigationStarted = true;
                window.location.href = actionElement.href;
            };
            window.sa_event(eventName, metadata, continueNavigation);
            window.setTimeout(continueNavigation, 350);
            return;
        }

        window.sa_event(eventName, metadata);
    } catch {
        // Measurement must never interrupt the visitor's requested action.
    }
}

if (loadSiteAnalytics()) {
    measurePageView();
    document.addEventListener('click', measureSiteAction, { capture: true });
    document.addEventListener('auxclick', measureSiteAction, { capture: true });
}

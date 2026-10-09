/* Clinic sharing: maintained public program links only; no storage or requests. */
(() => {
    'use strict';
    const workspace = document.querySelector('[data-clinic-workspace]');
    const select = document.getElementById('clinic-program');
    const data = document.getElementById('clinic-program-data');
    if (!workspace || !select || !data) return;

    let programs;
    try {
        programs = JSON.parse(data.textContent);
        if (!Array.isArray(programs) || !programs.length
            || programs.some(program => !program || typeof program.slug !== 'string'
                || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(program.slug)
                || typeof program.title !== 'string' || !program.title.trim())
            || new Set(programs.map(program => program.slug)).size !== programs.length) return;
    } catch {
        return;
    }

    const programBySlug = new Map(programs.map(program => [program.slug, program]));
    const status = workspace.querySelector('[data-clinic-status]');
    const card = workspace.querySelector('[data-clinic-card]');
    const actions = workspace.querySelector('[data-clinic-actions]');
    const empty = workspace.querySelector('[data-clinic-empty]');
    const linkField = document.getElementById('clinic-program-url');
    const openLink = workspace.querySelector('[data-clinic-open]');
    const cardLink = workspace.querySelector('[data-clinic-card-url]');
    const cardTitle = workspace.querySelector('[data-clinic-title]');
    const qrContainer = workspace.querySelector('[data-clinic-qr]');
    const scan = workspace.querySelector('[data-clinic-scan]');
    const qrFallback = workspace.querySelector('[data-clinic-qr-fallback]');
    const copyButton = workspace.querySelector('[data-clinic-copy]');
    const printButton = workspace.querySelector('[data-clinic-print]');
    const canonicalOrigin = 'https://jeremyswishermd.com';
    const svgNamespace = 'http://www.w3.org/2000/svg';
    let selectedLink = '';
    let selectionVersion = 0;

    function renderQr(url, title) {
        qrContainer.replaceChildren();
        qrFallback.hidden = true;
        scan.hidden = false;
        try {
            const qr = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM);
            // Four clear modules surround the code; black on white remains clear in print.
            const quietZone = 4;
            const size = qr.size + quietZone * 2;
            const svg = document.createElementNS(svgNamespace, 'svg');
            svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
            svg.setAttribute('width', '240');
            svg.setAttribute('height', '240');
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', `QR code for ${title}. The same program link is below.`);
            svg.setAttribute('shape-rendering', 'crispEdges');
            const background = document.createElementNS(svgNamespace, 'rect');
            background.setAttribute('width', String(size));
            background.setAttribute('height', String(size));
            background.setAttribute('fill', '#fff');
            const modules = document.createElementNS(svgNamespace, 'path');
            const path = [];
            for (let y = 0; y < qr.size; y += 1) {
                for (let x = 0; x < qr.size; x += 1) {
                    if (qr.getModule(x, y)) path.push(`M${x + quietZone},${y + quietZone}h1v1h-1z`);
                }
            }
            modules.setAttribute('d', path.join(''));
            modules.setAttribute('fill', '#000');
            svg.append(background, modules);
            qrContainer.append(svg);
            qrContainer.hidden = false;
            return true;
        } catch {
            qrContainer.hidden = true;
            qrFallback.hidden = false;
            scan.hidden = true;
            return false;
        }
    }

    function updateProgram() {
        selectionVersion += 1;
        const program = programBySlug.get(select.value);
        selectedLink = program ? `${canonicalOrigin}/${program.slug}/` : '';
        linkField.value = selectedLink;
        card.hidden = !program;
        actions.hidden = !program;
        empty.hidden = Boolean(program);
        if (!program) {
            cardTitle.textContent = '';
            cardLink.textContent = '';
            cardLink.removeAttribute('href');
            openLink.setAttribute('href', '../home-exercise-programs/');
            qrContainer.replaceChildren();
            status.textContent = 'Choose a program to create its card.';
            return;
        }
        cardTitle.textContent = program.title;
        cardLink.textContent = selectedLink;
        cardLink.href = selectedLink;
        openLink.href = selectedLink;
        const qrReady = renderQr(selectedLink, program.title);
        status.textContent = `${program.title} is ready to share.${qrReady ? '' : ' QR code unavailable; the program link and printable card still work.'}`;
    }

    select.addEventListener('change', updateProgram);
    copyButton.addEventListener('click', async () => {
        if (!selectedLink) return;
        const url = selectedLink;
        const version = selectionVersion;
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(url);
            if (version === selectionVersion) status.textContent = 'Program link copied.';
        } catch {
            if (version !== selectionVersion) return;
            linkField.focus();
            linkField.select();
            status.textContent = 'Copy is unavailable here. The program link is selected; use your device’s copy command.';
        }
    });
    printButton.addEventListener('click', () => {
        if (!selectedLink) return;
        status.textContent = 'The selected program card is ready in the print dialog.';
        window.print();
    });

    // A fragment can preselect a maintained program without sending the choice in a request.
    function applyFragment() {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const requestedSlug = params.get('program');
        select.value = programBySlug.has(requestedSlug) ? requestedSlug : '';
        updateProgram();
        if (requestedSlug && !programBySlug.has(requestedSlug)) {
            status.textContent = 'That program link is unavailable. Choose a program from the list.';
        }
    }
    applyFragment();
    select.disabled = false;
    window.addEventListener('hashchange', applyFragment);
})();

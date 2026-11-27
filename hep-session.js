// Optional patient session tools. Clinical instructions come from the page's
// generated program data; personal entries stay in memory or opted-in storage.
import { MAX_PROGRESS_BYTES, MAX_SETS, appendWorkoutDetails, describeSet, hasRecordedSetDetails, mountExerciseTimer, stopActiveTimer, validateWorkoutEntries, validateWorkoutOptions } from './hep-workout.js?v=20261127-focus-session1';
export const SESSION_STORAGE_VERSION = 1;
export const MAX_RECORDS = 30;
export const NEXT_MORNING_RESPONSES = Object.freeze([
    { value: 'not-checked', label: 'Not checked yet' },
    { value: 'baseline', label: 'Back to usual baseline' },
    { value: 'more-symptomatic', label: 'Still more symptomatic' },
    { value: 'not-sure', label: 'Not sure' }
]);

export const GUIDED_PROGRAM_SLUGS = Object.freeze([
    'knee-osteoarthritis-exercises',
    'knee-osteoarthritis-advanced-exercises',
    'patellofemoral-pain-exercises',
    'rotator-cuff-pain-exercises',
    'achilles-tendinopathy-exercises',
    'gluteal-tendinopathy-exercises',
    'lateral-ankle-sprain-exercises',
    'lateral-elbow-tendinopathy-exercises',
    'medial-elbow-tendinopathy-exercises',
    'adhesive-capsulitis-exercises',
    'patellar-tendinopathy-exercises',
    'low-back-pain-exercises',
    'hip-osteoarthritis-exercises',
    'hamstring-strain-exercises',
    'plantar-fasciitis-exercises',
    'meniscus-tear-rehabilitation-exercises',
    'advanced-meniscus-rehabilitation-exercises',
    'iliotibial-band-syndrome-exercises',
    'peroneal-tendinopathy-exercises',
    'tibialis-posterior-tendinopathy-exercises',
    'thumb-cmc-osteoarthritis-exercises',
    'de-quervain-tenosynovitis-exercises',
    'ankle-sprain-return-to-sport-exercises',
    'patellofemoral-pain-return-to-running-exercises',
    'achilles-tendinopathy-return-to-sport-exercises',
    'insertional-achilles-tendinopathy-exercises',
    'proximal-hamstring-tendinopathy-exercises',
    'rotator-cuff-return-to-throwing-exercises'
]);
const SUPPORTED_PROGRAM_SLUGS = new Set(GUIDED_PROGRAM_SLUGS);
const RESPONSE_VALUES = new Set(NEXT_MORNING_RESPONSES.map(response => response.value));
const UNSAVED_ENTRIES_HELP = 'Unsaved entries can be lost if you refresh, leave this page, or close the tab.';
const DRAFT_PROGRESS_HELP = 'An unfinished session, including tapped sets and timers, is not saved. Refreshing, leaving this page, or closing the tab can erase it, even when saving is on.';
const SAVE_PROMPT_HELP = 'It stays in this browser only, and later sessions will save automatically. Anyone using this browser can see saved entries.';
const PROGRAM_FIELDS = [
    'title', 'fitIntro', 'programIntro', 'frequency', 'equipment', 'checkpoint', 'goal',
    'responseIntro', 'green', 'yellow', 'red'
];
const EXERCISE_FIELDS = ['name', 'dose', 'frequency', 'how', 'easier', 'harder'];

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value, maximum, allowEmpty = false) {
    return typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0);
}

function isStorageToken(value) {
    return isText(value, 100) && /^[a-zA-Z0-9_-]+$/.test(value);
}

export function localDateString(date = new Date()) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isValidSessionDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function progressStorageKey(slug) {
    return `swishermd:hep-progress:v1:${slug}`;
}

// Reads the set range already written in a dose ("1 to 3 sets of ...") so a
// patient can tap off sets. Doses without sets (holds, minutes) get no circles.
export function doseSetRange(dose) {
    const match = /\b(\d+)(?:\s+(?:to|or)\s+(\d+))?\s+sets?\b/i.exec(typeof dose === 'string' ? dose : '');
    if (!match) return null;
    const minimum = Number(match[1]);
    const maximum = Number(match[2] || match[1]);
    if (minimum < 1 || maximum < minimum || maximum > MAX_SETS) return null;
    return { minimum, maximum };
}

export function validateProgramData(value) {
    if (!isObject(value) || !SUPPORTED_PROGRAM_SLUGS.has(value.slug)) return null;
    if (!PROGRAM_FIELDS.every(field => isText(value[field], 6000))) return null;
    if (!isText(value.canonical, 1000)) return null;
    try {
        const url = new URL(value.canonical);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    } catch {
        return null;
    }
    if (!Array.isArray(value.exercises) || value.exercises.length < 1 || value.exercises.length > 24) return null;
    if (!value.exercises.every(exercise => isObject(exercise) && EXERCISE_FIELDS.every(field => isText(exercise[field], 6000)))) return null;
    const result = { slug: value.slug, canonical: value.canonical };
    PROGRAM_FIELDS.forEach(field => { result[field] = value[field]; });
    result.exercises = value.exercises.map(exercise => Object.fromEntries(EXERCISE_FIELDS.map(field => [field, exercise[field]])));
    if (Number.isInteger(value.strengthStartIndex) && value.strengthStartIndex > 0 && value.strengthStartIndex < result.exercises.length) {
        result.strengthStartIndex = value.strengthStartIndex;
    }
    if (isObject(value.timerOptions)) {
        result.timerOptions = Object.fromEntries(result.exercises.flatMap(({ name }) => {
            const choices = value.timerOptions[name];
            if (!Array.isArray(choices) || !choices.length || choices.length > 12
                || !choices.every(choice => isObject(choice) && isText(choice.label, 60)
                    && Number.isInteger(choice.seconds) && choice.seconds > 0 && choice.seconds <= 3600)) return [];
            return [[name, choices.map(({ label, seconds }) => ({ label, seconds }))]];
        }));
    }
    const options = validateWorkoutOptions(value.workoutOptions, result.exercises.length);
    if (options) result.workoutOptions = options;
    return result;
}

export function createSessionRecord(value, exerciseCount) {
    if (!isObject(value) || !Number.isInteger(exerciseCount) || exerciseCount < 1 || exerciseCount > 24) return null;
    if (!isText(value.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(value.id) || !isValidSessionDate(value.date)) return null;
    if (!Number.isInteger(value.completed) || !Number.isInteger(value.skipped) || value.completed < 0 || value.skipped < 0) return null;
    if (value.completed + value.skipped !== exerciseCount || !RESPONSE_VALUES.has(value.response)) return null;
    if (!isText(value.notes, 200, true) || !isText(value.goal, 140, true)) return null;
    const record = {
        id: value.id,
        date: value.date,
        completed: value.completed,
        skipped: value.skipped,
        response: value.response,
        notes: value.notes,
        goal: value.goal
    };
    for (const field of ['createdAt', 'updatedAt']) {
        if (value[field] !== undefined) {
            if (!Number.isSafeInteger(value[field]) || value[field] < 0) return null;
            record[field] = value[field];
        }
    }
    if (value.workout !== undefined) {
        const workout = validateWorkoutEntries(value.workout, exerciseCount, value.completed);
        if (!workout) return null;
        record.workout = workout;
    }
    if (value.setCounts !== undefined) {
        if (!Array.isArray(value.setCounts) || value.setCounts.length !== exerciseCount
            || !value.setCounts.every(count => Number.isInteger(count) && count >= 0 && count <= MAX_SETS)) return null;
        record.setCounts = [...value.setCounts];
    }
    return record;
}

export function validateProgressStore(value, slug, exerciseCount) {
    if (!isObject(value) || value.version !== SESSION_STORAGE_VERSION || value.slug !== slug || !SUPPORTED_PROGRAM_SLUGS.has(slug)) return null;
    if (!Number.isInteger(exerciseCount) || exerciseCount < 1 || exerciseCount > 24) return null;
    if (!isText(value.goal, 140, true) || !Array.isArray(value.records)) return null;
    const records = value.records.slice(0, MAX_RECORDS).map(record => createSessionRecord(record, exerciseCount));
    if (records.some(record => record === null) || new Set(records.map(record => record.id)).size !== records.length) return null;
    const store = { version: SESSION_STORAGE_VERSION, slug, goal: value.goal, records };
    for (const field of ['generation', 'clearRevision']) {
        if (value[field] === undefined) continue;
        if (!isStorageToken(value[field])) return null;
        store[field] = value[field];
    }
    return store;
}

// Record IDs identify additions; edit stamps prevent a stale tab from replacing
// a newer next-morning response. Order and tie-breaking are deterministic so
// simultaneous storage events converge without adding duplicate records.
export function mergeProgressRecords(localRecords, storedRecords, changedIds = new Set()) {
    const merged = new Map(storedRecords.map(record => [record.id, { ...record }]));
    localRecords.forEach(record => {
        const stored = merged.get(record.id);
        if (!stored) merged.set(record.id, { ...record });
        else if (changedIds.has(record.id)) {
            merged.set(record.id, { ...record, updatedAt: Math.max(record.updatedAt || 0, (stored.updatedAt || 0) + 1) });
        } else if ((record.updatedAt || 0) > (stored.updatedAt || 0)) merged.set(record.id, { ...record });
        else if ((record.updatedAt || 0) === (stored.updatedAt || 0) && record.response > stored.response) merged.set(record.id, { ...record });
    });
    return [...merged.values()].sort((a, b) => {
        const timeDifference = (b.createdAt || 0) - (a.createdAt || 0);
        if (timeDifference) return timeDifference;
        // Preserve the order of older stores that have no timestamps.
        if (!a.createdAt && !b.createdAt) return 0;
        return b.id.localeCompare(a.id);
    }).slice(0, MAX_RECORDS);
}

function responseLabel(value) {
    return NEXT_MORNING_RESPONSES.find(response => response.value === value)?.label || 'Not checked yet';
}

function displayDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function newRecordId() {
    if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID();
    return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function initializeGuidedSession(root, program) {
    const key = progressStorageKey(program.slug);
    const clearKey = `${key}:clear`;
    const firstStage = document.querySelector('#progress .care-step p')?.textContent;
    const exerciseCount = program.exercises.length;
    const perExercise = value => program.exercises.map(() => value);
    // Only exercises the program marks as using resistance offer the optional box.
    const canRecordLoad = Boolean(program.workoutOptions?.some(option => option.resistance));
    const state = {
        records: [], goal: '', keep: false, storageAvailable: true, hasStoredData: false,
        generation: undefined, clearRevision: undefined,
        changedIds: new Set(), goalChanged: false, historyNeedsRefresh: false,
        steps: perExercise(null), setCounts: perExercise(0), loads: perExercise(''), shown: perExercise(''),
        index: 0, started: false, recordLoad: false, settingsOpen: false, savedId: null, exerciseTimer: null,
        date: localDateString(), notes: '', response: 'not-checked', view: 'welcome', resumeView: 'exercise', afterClose: '',
        printout: null, printTimer: null, printing: false
    };

    // Read only this program's data and clear revision. No enumeration or
    // writing happens during initial page loading.
    let restorationMessage = '';
    try {
        state.clearRevision = readClearRevision();
        const stored = window.localStorage.getItem(key);
        if (stored !== null) {
            state.hasStoredData = true;
            const restored = decodeStoredProgress(stored);
            if (restored && restored.clearRevision === state.clearRevision) {
                state.records = restored.records;
                state.goal = restored.goal;
                state.keep = true;
                state.generation = restored.generation;
            } else {
                restorationMessage = `Saved progress could not be read. Saving is off. ${UNSAVED_ENTRIES_HELP}`;
            }
        }
    } catch {
        state.storageAvailable = false;
        restorationMessage = `Browser storage is unavailable. You can still use the session. ${UNSAVED_ENTRIES_HELP}`;
    }

    const element = (tag, className = '', text = '') => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    const button = (label, action, dataName, secondary = false, quiet = false) => {
        const node = element('button', `hep-session-button${quiet ? ' is-quiet' : secondary ? ' is-secondary' : ''}`, label);
        node.type = 'button';
        if (dataName) node.setAttribute(dataName, '');
        node.addEventListener('click', action);
        return node;
    };
    const focusHeading = heading => {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        if (dialog.contains(heading)) {
            focusBody.scrollTop = 0;
            return;
        }
        heading.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    const ICON_PATHS = {
        close: ['M6 6l12 12', 'M18 6L6 18'],
        back: ['M15 5l-7 7 7 7'],
        check: ['M5 12.5l4.5 4.5L19 7.5'],
        settings: ['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', 'M15 5a2 2 0 1 1 0 4a2 2 0 1 1 0-4z', 'M9 15a2 2 0 1 1 0 4a2 2 0 1 1 0-4z']
    };
    const icon = name => {
        const namespace = 'http://www.w3.org/2000/svg';
        const graphic = document.createElementNS(namespace, 'svg');
        graphic.setAttribute('viewBox', '0 0 24 24');
        graphic.setAttribute('aria-hidden', 'true');
        graphic.setAttribute('focusable', 'false');
        ICON_PATHS[name].forEach(path => {
            const line = document.createElementNS(namespace, 'path');
            line.setAttribute('d', path);
            graphic.append(line);
        });
        return graphic;
    };
    const iconButton = (label, name, action, dataName) => {
        const node = element('button', 'hep-session-icon-button');
        node.type = 'button';
        node.setAttribute('aria-label', label);
        if (dataName) node.setAttribute(dataName, '');
        node.append(icon(name));
        node.addEventListener('click', action);
        return node;
    };
    const paragraph = (parent, text, className = '') => parent.append(element('p', className, text));
    const definitionList = pairs => {
        const list = element('dl', 'hep-session-prescription');
        pairs.forEach(([label, text]) => {
            const row = element('div');
            row.append(element('dt', '', label), element('dd', '', text));
            list.append(row);
        });
        return list;
    };

    const shell = element('div', 'hep-session-shell');
    const header = element('header', 'hep-session-header');
    const title = element('h2', '', 'Guided session');
    title.id = 'hep-session-title';
    header.append(title);
    root.setAttribute('aria-labelledby', title.id);
    const panel = element('div', 'hep-session-panel');

    const safety = element('details', 'hep-session-safety');
    safety.append(element('summary', '', 'Plan today’s session & check symptoms'));
    safety.append(element('h3', '', 'Which exercises should I do today?'));
    paragraph(safety, program.programIntro);
    const stageLink = element('a', '', 'When to move to the next stage');
    stageLink.href = '#progress';
    safety.append(stageLink, element('h3', '', 'Program fit and warning signs'));
    paragraph(safety, program.fitIntro);
    const safetyLink = element('a', '', 'Read the full program fit & safety guidance');
    safetyLink.href = '#fit';
    safety.append(safetyLink);
    paragraph(safety, program.responseIntro);
    const rules = element('div', 'hep-session-rules');
    [['Green light', program.green], ['Yellow light', program.yellow], ['Red light', program.red]].forEach(([label, text]) => {
        const rule = element('section');
        rule.append(element('h3', '', label), element('p', '', text));
        rules.append(rule);
    });
    safety.append(rules);

    const storage = element('div', 'hep-session-storage');
    const storageLabel = element('label', 'hep-session-check');
    const storageCheckbox = element('input');
    storageCheckbox.type = 'checkbox';
    storageCheckbox.setAttribute('data-hep-storage', '');
    storageCheckbox.checked = state.keep;
    storageCheckbox.disabled = !state.storageAvailable;
    storageLabel.append(storageCheckbox, element('span', '', 'Keep my progress on this device'));
    const storageHelp = element('p');
    storageHelp.id = 'hep-session-storage-help';
    const sharedDevice = element('p', '', 'Anyone using this browser may see saved entries.');
    sharedDevice.id = 'hep-session-shared-device';
    storageCheckbox.setAttribute('aria-describedby', storageHelp.id + ' ' + sharedDevice.id);
    storage.append(storageLabel, storageHelp, sharedDevice);
    const storageDetails = element('details', 'hep-session-options');
    storageDetails.append(element('summary', '', 'What gets saved?'));
    paragraph(storageDetails, DRAFT_PROGRESS_HELP);
    paragraph(storageDetails, 'Entries stay in this browser. Clearing browser data can erase them. Printing a summary does not send it to your doctor.');
    const privacyLink = element('a', '', 'Privacy and device storage');
    privacyLink.href = '../privacy/#exercise-progress';
    storageDetails.append(privacyLink);
    storage.append(storageDetails);
    const status = element('p', 'hep-session-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.setAttribute('data-hep-status', '');

    // The active session opens as a modal view: full screen on a phone, with
    // the main actions fixed at the bottom so they never scroll out of reach.
    const dialog = element('dialog', 'hep-session-dialog');
    dialog.setAttribute('aria-labelledby', 'hep-focus-title');
    dialog.setAttribute('data-hep-focus', '');
    const focusFrame = element('div', 'hep-focus');
    const focusHead = element('div', 'hep-focus-head');
    const focusBody = element('div', 'hep-focus-body');
    const focusFoot = element('div', 'hep-focus-foot');
    const focusStatus = element('p', 'hep-focus-status');
    focusStatus.setAttribute('role', 'status');
    focusStatus.setAttribute('aria-live', 'polite');
    focusStatus.setAttribute('aria-atomic', 'true');
    focusFrame.append(focusHead, focusBody, focusFoot, focusStatus);
    dialog.append(focusFrame);
    shell.append(header, panel, safety, storage, status, dialog);
    root.replaceChildren(shell);

    function announce(message) {
        status.textContent = message;
        focusStatus.textContent = message;
    }
    function canClearProgress() {
        return Boolean(state.records.length || state.goal || state.keep || state.hasStoredData);
    }
    function updateClearButton() {
        const clear = root.querySelector('[data-hep-clear]');
        if (clear) clear.disabled = !canClearProgress();
    }
    function updateStorageHelp() {
        if (!state.storageAvailable) {
            storageHelp.textContent = `Browser storage is unavailable. ${UNSAVED_ENTRIES_HELP}`;
        } else if (state.keep) {
            storageHelp.textContent = 'Saving is on for this program in this browser. Up to 30 completed log entries and your activity goal are kept.';
        } else {
            storageHelp.textContent = `Saving is off. ${UNSAVED_ENTRIES_HELP}`;
        }
    }
    function decodeStoredProgress(raw) {
        if (typeof raw !== 'string' || raw.length > MAX_PROGRESS_BYTES) return null;
        try { return validateProgressStore(JSON.parse(raw), program.slug, program.exercises.length); } catch { return null; }
    }
    function readClearRevision() {
        const revision = window.localStorage.getItem(clearKey);
        return isStorageToken(revision) ? revision : undefined;
    }
    function turnSavingOff(message, hasStoredData = false) {
        state.keep = false;
        state.hasStoredData = hasStoredData;
        state.generation = undefined;
        storageCheckbox.checked = false;
        updateStorageHelp();
        updateClearButton();
        announce(message);
    }
    function clearProgressInMemory(revision, hasStoredData = false, moveFocus = false) {
        state.records = [];
        state.goal = '';
        state.changedIds.clear();
        state.goalChanged = false;
        state.historyNeedsRefresh = false;
        state.keep = false;
        state.hasStoredData = hasStoredData;
        state.generation = undefined;
        state.clearRevision = revision;
        storageCheckbox.checked = false;
        updateStorageHelp();
        resetSummaryPrint();
        // Remove references to the cleared log without rebuilding an active
        // exercise, which would interrupt its timer or draft fields.
        root.querySelector('[data-hep-previous-sets]')?.remove();
        const activeGoal = root.querySelector('#hep-session-goal');
        if (activeGoal) activeGoal.value = '';
        if (state.savedId) {
            // The entry saved from this session was part of the cleared log.
            state.savedId = null;
            if (state.view === 'finish') renderFinish(false);
        }
        if (state.view === 'history') renderHistory(moveFocus || panel.contains(document.activeElement));
    }
    function observeProgressClear(revision) {
        if (revision === state.clearRevision) return false;
        if (revision === undefined) {
            state.clearRevision = undefined;
            return false;
        }
        clearRemoteProgress(revision);
        return true;
    }
    function clearRemoteProgress(revision) {
        clearProgressInMemory(revision);
        announce('Progress cleared for this program in another tab. Device saving is off.');
    }
    function persistProgress({ explicitOptIn = false } = {}) {
        if (!state.keep) return true;
        try {
            if (observeProgressClear(readClearRevision())) return false;
            const raw = window.localStorage.getItem(key);
            const decoded = decodeStoredProgress(raw);
            const stored = decoded?.clearRevision === state.clearRevision ? decoded : null;
            // A missing or replaced consent must never be recreated by a stale
            // session save or response edit. Only a fresh checkbox opt-in can
            // start saving again after removal in another tab.
            if (!explicitOptIn && (raw === null || !stored || stored.generation !== state.generation)) {
                turnSavingOff(`Device saving changed in another tab. Saving is now off here. ${UNSAVED_ENTRIES_HELP}`, raw !== null);
                return false;
            }
            if (explicitOptIn) state.generation = stored?.generation || newRecordId();
            state.records = mergeProgressRecords(state.records, stored?.records || [], state.changedIds);
            const savedGoal = state.goalChanged || explicitOptIn ? state.goal : stored?.goal || '';
            if (!state.started || state.goalChanged || explicitOptIn) state.goal = savedGoal;
            const nextStore = {
                version: SESSION_STORAGE_VERSION,
                slug: program.slug,
                goal: savedGoal,
                records: state.records.slice(0, MAX_RECORDS)
            };
            if (state.generation !== undefined) nextStore.generation = state.generation;
            if (state.clearRevision !== undefined) nextStore.clearRevision = state.clearRevision;
            const serialized = JSON.stringify(nextStore);
            if (serialized !== raw) {
                window.localStorage.setItem(key, serialized);
                // A clear can land in another tab between the read and write.
                // Its revision makes this write ineligible for restoration.
                if (observeProgressClear(readClearRevision())) {
                    if (window.localStorage.getItem(key) === serialized) window.localStorage.removeItem(key);
                    return false;
                }
            }
            state.hasStoredData = true;
            state.changedIds.clear();
            state.goalChanged = false;
            updateClearButton();
            return true;
        } catch {
            state.keep = false;
            state.storageAvailable = false;
            storageCheckbox.checked = false;
            storageCheckbox.disabled = true;
            updateStorageHelp();
            updateClearButton();
            announce(`Progress could not be saved on this device. ${UNSAVED_ENTRIES_HELP} Previously saved entries may still exist in this browser.`);
            return false;
        }
    }
    storageCheckbox.addEventListener('change', () => {
        if (storageCheckbox.checked) {
            state.keep = true;
            if (persistProgress({ explicitOptIn: true })) announce(`Saving is on for completed log entries in this browser. ${DRAFT_PROGRESS_HELP}`);
        } else {
            state.keep = false;
            try {
                if (observeProgressClear(readClearRevision())) return;
                window.localStorage.removeItem(key);
                state.hasStoredData = false;
                state.generation = undefined;
                announce(`Saved progress was removed from this browser. Your current entries are now unsaved. ${UNSAVED_ENTRIES_HELP}`);
            } catch {
                announce(`Saving is off, but this browser could not remove previously saved progress. ${UNSAVED_ENTRIES_HELP}`);
            }
        }
        updateStorageHelp();
        updateClearButton();
    });

    function refreshHistoryFromStorage() {
        if (state.view !== 'history') return;
        const active = document.activeElement;
        if (panel.contains(active) && active.matches('input, textarea, select, button')) {
            state.historyNeedsRefresh = true;
            // Refresh other responses without closing an active dropdown or
            // replacing a focused input. New entries appear when focus leaves.
            panel.querySelectorAll('[data-hep-entry]').forEach(entry => {
                const record = state.records.find(item => item.id === entry.dataset.hepEntry);
                const select = entry.querySelector('[data-hep-next-response]');
                if (record && select && select !== active) select.value = record.response;
            });
        } else {
            state.historyNeedsRefresh = false;
            renderHistory(false);
        }
    }
    panel.addEventListener('focusout', () => {
        window.setTimeout(() => {
            if (state.historyNeedsRefresh && state.view === 'history' && !panel.contains(document.activeElement)) {
                state.historyNeedsRefresh = false;
                renderHistory(false);
            }
        }, 0);
    });
    // The scoped revision contains no entries or goal. A channel can still
    // notify open tabs when the browser refuses the revision write.
    let clearChannel;
    try {
        if (typeof window.BroadcastChannel === 'function') {
            clearChannel = new window.BroadcastChannel(clearKey);
            clearChannel.addEventListener('message', event => {
                if (event.data === 'clear') clearRemoteProgress(state.clearRevision);
            });
        }
    } catch { /* Browser policy can block cross-tab communication. */ }

    window.addEventListener('storage', event => {
        if (event.key !== key && event.key !== clearKey && event.key !== null) return;
        let revision = event.key === clearKey && isStorageToken(event.newValue) ? event.newValue : state.clearRevision;
        try { revision = readClearRevision(); } catch { /* Use the event when storage cannot be read. */ }
        if (observeProgressClear(revision) || event.key === clearKey) return;
        if (!state.keep) {
            state.hasStoredData = event.newValue !== null;
            updateClearButton();
            return;
        }
        if (event.newValue === null) {
            const removed = decodeStoredProgress(event.oldValue);
            if (removed && (removed.generation !== state.generation || removed.clearRevision !== state.clearRevision)) return;
            // If a stale write raced with deletion, discard that old consent
            // generation too. A fresh opt-in has a different generation.
            try {
                const current = decodeStoredProgress(window.localStorage.getItem(key));
                if (current && current.generation === state.generation && current.clearRevision === state.clearRevision) {
                    window.localStorage.removeItem(key);
                }
            } catch { /* Keep the memory log usable when storage is blocked. */ }
            turnSavingOff(`Saved progress was removed in another tab. Saving is now off here. ${UNSAVED_ENTRIES_HELP}`);
            return;
        }
        const stored = decodeStoredProgress(event.newValue);
        if (stored && stored.clearRevision !== state.clearRevision) return;
        if (!stored || stored.generation !== state.generation) {
            turnSavingOff(`Device saving changed in another tab. Saving is now off here. ${UNSAVED_ENTRIES_HELP}`, true);
            return;
        }
        const merged = mergeProgressRecords(state.records, stored.records, state.changedIds);
        state.records = merged;
        if (!state.goalChanged && !state.started) state.goal = stored.goal;
        // A simultaneous addition may have been absent from the other tab's
        // snapshot. Re-read the scoped key before reconciling either record.
        if (JSON.stringify(merged) !== JSON.stringify(stored.records) && !persistProgress()) return;
        refreshHistoryFromStorage();
        updateClearButton();
        announce('Progress updated from another tab in this browser.');
    });

    function panelHeading(text) {
        const heading = element('h3', '', text);
        panel.append(heading);
        return heading;
    }
    // The inline panel shows the start point, a paused session, or the log.
    // Fit and symptom guidance sits with the start point; device saving
    // controls sit with the log, so neither repeats inside the session.
    function showInlineSections() {
        safety.hidden = state.view !== 'welcome';
        storage.hidden = state.view !== 'history';
    }
    function resetPanel() {
        panel.replaceChildren();
    }
    function clearFocus() {
        state.exerciseTimer?.cleanup();
        state.exerciseTimer = null;
        focusHead.replaceChildren();
        focusBody.replaceChildren();
        focusFoot.replaceChildren();
        focusBody.scrollTop = 0;
    }
    function openFocus() {
        document.documentElement.classList.add('hep-focus-open');
        if (dialog.open) return;
        if (typeof dialog.showModal === 'function') {
            try {
                dialog.showModal();
                return;
            } catch { /* Fall back to the open attribute below. */ }
        }
        dialog.setAttribute('open', '');
    }
    function hideFocus() {
        if (typeof dialog.close === 'function' && dialog.open) dialog.close();
        else if (dialog.hasAttribute('open')) {
            dialog.removeAttribute('open');
            handleFocusClosed();
        }
    }
    // Closing with the X button or Escape pauses the session so it can be
    // resumed from the page. Finishing changes the view before closing.
    function handleFocusClosed() {
        document.documentElement.classList.remove('hep-focus-open');
        if (!['intro', 'exercise', 'finish'].includes(state.view)) return;
        const pausedView = state.view;
        clearFocus();
        if (state.started && pausedView !== 'intro') state.resumeView = pausedView;
        const targetId = state.afterClose;
        const target = targetId ? document.getElementById(targetId) : null;
        state.afterClose = '';
        renderWelcome(!target);
        if (target) {
            // A normal fragment change lets the browser's Back button return here.
            if (window.location.hash !== `#${targetId}`) window.location.hash = targetId;
            else target.scrollIntoView({ block: 'start', behavior: 'instant' });
            const heading = target.querySelector('h2, h3');
            if (heading) {
                heading.tabIndex = -1;
                heading.focus({ preventScroll: true });
            }
        }
        if (state.started) announce('Session paused. Choose Return to session to continue where you left off.');
    }
    dialog.addEventListener('close', handleFocusClosed);
    window.addEventListener('pagehide', stopActiveTimer);
    window.addEventListener('pageshow', event => {
        if (event.persisted) {
            try { observeProgressClear(readClearRevision()); } catch { /* Keep the active session usable. */ }
        }
        if (event.persisted && state.view === 'exercise') renderExercise(false);
    });
    function counts() {
        return {
            completed: state.steps.filter(step => step === 'done').length,
            skipped: state.steps.filter(step => step === 'skipped').length
        };
    }
    // A link inside the session view closes it first, then shows that part
    // of the page, so the session can be resumed afterward.
    function pageLink(text, id) {
        const link = element('a', 'hep-session-page-link', text);
        link.href = `#${id}`;
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            state.afterClose = id;
            hideFocus();
        });
        return link;
    }
    function closeButton() {
        return iconButton('Close session', 'close', hideFocus, 'data-hep-close');
    }
    function focusHeadingElement(text) {
        const heading = element('h3', '', text);
        heading.id = 'hep-focus-title';
        return heading;
    }
    function startSession() {
        state.steps = perExercise(null);
        state.setCounts = perExercise(0);
        state.loads = perExercise('');
        state.shown = perExercise('');
        state.index = 0;
        state.started = true;
        state.savedId = null;
        state.settingsOpen = false;
        state.date = localDateString();
        state.notes = '';
        state.response = 'not-checked';
        renderExercise(true);
        announce('Session started. Follow the instructions for each exercise due today.');
    }
    function renderWelcome(moveFocus = false) {
        state.view = 'welcome';
        resetPanel();
        showInlineSections();
        if (state.started) {
            const heading = panelHeading('Session in progress');
            paragraph(panel, state.resumeView === 'finish'
                ? 'Every exercise is marked. Return to save or finish this session.'
                : `Exercise ${state.index + 1} of ${exerciseCount}: ${program.exercises[state.index].name}`);
            const actions = element('div', 'hep-session-actions');
            actions.append(button('Return to session', returnToSession, 'data-hep-resume'),
                button('Start over', renderIntro, 'data-hep-restart', true),
                button('Progress log', () => renderHistory(true), 'data-hep-log', false, true));
            panel.append(actions);
            if (moveFocus) focusHeading(heading);
            return;
        }
        const heading = panelHeading('Your next session');
        paragraph(panel, `${exerciseCount} exercises, one screen at a time.`);
        const actions = element('div', 'hep-session-actions');
        actions.append(button('Start session', renderIntro, 'data-hep-start'), button('Progress log', () => renderHistory(true), 'data-hep-log', false, true));
        panel.append(actions, definitionList([['How often', program.frequency], ['Equipment', program.equipment]]));
        if (document.getElementById('video')) {
            const video = element('a', 'hep-session-video-link', 'Watch the exercise video');
            video.href = '#video';
            panel.append(video);
        }
        const goals = element('details', 'hep-session-options');
        goals.append(element('summary', '', 'Program goal and checkpoint'),
            definitionList([['Program goal', program.goal], ['Checkpoint', program.checkpoint]]));
        panel.append(goals);
        if (moveFocus) focusHeading(heading);
    }
    // First screen of the session view: what today's session involves.
    function renderIntro() {
        state.view = 'intro';
        clearFocus();
        openFocus();
        focusHead.append(closeButton(), element('p', 'hep-focus-label', 'Guided session'));
        const heading = focusHeadingElement(document.getElementById('page-title')?.textContent.trim() || program.title);
        focusBody.append(heading, definitionList([['Today', `${exerciseCount} exercises`], ['How often', program.frequency], ['Equipment', program.equipment]]));
        if (firstStage) {
            const cue = element('p', 'hep-first-stage');
            cue.append(element('strong', '', 'Where to start'), document.createTextNode(firstStage));
            focusBody.append(cue);
        }
        const plan = element('ol', 'hep-session-plan');
        plan.setAttribute('aria-label', 'Exercises in this session');
        program.exercises.forEach(exercise => plan.append(element('li', '', exercise.name)));
        focusBody.append(plan, stopSigns());
        focusFoot.append(button('Begin', startSession, 'data-hep-begin'));
        focusHeading(heading);
    }
    function stopSigns() {
        const details = element('details', 'hep-session-detail hep-session-stop');
        details.setAttribute('data-hep-stop-signs', '');
        details.append(element('summary', '', 'Stop signs'), element('p', '', program.red), pageLink('Read the full program fit & safety guidance', 'fit'));
        return details;
    }
    function settingsPanel() {
        const settings = element('div', 'hep-session-settings');
        settings.id = 'hep-session-settings';
        const label = element('label', 'hep-session-check');
        const input = element('input');
        input.type = 'checkbox';
        input.checked = state.recordLoad;
        input.setAttribute('data-hep-record-load', '');
        label.append(input, element('span', '', 'Record weight or band'));
        const help = element('p', 'hep-session-entry-meta', 'Adds one optional box to exercises that use resistance, saved with the session if you save it.');
        input.addEventListener('change', () => {
            state.recordLoad = input.checked;
            renderExercise(false);
            focusBody.querySelector('[data-hep-record-load]')?.focus();
            announce(state.recordLoad ? 'Weight or band boxes are on.' : 'Weight or band boxes are off.');
        });
        settings.append(label, help);
        return settings;
    }
    function setTracker({ minimum, maximum }) {
        const index = state.index;
        const group = element('div', 'hep-session-sets');
        group.setAttribute('role', 'group');
        const optional = maximum === minimum ? ''
            : maximum - minimum === 1 ? ` Set ${maximum} is optional.` : ` Sets ${minimum + 1} to ${maximum} are optional.`;
        const label = element('p', 'hep-session-sets-label', `Tap a circle after each set.${optional}`);
        label.id = 'hep-sets-label';
        group.setAttribute('aria-labelledby', label.id);
        const row = element('div', 'hep-session-set-row');
        const circles = [];
        const update = () => {
            circles.forEach((circle, position) => {
                const done = position < state.setCounts[index];
                circle.setAttribute('aria-pressed', String(done));
                circle.replaceChildren(done ? icon('check') : document.createTextNode(String(position + 1)));
            });
        };
        for (let number = 1; number <= maximum; number += 1) {
            const circle = element('button', `hep-session-set${number > minimum ? ' is-optional' : ''}`);
            circle.type = 'button';
            circle.setAttribute('data-hep-set-count', String(number));
            circle.setAttribute('aria-label', `Set ${number}${number > minimum ? ' (optional)' : ''}`);
            circle.addEventListener('click', () => {
                state.setCounts[index] = state.setCounts[index] >= number ? number - 1 : number;
                update();
                const total = state.setCounts[index];
                announce(`${total} ${total === 1 ? 'set' : 'sets'} marked.`);
            });
            circles.push(circle);
            row.append(circle);
        }
        update();
        group.append(label, row);
        return group;
    }
    function loadField() {
        const index = state.index;
        const wrapper = element('div', 'hep-session-field hep-session-load');
        const label = element('label', '', 'Weight or band (optional)');
        const input = element('input');
        input.type = 'text';
        input.id = `hep-load-${index}`;
        input.maxLength = 60;
        input.autocomplete = 'off';
        input.placeholder = 'For example: 10 lb or light blue band';
        input.value = state.loads[index];
        input.setAttribute('data-hep-load', '');
        label.htmlFor = input.id;
        input.addEventListener('input', () => { state.loads[index] = input.value; });
        wrapper.append(label, input);
        const last = state.records.find(record => record.workout?.[index]?.sets.some(hasRecordedSetDetails));
        if (last) {
            const entry = last.workout[index];
            const previous = element('p', 'hep-session-entry-meta', `Last recorded ${displayDate(last.date)}: ${describeSet(entry.sets.find(hasRecordedSetDetails), entry.measure, entry.label)}`);
            previous.setAttribute('data-hep-previous-sets', '');
            wrapper.append(previous);
        }
        return wrapper;
    }
    function modifiers(exercise) {
        const index = state.index;
        const wrapper = element('div', 'hep-session-modifiers');
        const toggles = element('div', 'hep-session-modifier-buttons');
        const box = element('div', 'hep-session-modifier');
        box.id = 'hep-session-modifier';
        const kinds = [['easier', 'Make it easier', 'Easier option'], ['harder', 'Make it harder', 'Harder option']];
        const show = () => {
            const kind = state.shown[index];
            toggles.querySelectorAll('button').forEach(toggle => {
                toggle.setAttribute('aria-expanded', String(toggle.dataset.kind === kind));
            });
            box.hidden = !kind;
            box.className = `hep-session-modifier${kind ? ` is-${kind}` : ''}`;
            box.replaceChildren();
            if (!kind) return;
            box.append(element('h4', '', kinds.find(([name]) => name === kind)[2]), element('p', '', exercise[kind]));
            if (kind === 'harder') box.append(pageLink('When to move to the next stage', 'progress'));
        };
        kinds.forEach(([kind, label]) => {
            const toggle = button(label, () => {
                state.shown[index] = state.shown[index] === kind ? '' : kind;
                show();
            }, `data-hep-${kind}`, true);
            toggle.dataset.kind = kind;
            toggle.setAttribute('aria-controls', box.id);
            toggles.append(toggle);
        });
        show();
        wrapper.append(toggles, box);
        return wrapper;
    }
    function renderExercise(moveFocus = false) {
        state.view = 'exercise';
        clearFocus();
        openFocus();
        const exercise = program.exercises[state.index];
        const { completed, skipped } = counts();
        const markedCount = completed + skipped;
        const finishNext = state.index === exerciseCount - 1 ||
            (markedCount === exerciseCount - 1 && state.steps[state.index] === null);
        const progressGroup = element('div', 'hep-session-progress');
        const position = element('p', '', `Exercise ${state.index + 1} of ${exerciseCount}`);
        position.id = 'hep-exercise-position';
        const progress = element('progress');
        progress.max = exerciseCount;
        progress.value = markedCount;
        progress.setAttribute('aria-label', 'Exercises marked done or skipped');
        progress.setAttribute('aria-valuetext', `${markedCount} of ${exerciseCount} exercises marked`);
        progressGroup.append(position, progress);
        focusHead.append(closeButton(), progressGroup);
        if (canRecordLoad) {
            const settings = iconButton('Session settings', 'settings', () => {
                state.settingsOpen = !state.settingsOpen;
                renderExercise(false);
                focusHead.querySelector('[data-hep-settings]')?.focus();
            }, 'data-hep-settings');
            settings.setAttribute('aria-expanded', String(state.settingsOpen));
            settings.setAttribute('aria-controls', 'hep-session-settings');
            focusHead.append(settings);
            if (state.settingsOpen) focusBody.append(settingsPanel());
        }
        const card = element('article', 'hep-session-exercise');
        card.setAttribute('data-hep-exercise', '');
        const heading = focusHeadingElement(exercise.name);
        heading.setAttribute('data-hep-exercise-title', '');
        heading.setAttribute('aria-describedby', position.id);
        const prescription = definitionList([['How much', exercise.dose], ['How often', exercise.frequency]]);
        card.append(heading, prescription);
        if (state.index === 0 && program.strengthStartIndex !== undefined) {
            // The first impact drill requires clearance. Put this choice before its running dose.
            const startingCue = element('p', 'hep-first-stage');
            startingCue.append(element('strong', '', 'Where to start'), document.createTextNode(firstStage || program.programIntro));
            prescription.before(startingCue, button('Go to strength exercises', () => {
                state.index = program.strengthStartIndex;
                renderExercise(true);
            }, 'data-hep-strength-start', true));
        }
        const range = doseSetRange(exercise.dose);
        if (range) card.append(setTracker(range));
        const presets = program.timerOptions?.[exercise.name] || [];
        if (presets.length) state.exerciseTimer = mountExerciseTimer(card, presets);
        if (state.recordLoad && program.workoutOptions?.[state.index]?.resistance) card.append(loadField());
        card.append(element('h4', '', 'How to do it'), element('p', '', exercise.how), modifiers(exercise));
        if (state.steps[state.index]) paragraph(card, `Previously marked ${state.steps[state.index] === 'done' ? 'done' : 'skipped'}. You can change this with the buttons below.`, 'hep-session-entry-meta');
        if (state.index === 0) paragraph(card, 'Skip an exercise if it is for another day or a later stage, or if your clinician told you to leave it out.', 'hep-session-entry-meta');
        card.append(stopSigns());
        focusBody.append(card);
        const advance = choice => {
            state.steps[state.index] = choice;
            if (finishNext) {
                renderFinish(true);
            } else {
                state.index += 1;
                renderExercise(true);
            }
        };
        const previous = iconButton('Previous exercise', 'back', () => {
            state.index -= 1;
            renderExercise(true);
        }, 'data-hep-back');
        previous.disabled = state.index === 0;
        focusFoot.append(previous,
            button(finishNext ? 'Skip & finish' : 'Skip', () => advance('skipped'), 'data-hep-skip', true),
            button(finishNext ? 'Done & finish' : 'Done', () => advance('done'), 'data-hep-done'));
        if (moveFocus) focusHeading(heading);
    }

    function responseSelect(labelText, id, value) {
        const wrapper = element('div', 'hep-session-field');
        const label = element('label', '', labelText);
        label.htmlFor = id;
        const select = element('select');
        select.id = id;
        NEXT_MORNING_RESPONSES.forEach(response => {
            const option = element('option', '', response.label);
            option.value = response.value;
            select.append(option);
        });
        select.value = value;
        wrapper.append(label, select);
        return { wrapper, select };
    }
    function textField(labelText, id, type, value, maximum, update) {
        const wrapper = element('div', 'hep-session-field');
        const label = element('label', '', labelText);
        label.htmlFor = id;
        const input = element(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') input.type = type;
        else input.rows = 3;
        input.id = id;
        input.value = value;
        if (maximum) input.maxLength = maximum;
        input.addEventListener('input', () => update(input.value));
        wrapper.append(label, input);
        return { wrapper, input };
    }
    // Weight or band entries reuse the existing recorded-set format, so older
    // workout logs and new entries display and print the same way.
    function sessionWorkout() {
        if (!state.recordLoad || !program.workoutOptions) return null;
        const loads = state.steps.map((step, index) => step === 'done' && program.workoutOptions[index].resistance
            ? state.loads[index].trim().slice(0, 60) : '');
        if (!loads.some(Boolean)) return null;
        return state.steps.map((step, index) => ({
            status: step, measure: program.workoutOptions[index].measure, label: program.workoutOptions[index].label,
            sets: loads[index] ? [{ amount: null, holdSeconds: null, load: null, unit: 'other', resistance: loads[index], note: '' }] : []
        }));
    }
    function buildRecord() {
        const now = Date.now();
        const value = {
            id: newRecordId(), date: state.date, ...counts(),
            response: state.response, notes: state.notes, goal: state.goal,
            createdAt: now, updatedAt: now
        };
        const setCounts = state.steps.map((step, index) => step === 'done' ? state.setCounts[index] : 0);
        if (setCounts.some(Boolean)) value.setCounts = setCounts;
        const workout = sessionWorkout();
        if (workout) value.workout = workout;
        return createSessionRecord(value, exerciseCount);
    }
    function entryFields(open) {
        const details = element('details', 'hep-session-options hep-session-log-details');
        details.open = open;
        details.append(element('summary', '', 'Add a note or change the date'));
        const dateField = textField('Session date', 'hep-session-date', 'date', state.date, null, value => { state.date = value; });
        dateField.input.required = true;
        const goalField = textField('Activity goal (optional)', 'hep-session-goal', 'text', state.goal, 140, value => { state.goal = value; state.goalChanged = true; });
        goalField.input.placeholder = 'For example: walk to the park comfortably';
        const notesField = textField('Notes (optional)', 'hep-session-notes', 'textarea', state.notes, 200, value => { state.notes = value; });
        notesField.input.placeholder = 'How it felt, what you changed, or anything to discuss at follow-up';
        details.append(dateField.wrapper, goalField.wrapper, notesField.wrapper);
        return { details, dateInput: dateField.input };
    }
    function saveSession(optIn, dateInput, focusTarget = 'saved') {
        const record = buildRecord();
        if (!record) {
            announce('Check the session date and field lengths before saving.');
            if (dateInput) {
                dateInput.closest('details').open = true;
                dateInput.focus();
            }
            return;
        }
        if (optIn) {
            state.keep = true;
            storageCheckbox.checked = true;
        }
        state.records = [record, ...state.records].slice(0, MAX_RECORDS);
        state.changedIds.add(record.id);
        state.goalChanged = true;
        state.savedId = record.id;
        const saved = persistProgress({ explicitOptIn: optIn });
        updateStorageHelp();
        updateClearButton();
        renderFinish(false);
        if (focusTarget === 'heading') focusHeading(focusBody.querySelector('#hep-focus-title'));
        else if (focusTarget === 'saved') focusBody.querySelector('[data-hep-saved]')?.focus({ preventScroll: true });
        if (saved) announce(optIn ? 'Session saved on this device. Later sessions will save automatically.' : 'Session saved to your progress log on this device.');
    }
    function updateSavedEntry(dateInput) {
        const current = state.records.find(record => record.id === state.savedId);
        if (!current) return;
        const updated = createSessionRecord({ ...current, date: state.date, notes: state.notes, goal: state.goal, updatedAt: Date.now() }, exerciseCount);
        if (!updated) {
            announce('Check the session date and field lengths before updating this entry.');
            dateInput.focus();
            return;
        }
        Object.assign(current, updated);
        state.changedIds.add(current.id);
        state.goalChanged = true;
        if (persistProgress()) announce(state.keep ? 'Entry updated and saved in this browser.' : `Entry updated. Device saving is off. ${UNSAVED_ENTRIES_HELP}`);
    }
    function saveSection() {
        const section = element('section', 'hep-session-save');
        section.setAttribute('data-hep-save-panel', '');
        if (state.savedId && state.records.some(record => record.id === state.savedId)) {
            const saved = element('p', 'hep-session-saved', state.keep ? 'Saved to your progress log on this device.' : `Added to your progress log for this visit. ${UNSAVED_ENTRIES_HELP}`);
            saved.tabIndex = -1;
            saved.setAttribute('data-hep-saved', '');
            const fields = entryFields(false);
            const update = button('Update entry', () => updateSavedEntry(fields.dateInput), 'data-hep-update-entry', true);
            fields.details.append(update);
            const log = button('View progress log', () => endSession(true), 'data-hep-log', false, true);
            section.append(saved, fields.details, log);
            return section;
        }
        if (!state.storageAvailable) {
            paragraph(section, `This browser is blocking storage, so this session can’t be saved here. ${UNSAVED_ENTRIES_HELP}`);
            return section;
        }
        const heading = element('h4', '', 'Save this session on this device?');
        heading.id = 'hep-save-heading';
        const help = element('p', '', SAVE_PROMPT_HELP);
        const form = element('form', 'hep-session-form');
        form.setAttribute('data-hep-review', '');
        form.setAttribute('aria-labelledby', heading.id);
        const fields = entryFields(Boolean(state.notes) || state.date !== localDateString());
        const actions = element('div', 'hep-session-actions');
        const save = element('button', 'hep-session-button', 'Save session');
        save.type = 'submit';
        save.setAttribute('data-hep-save', '');
        actions.append(save, button('Not now', () => endSession(false), 'data-hep-finish', true));
        form.append(fields.details, actions);
        form.addEventListener('invalid', () => { fields.details.open = true; }, true);
        form.addEventListener('submit', event => {
            event.preventDefault();
            saveSession(true, fields.dateInput);
        });
        section.append(heading, help, form);
        return section;
    }
    function renderFinish(moveFocus = false) {
        state.view = 'finish';
        clearFocus();
        openFocus();
        focusHead.append(closeButton(), element('p', 'hep-focus-label', 'Guided session'));
        const totals = counts();
        const unmarked = exerciseCount - totals.completed - totals.skipped;
        const heading = focusHeadingElement(unmarked ? 'Almost done' : 'Session complete');
        const summary = element('p', 'hep-session-entry-summary');
        const completed = element('span', '', `${totals.completed} done`);
        completed.setAttribute('data-hep-completed-count', '');
        const skipped = element('span', '', `${totals.skipped} skipped`);
        skipped.setAttribute('data-hep-skipped-count', '');
        summary.append(completed, document.createTextNode(' · '), skipped);
        focusBody.append(heading, summary);
        const previous = iconButton('Previous exercise', 'back', () => {
            state.index = exerciseCount - 1;
            renderExercise(true);
        }, 'data-hep-back');
        if (unmarked) {
            paragraph(focusBody, unmarked === 1 ? 'One exercise is still unmarked.' : `${unmarked} exercises are still unmarked.`);
            const actions = element('div', 'hep-session-actions');
            actions.append(button(`Mark ${unmarked} as skipped`, () => {
                state.steps = state.steps.map(step => step === null ? 'skipped' : step);
                renderFinish(true);
            }, 'data-hep-skip-unmarked'), button('Return to unmarked exercises', () => {
                state.index = state.steps.indexOf(null);
                renderExercise(true);
            }, 'data-hep-return-unmarked', true));
            focusBody.append(actions);
            focusFoot.append(previous, button('End without saving', () => endSession(false), 'data-hep-finish', true));
            if (moveFocus) focusHeading(heading);
            return;
        }
        // Once saving is on, later sessions are added without asking again.
        if (state.keep && state.storageAvailable && !state.savedId) {
            saveSession(false, null, moveFocus ? 'heading' : 'none');
            return;
        }
        const checkIn = element('section', 'hep-session-check-in');
        checkIn.append(element('h4', '', 'Check in tomorrow morning'), element('p', '', program.responseIntro));
        const rules = element('div', 'hep-session-rules');
        [['Green light', program.green], ['Yellow light', program.yellow], ['Red light', program.red]].forEach(([label, text]) => {
            const rule = element('section');
            rule.append(element('h5', '', label), element('p', '', text));
            rules.append(rule);
        });
        checkIn.append(rules);
        focusBody.append(saveSection(), checkIn);
        focusFoot.append(previous, button('Done', () => endSession(false), 'data-hep-finish-done'));
        if (moveFocus) focusHeading(heading);
    }
    function endSession(showLog) {
        const saved = Boolean(state.savedId);
        state.started = false;
        state.savedId = null;
        state.view = showLog ? 'history' : 'welcome';
        hideFocus();
        clearFocus();
        document.documentElement.classList.remove('hep-focus-open');
        if (showLog) renderHistory(true);
        else renderWelcome(true);
        announce(saved ? (state.keep ? 'Session finished and saved on this device.' : 'Session finished. It is in your progress log until you leave this page.') : 'Session finished without a log entry.');
    }

    function returnToSession() {
        if (!state.started) { renderIntro(); return; }
        if (state.resumeView === 'finish') renderFinish(true);
        else renderExercise(true);
    }
    function describeSetCounts(record) {
        if (!record.setCounts) return '';
        return record.setCounts.map((count, index) => count ? `${program.exercises[index].name} ${count}` : '')
            .filter(Boolean).join(' · ');
    }
    function renderHistory(moveFocus = false) {
        state.view = 'history';
        resetPanel();
        showInlineSections();
        const heading = panelHeading('Progress log');
        paragraph(panel, 'A record of your sessions and next-morning responses to bring to follow-up. Keep using your program’s dose, frequency, and symptom rules.');
        const actions = element('div', 'hep-session-actions');
        actions.append(button(state.started ? 'Return to session' : 'Start session', state.started ? returnToSession : renderIntro, state.started ? 'data-hep-resume' : 'data-hep-start'));
        const printButton = button('Print follow-up summary', printSummary, 'data-hep-print-summary', true);
        printButton.disabled = state.records.length === 0;
        actions.append(printButton);
        const clearButton = button('Clear progress', () => showClearConfirmation(clearButton), 'data-hep-clear', false, true);
        clearButton.disabled = !canClearProgress();
        actions.append(clearButton);
        panel.append(actions);
        const history = element('div', 'hep-session-history');
        history.setAttribute('data-hep-history', '');
        if (state.records.length === 0) {
            paragraph(history, 'No entries yet. At the end of a session you can save it here.', 'hep-session-empty');
        } else {
            paragraph(history, `${state.records.length} ${state.records.length === 1 ? 'entry' : 'entries'} · Latest 6 included in the follow-up summary.`);
            state.records.forEach((record, index) => {
                const entry = element('article', 'hep-session-entry');
                entry.setAttribute('data-hep-entry', record.id);
                const entryHeading = element('h4', '', displayDate(record.date));
                entry.append(entryHeading);
                paragraph(entry, `${record.completed} done · ${record.skipped} skipped`, 'hep-session-entry-meta');
                if (record.goal) paragraph(entry, `Activity goal: ${record.goal}`);
                if (record.notes) paragraph(entry, `Notes: ${record.notes}`);
                if (record.setCounts) paragraph(entry, `Sets: ${describeSetCounts(record)}`, 'hep-session-entry-meta');
                if (record.workout) appendWorkoutDetails(entry, record.workout, program.exercises);
                const response = responseSelect(`Next-morning response for ${displayDate(record.date)}`, `hep-response-${index}`, record.response);
                response.select.setAttribute('data-hep-next-response', '');
                response.select.addEventListener('change', () => {
                    if (!RESPONSE_VALUES.has(response.select.value)) return;
                    const current = state.records.find(item => item.id === record.id);
                    if (!current) return;
                    current.response = response.select.value;
                    current.updatedAt = Date.now();
                    state.changedIds.add(current.id);
                    if (persistProgress()) announce(state.keep ? 'Next-morning response updated and saved in this browser.' : `Next-morning response updated. Device saving is off. ${UNSAVED_ENTRIES_HELP}`);
                });
                entry.append(response.wrapper);
                history.append(entry);
            });
        }
        panel.append(history);
        if (moveFocus) focusHeading(heading);
    }
    function showClearConfirmation(trigger) {
        if (panel.querySelector('[data-hep-clear-confirmation]')) return;
        const confirmation = element('div', 'hep-session-inline-confirm');
        confirmation.setAttribute('data-hep-clear-confirmation', '');
        const heading = element('h4', '', 'Clear this program’s progress?');
        paragraph(confirmation, 'This removes all entries and the activity goal for this program from this browser and its open tabs.');
        const actions = element('div', 'hep-session-actions');
        const confirm = button('Yes, clear progress', () => {
            const revision = newRecordId();
            let revisionStored = false;
            let removed = false;
            try {
                window.localStorage.removeItem(key);
                removed = true;
            } catch { /* Keep clearing available so the visitor can retry. */ }
            try {
                window.localStorage.setItem(clearKey, revision);
                revisionStored = true;
            } catch { /* Notify other tabs through the channel below. */ }
            let notified = revisionStored;
            if (!notified && clearChannel) {
                try {
                    clearChannel.postMessage('clear');
                    notified = true;
                } catch { /* This tab can still clear its own entries. */ }
            }
            clearProgressInMemory(revisionStored ? revision : state.clearRevision, !removed, true);
            if (!removed) announce('Progress cleared from this tab. Browser storage is unavailable, so previously saved entries could not be removed.');
            else if (!notified) announce('Progress cleared from this tab and browser storage. Other open tabs could not be notified.');
            else announce('Progress cleared for this program. Device saving is off.');
        }, 'data-hep-confirm-clear');
        const cancel = button('Cancel', () => {
            confirmation.remove();
            trigger.focus();
            announce('Progress was kept.');
        }, 'data-hep-cancel-clear', true);
        actions.append(confirm, cancel);
        confirmation.prepend(heading);
        confirmation.append(actions);
        trigger.parentElement.after(confirmation);
        cancel.focus();
    }

    function resetSummaryPrint() {
        if (!state.printing && !state.printout) return;
        if (state.printTimer !== null) window.clearTimeout(state.printTimer);
        state.printTimer = null;
        state.printing = false;
        state.printout?.remove();
        state.printout = null;
        document.body.classList.remove('hep-summary-printing');
        root.querySelectorAll('[data-hep-print-summary]').forEach(node => {
            node.disabled = state.records.length === 0;
            node.removeAttribute('aria-busy');
        });
    }
    function buildSummary() {
        const report = element('article', 'hep-summary-printout');
        report.setAttribute('aria-label', 'Patient-recorded exercise follow-up summary');
        report.append(element('h1', '', 'Exercise follow-up summary'));
        paragraph(report, 'Patient-recorded', 'hep-summary-meta');
        report.append(element('h2', '', program.title));
        const entryCount = Math.min(state.records.length, 6);
        paragraph(report, `Prepared ${displayDate(localDateString())} · Latest ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`, 'hep-summary-meta');
        if (state.goal) paragraph(report, `Current activity goal: ${state.goal}`, 'hep-summary-goal');
        const table = element('table', 'hep-summary-table');
        const caption = element('caption', '', 'Patient-recorded sessions and next-morning responses');
        const head = element('thead');
        const headRow = element('tr');
        ['Date', 'Done', 'Skipped', 'Next-morning response', 'Notes / activity goal'].forEach(label => {
            const cell = element('th', '', label);
            cell.scope = 'col';
            headRow.append(cell);
        });
        head.append(headRow);
        const body = element('tbody');
        state.records.slice(0, 6).forEach(record => {
            const row = element('tr');
            const dateCell = element('th', '', displayDate(record.date));
            dateCell.scope = 'row';
            const notesCell = element('td');
            if (record.notes) paragraph(notesCell, record.notes);
            if (record.goal) paragraph(notesCell, `Goal: ${record.goal}`);
            if (record.setCounts) paragraph(notesCell, `Sets: ${describeSetCounts(record)}`);
            if (!record.notes && !record.goal && !record.setCounts) notesCell.textContent = '—';
            row.append(dateCell, element('td', '', String(record.completed)), element('td', '', String(record.skipped)), element('td', '', responseLabel(record.response)), notesCell);
            body.append(row);
        });
        table.append(caption, head, body);
        report.append(table);
        const latestWorkout = state.records.find(record => record.workout?.some(entry => entry.sets.some(hasRecordedSetDetails)));
        if (latestWorkout) {
            paragraph(report, `Set details · Most recent workout with recorded sets: ${displayDate(latestWorkout.date)}`, 'hep-summary-meta hep-summary-workout-date');
            appendWorkoutDetails(report, latestWorkout.workout, program.exercises, true);
        }
        paragraph(report, 'These entries are patient-recorded and have not been reviewed by a clinician. Use the original program’s dose, frequency, and symptom rules.');
        paragraph(report, `Program: ${program.canonical}`, 'hep-summary-meta');
        paragraph(report, 'Printing or saving this summary does not send it to your doctor. Bring it to follow-up if helpful.', 'hep-summary-meta');
        return report;
    }
    function printSummary() {
        if (state.printing || state.records.length === 0) return;
        if (typeof window.print !== 'function') {
            announce('Printing is unavailable in this browser. Your entries remain in the progress log.');
            return;
        }
        state.printout = buildSummary();
        document.body.append(state.printout);
        document.body.classList.add('hep-summary-printing');
        state.printing = true;
        root.querySelectorAll('[data-hep-print-summary]').forEach(node => {
            node.disabled = true;
            node.setAttribute('aria-busy', 'true');
        });
        announce('Print dialog opened. Choose a printer or Save as PDF. The summary is not sent to your doctor.');
        try {
            window.print();
            // Native print usually blocks until the dialog closes. This fallback
            // also restores browsers that omit afterprint after cancellation.
            if (state.printing && !window.matchMedia?.('print').matches) {
                state.printTimer = window.setTimeout(() => {
                    state.printTimer = null;
                    if (!window.matchMedia?.('print').matches) resetSummaryPrint();
                }, 1000);
            }
        } catch {
            resetSummaryPrint();
            announce('The print dialog could not open. Your entries remain in the progress log.');
        }
    }
    function cancelPrintFallback() {
        if (state.printTimer !== null) window.clearTimeout(state.printTimer);
        state.printTimer = null;
    }
    window.addEventListener('beforeprint', () => { if (state.printing) cancelPrintFallback(); });
    window.addEventListener('afterprint', resetSummaryPrint);
    const printMedia = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    const handlePrintMedia = event => {
        if (event.matches) cancelPrintFallback();
        else resetSummaryPrint();
    };
    if (typeof printMedia?.addEventListener === 'function') printMedia.addEventListener('change', handlePrintMedia);
    else if (typeof printMedia?.addListener === 'function') printMedia.addListener(handlePrintMedia);

    updateStorageHelp();
    renderWelcome();
    root.hidden = false;
    document.querySelectorAll('[data-hep-launch]').forEach(link => {
        link.hidden = false;
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            // Keep the link's normal fragment navigation and focus an available
            // control after the browser has moved to this inline workbench.
            window.setTimeout(() => {
                if (link.hasAttribute('data-hep-launch-start')) {
                    returnToSession();
                    return;
                }
                const control = root.querySelector('[data-hep-start], [data-hep-resume]');
                if (control) control.focus({ preventScroll: true });
                else focusHeading(panel.querySelector('h3') || title);
            }, 0);
        });
    });
    if (restorationMessage) announce(restorationMessage);
}

export function initGuidedSession() {
    const root = document.querySelector('[data-hep-session]');
    const source = document.getElementById('hep-session-data');
    if (!root || !source || root.dataset.hepSessionReady === 'true') return false;
    let program;
    try { program = validateProgramData(JSON.parse(source.textContent)); } catch { return false; }
    if (!program) return false;
    try {
        initializeGuidedSession(root, program);
        document.querySelectorAll('[data-hep-card-timer]').forEach(card => {
            const presets = program.timerOptions?.[card.dataset.hepCardTimer];
            if (presets?.length) mountExerciseTimer(card, presets);
        });
        root.dataset.hepSessionReady = 'true';
        return true;
    } catch {
        root.hidden = true;
        document.querySelectorAll('[data-hep-launch]').forEach(link => { link.hidden = true; });
        return false;
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGuidedSession, { once: true });
    else initGuidedSession();
}

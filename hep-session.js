// Optional patient session tools. Clinical instructions come from the page's
// generated program data; personal entries stay in memory or opted-in storage.
import { MAX_PROGRESS_BYTES, appendWorkoutDetails, blankSet, hasRecordedSetDetails, mountExerciseTimer, mountWorkout, recordedSets, stopActiveTimer, validateWorkoutEntries, validateWorkoutOptions } from './hep-workout.js?v=20261117-card-timers1';
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
const DRAFT_PROGRESS_HELP = 'In-progress exercise steps, set drafts, and timers are not saved. Refreshing, leaving this page, or closing the tab can erase them, even when saving is on.';
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
    const state = {
        records: [], goal: '', keep: false, storageAvailable: true, hasStoredData: false,
        generation: undefined, clearRevision: undefined,
        changedIds: new Set(), goalChanged: false, historyNeedsRefresh: false,
        steps: program.exercises.map(() => null), index: 0, started: false,
        workoutMode: false, usedWorkout: false, sets: program.exercises.map(() => [blankSet()]), workoutControls: null, exerciseTimer: null,
        date: localDateString(), notes: '', response: 'not-checked', view: 'welcome', resumeView: 'exercise',
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
        const scrollTarget = heading.closest('.hep-session-step-header') || heading;
        scrollTarget.scrollIntoView({ block: 'start', behavior: 'instant' });
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
    shell.append(header, panel, safety, storage, status);
    root.replaceChildren(shell);

    function announce(message) { status.textContent = message; }
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
        // exercise or review, which would interrupt its timer or draft fields.
        panel.querySelector('[data-hep-previous-sets]')?.remove();
        const activeGoal = panel.querySelector('#hep-session-goal');
        if (activeGoal) activeGoal.value = '';
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
    function resetPanel() {
        state.workoutControls?.cleanup();
        state.workoutControls = null;
        state.exerciseTimer?.cleanup();
        state.exerciseTimer = null;
        panel.replaceChildren();
    }
    window.addEventListener('pagehide', stopActiveTimer);
    window.addEventListener('pageshow', event => {
        if (event.persisted) {
            try { observeProgressClear(readClearRevision()); } catch { /* Keep the active session usable. */ }
        }
        if (event.persisted && state.view === 'exercise') renderExercise(false);
    });
    function sessionMode() {
        if (!program.workoutOptions) return;
        const fieldset = element('fieldset', 'hep-session-mode');
        fieldset.append(element('legend', '', 'How would you like to follow your program?'));
        [['simple', 'Simple session', 'Mark exercises done or skip them.'], ['workout', 'Workout log', 'Record sets and resistance, or enter a custom timer.']].forEach(([value, text, help]) => {
            const label = element('label', 'hep-session-mode-choice');
            const radio = element('input');
            radio.type = 'radio'; radio.name = 'hep-session-mode'; radio.value = value;
            radio.checked = (value === 'workout') === state.workoutMode;
            radio.setAttribute('data-hep-mode', value);
            radio.addEventListener('change', () => { state.workoutMode = value === 'workout'; });
            const copy = element('span'); copy.append(element('strong', '', text), element('span', '', help));
            label.append(radio, copy); fieldset.append(label);
        });
        panel.append(fieldset);
    }
    function counts() {
        return {
            completed: state.steps.filter(step => step === 'done').length,
            skipped: state.steps.filter(step => step === 'skipped').length
        };
    }
    function startSession() {
        state.steps = program.exercises.map(() => null);
        state.sets = program.exercises.map(() => [blankSet()]);
        state.usedWorkout = state.workoutMode;
        state.index = 0;
        state.started = true;
        state.date = localDateString();
        state.notes = '';
        state.response = 'not-checked';
        renderExercise(true);
        announce('Session started. Follow the instructions for each exercise due today.');
    }
    function renderWelcome(moveFocus = false) {
        state.view = 'welcome';
        resetPanel();
        const heading = panelHeading('Your next session');
        paragraph(panel, document.getElementById('page-title')?.textContent.trim() || program.title);
        const actions = element('div', 'hep-session-actions');
        actions.append(button('Start session', startSession, 'data-hep-start'), button('Progress log', () => renderHistory(true), 'data-hep-log', false, true));
        panel.append(actions, definitionList([['How often', program.frequency], ['Equipment', program.equipment]]));
        sessionMode();
        const goals = element('details', 'hep-session-options');
        goals.append(element('summary', '', 'Program goal and checkpoint'),
            definitionList([['Program goal', program.goal], ['Checkpoint', program.checkpoint]]));
        panel.append(goals);
        if (moveFocus) focusHeading(heading);
    }
    function renderExercise(moveFocus = false) {
        state.view = 'exercise';
        resetPanel();
        const exercise = program.exercises[state.index];
        const exerciseCount = program.exercises.length;
        const { completed, skipped } = counts();
        const markedCount = completed + skipped;
        const reviewNext = state.index === exerciseCount - 1 ||
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
        const card = element('article', 'hep-session-exercise');
        card.setAttribute('data-hep-exercise', '');
        const stepHeader = element('header', 'hep-session-step-header');
        const heading = element('h3', '', exercise.name);
        heading.setAttribute('data-hep-exercise-title', '');
        heading.setAttribute('aria-describedby', position.id);
        stepHeader.append(progressGroup, heading);
        card.append(stepHeader);
        const prescription = definitionList([['How much', exercise.dose], ['How often', exercise.frequency]]);
        card.append(prescription);
        if (state.index === 0) {
            const startingCue = element('p', 'hep-first-stage');
            startingCue.append(element('strong', '', 'Where to start'), document.createTextNode(firstStage || program.programIntro));
            if (program.strengthStartIndex !== undefined) {
                // The first impact drill requires clearance. Put this choice before its running dose.
                prescription.before(startingCue, button('Go to strength exercises', () => {
                    state.index = program.strengthStartIndex;
                    renderExercise(true);
                }, 'data-hep-strength-start', true));
            } else {
                card.append(startingCue);
            }
        }
        card.append(element('h4', '', 'How to do it'), element('p', '', exercise.how));
        const presets = program.timerOptions?.[exercise.name] || [];
        if (!state.workoutMode && presets.length) state.exerciseTimer = mountExerciseTimer(card, presets);
        card.append(element('h4', '', 'Easier option'), element('p', '', exercise.easier));
        const harder = element('details', 'hep-session-detail');
        harder.append(element('summary', '', 'Harder option'), element('p', '', exercise.harder));
        const progressionLink = element('a', '', 'When to move to the next stage');
        progressionLink.href = '#progress';
        harder.append(progressionLink);
        let mode;
        if (program.workoutOptions) {
            mode = button(state.workoutMode ? 'Use simple done / skip' : 'Record sets & use a custom timer', () => {
                if (state.workoutMode && state.workoutControls && !state.workoutControls.valid()) return;
                state.workoutMode = !state.workoutMode;
                if (state.workoutMode) state.usedWorkout = true;
                renderExercise(false);
                root.querySelector('[data-hep-workout-toggle]')?.focus();
                announce(state.workoutMode ? 'Workout logging is on. Record only the work you completed.' : 'Simple view is on. Any set entries already made stay with this session.');
            }, 'data-hep-workout-toggle', false, true);
            if (state.workoutMode) {
                card.append(mode);
                const last = state.records.find(record => record.workout?.[state.index]?.sets.some(hasRecordedSetDetails));
                state.workoutControls = mountWorkout(card, program.workoutOptions[state.index], state.sets[state.index],
                    last ? { date: displayDate(last.date), entry: last.workout[state.index] } : null, announce, presets);
            }
        }
        if (state.steps[state.index]) paragraph(card, `Previously marked ${state.steps[state.index] === 'done' ? 'done' : 'skipped'}. You can change this below.`, 'hep-session-entry-meta');
        const advance = choice => {
            if (choice === 'done' && state.workoutControls && !state.workoutControls.valid()) return;
            if (choice === 'done' && state.usedWorkout && !validateWorkoutEntries([{
                status: 'done', measure: program.workoutOptions[state.index].measure,
                sets: recordedSets(state.sets[state.index], program.workoutOptions[state.index])
            }], 1, 1)) {
                state.workoutMode = true;
                renderExercise(false);
                state.workoutControls.valid();
                announce('Check the recorded set values before marking this exercise done. You can also skip the exercise without recording its sets.');
                return;
            }
            state.steps[state.index] = choice;
            if (reviewNext) {
                renderReview(true);
            } else {
                state.index += 1;
                renderExercise(true);
            }
        };
        if (state.index === 0) paragraph(card, 'Skip an exercise if it is for another day or a later stage, or if your clinician told you to leave it out.', 'hep-session-entry-meta');
        const actions = element('div', 'hep-session-actions hep-session-step-actions');
        actions.append(button(reviewNext ? 'Done & review' : 'Done & next', () => advance('done'), 'data-hep-done'),
            button(reviewNext ? 'Skip & review' : 'Skip & next', () => advance('skipped'), 'data-hep-skip', true));
        const previous = button('Previous exercise', () => {
            state.index -= 1;
            renderExercise(true);
        }, 'data-hep-back', false, true);
        previous.disabled = state.index === 0;
        actions.append(previous);
        card.append(actions, harder);
        if (mode && !state.workoutMode) card.append(mode);
        panel.append(card);
        panel.append(button('Progress log', () => renderHistory(true), 'data-hep-log', false, true));
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
    function sessionWorkout() {
        return state.steps.map((step, index) => ({
            status: step, measure: program.workoutOptions[index].measure, label: program.workoutOptions[index].label,
            sets: step === 'done' ? recordedSets(state.sets[index], program.workoutOptions[index]) : []
        }));
    }
    function validateWorkoutBeforeSave() {
        if (!state.usedWorkout) return true;
        const invalidIndex = sessionWorkout().findIndex(entry => entry.status === 'done'
            && !validateWorkoutEntries([entry], 1, 1));
        if (invalidIndex === -1) return true;
        state.index = invalidIndex;
        state.workoutMode = true;
        renderExercise(true);
        state.workoutControls.valid();
        announce(`Check the recorded set values for ${program.exercises[invalidIndex].name} before adding your entry. You can also skip this exercise without recording its sets.`);
        return false;
    }
    function renderReview(moveFocus = false) {
        state.view = 'review';
        resetPanel();
        const heading = panelHeading('Session review');
        const totals = counts();
        const summary = element('p', 'hep-session-entry-summary');
        const completed = element('span', '', `${totals.completed} done`);
        completed.setAttribute('data-hep-completed-count', '');
        const skipped = element('span', '', `${totals.skipped} skipped`);
        skipped.setAttribute('data-hep-skipped-count', '');
        summary.append(completed, document.createTextNode(' · '), skipped);
        panel.append(summary);
        const unmarked = state.steps.length - totals.completed - totals.skipped;
        const finish = button('Finish without logging', () => {
            state.started = false;
            state.view = 'finished';
            resetPanel();
            const finishedHeading = panelHeading('Session finished');
            panel.append(summary);
            if (unmarked) paragraph(panel, `${unmarked} unmarked`, 'hep-session-entry-meta');
            const checkIn = element('div', 'hep-session-check-in');
            checkIn.append(element('h4', '', 'After your session'), element('p', '', program.responseIntro));
            const symptomLink = element('a', '', 'Check your symptoms');
            symptomLink.href = '#response';
            checkIn.append(symptomLink);
            const actions = element('div', 'hep-session-actions');
            actions.append(button('Start another session', startSession, 'data-hep-start', true),
                button('Progress log', () => renderHistory(true), 'data-hep-log', false, true));
            panel.append(checkIn, actions);
            focusHeading(finishedHeading);
            announce('Session finished without a log entry.');
        }, 'data-hep-finish', state.usedWorkout || unmarked > 0);
        if (unmarked) {
            paragraph(panel, unmarked === 1 ? 'One exercise is still unmarked.' : `${unmarked} exercises are still unmarked.`);
            const actions = element('div', 'hep-session-actions');
            actions.append(button(`Mark ${unmarked} as skipped`, () => {
                state.steps = state.steps.map(step => step === null ? 'skipped' : step);
                renderReview(true);
            }, 'data-hep-skip-unmarked'), button('Return to unmarked exercises', () => {
                state.index = state.steps.indexOf(null);
                renderExercise(true);
            }, 'data-hep-return-unmarked', true), finish);
            panel.append(actions);
            if (moveFocus) focusHeading(heading);
            return;
        }
        if (state.usedWorkout) {
            paragraph(panel, 'Your recorded set details will be included in this entry. Skipped exercises have no recorded sets.');
            const preview = element('div');
            preview.setAttribute('data-hep-review-workout', '');
            appendWorkoutDetails(preview, sessionWorkout(), program.exercises);
            panel.append(preview);
        }
        const form = element('form', 'hep-session-form');
        form.setAttribute('data-hep-review', '');
        const logDetails = element('details', 'hep-session-options hep-session-log-details');
        logDetails.open = state.usedWorkout || Boolean(state.notes) || state.response !== 'not-checked';
        logDetails.append(element('summary', '', 'Date, notes and next-morning response'));
        const dateField = textField('Session date', 'hep-session-date', 'date', state.date, null, value => { state.date = value; });
        dateField.input.required = true;
        const goalField = textField('Activity goal (optional)', 'hep-session-goal', 'text', state.goal, 140, value => { state.goal = value; state.goalChanged = true; });
        goalField.input.placeholder = 'For example: walk to the park comfortably';
        const notesField = textField('Notes (optional)', 'hep-session-notes', 'textarea', state.notes, 200, value => { state.notes = value; });
        notesField.input.placeholder = 'Resistance, activity, or anything to discuss at follow-up';
        const response = responseSelect('Next-morning response', 'hep-session-response', state.response);
        response.select.addEventListener('change', () => { state.response = response.select.value; });
        logDetails.append(dateField.wrapper, goalField.wrapper, notesField.wrapper, response.wrapper);
        const actions = element('div', 'hep-session-actions hep-session-review-actions');
        const save = element('button', state.usedWorkout ? 'hep-session-button' : 'hep-session-button is-secondary', 'Add to progress log');
        save.type = 'submit';
        save.setAttribute('data-hep-save', '');
        if (state.usedWorkout) actions.append(save, finish);
        else actions.append(finish, save);
        const back = button('Previous exercise', () => {
            state.index = program.exercises.length - 1;
            renderExercise(true);
        }, 'data-hep-back', false, true);
        if (state.usedWorkout) form.append(logDetails, actions);
        else form.append(actions, logDetails);
        paragraph(form, 'To keep a log entry after leaving this page, turn on “Keep my progress on this device.”', 'hep-session-entry-meta');
        form.append(back);
        form.addEventListener('invalid', () => { logDetails.open = true; }, true);
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (!validateWorkoutBeforeSave()) return;
            const record = createSessionRecord({
                id: newRecordId(), date: state.date, ...counts(),
                response: state.response, notes: state.notes, goal: state.goal,
                createdAt: Date.now(), updatedAt: Date.now(),
                ...(state.usedWorkout ? { workout: sessionWorkout() } : {})
            }, program.exercises.length);
            if (!record) {
                announce('Check the session date and field lengths before adding your entry.');
                logDetails.open = true;
                dateField.input.focus();
                return;
            }
            state.records = [record, ...state.records].slice(0, MAX_RECORDS);
            state.changedIds.add(record.id);
            state.goalChanged = true;
            state.started = false;
            const saved = persistProgress();
            renderHistory(true);
            if (saved) announce(state.keep ? 'Session added to your progress log and saved in this browser.' : `Session added to your progress log. Device saving is off. ${UNSAVED_ENTRIES_HELP}`);
        });
        panel.append(form);
        if (moveFocus) focusHeading(heading);
    }

    function returnToSession() {
        if (!state.started) { renderWelcome(true); return; }
        if (state.resumeView === 'review' && state.steps.every(step => step !== null)) renderReview(true);
        else renderExercise(true);
    }
    function renderHistory(moveFocus = false) {
        if (state.started && state.view !== 'history') state.resumeView = state.view;
        state.view = 'history';
        resetPanel();
        const heading = panelHeading('Progress log');
        paragraph(panel, 'A record of your sessions and next-morning responses to bring to follow-up. Keep using your program’s dose, frequency, and symptom rules.');
        if (!state.started) sessionMode();
        const actions = element('div', 'hep-session-actions');
        actions.append(button(state.started ? 'Return to session' : 'Start session', state.started ? returnToSession : startSession, state.started ? 'data-hep-resume' : 'data-hep-start'));
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
            paragraph(history, 'No entries yet. Follow a session and add an optional entry when you finish.', 'hep-session-empty');
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
            if (!record.notes && !record.goal) notesCell.textContent = '—';
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
                    if (state.started) returnToSession();
                    else startSession();
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

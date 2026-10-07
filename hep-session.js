// Optional patient session tools. Clinical instructions come from the page's
// generated program data; personal entries stay in memory or opted-in storage.
export const SESSION_STORAGE_VERSION = 1;
export const MAX_RECORDS = 30;
export const NEXT_MORNING_RESPONSES = Object.freeze([
    { value: 'not-checked', label: 'Not checked yet' },
    { value: 'baseline', label: 'Back to usual baseline' },
    { value: 'more-symptomatic', label: 'Still more symptomatic' },
    { value: 'not-sure', label: 'Not sure' }
]);

const PILOT_SLUGS = new Set([
    'knee-osteoarthritis-exercises',
    'rotator-cuff-pain-exercises',
    'patellofemoral-pain-exercises'
]);
const RESPONSE_VALUES = new Set(NEXT_MORNING_RESPONSES.map(response => response.value));
const PROGRAM_FIELDS = [
    'title', 'fitIntro', 'frequency', 'equipment', 'checkpoint', 'goal',
    'responseIntro', 'green', 'yellow', 'red'
];
const EXERCISE_FIELDS = ['name', 'dose', 'frequency', 'how', 'easier', 'harder'];

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value, maximum, allowEmpty = false) {
    return typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0);
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
    if (!isObject(value) || !PILOT_SLUGS.has(value.slug)) return null;
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
    return record;
}

export function validateProgressStore(value, slug, exerciseCount) {
    if (!isObject(value) || value.version !== SESSION_STORAGE_VERSION || value.slug !== slug || !PILOT_SLUGS.has(slug)) return null;
    if (!Number.isInteger(exerciseCount) || exerciseCount < 1 || exerciseCount > 24) return null;
    if (!isText(value.goal, 140, true) || !Array.isArray(value.records)) return null;
    const records = value.records.slice(0, MAX_RECORDS).map(record => createSessionRecord(record, exerciseCount));
    if (records.some(record => record === null) || new Set(records.map(record => record.id)).size !== records.length) return null;
    const store = { version: SESSION_STORAGE_VERSION, slug, goal: value.goal, records };
    if (value.generation !== undefined) {
        if (!isText(value.generation, 100) || !/^[a-zA-Z0-9_-]+$/.test(value.generation)) return null;
        store.generation = value.generation;
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
    const state = {
        records: [], goal: '', keep: false, storageAvailable: true, hasStoredData: false, generation: undefined,
        changedIds: new Set(), goalChanged: false, historyNeedsRefresh: false,
        steps: program.exercises.map(() => null), index: 0, started: false,
        date: localDateString(), notes: '', response: 'not-checked', view: 'welcome',
        printout: null, printTimer: null, printing: false
    };

    // Read only this program's key to restore a previous explicit opt-in. No
    // storage enumeration or writing happens during initial page loading.
    let restorationMessage = '';
    try {
        const stored = window.localStorage.getItem(key);
        if (stored !== null) {
            state.hasStoredData = true;
            let restored = null;
            if (stored.length <= 200000) {
                try { restored = validateProgressStore(JSON.parse(stored), program.slug, program.exercises.length); } catch { /* Ignore malformed local data. */ }
            }
            if (restored) {
                state.records = restored.records;
                state.goal = restored.goal;
                state.keep = true;
                state.generation = restored.generation;
            } else {
                restorationMessage = 'Saved progress could not be read. New entries stay in this open tab unless you choose to save them.';
            }
        }
    } catch {
        state.storageAvailable = false;
        restorationMessage = 'Browser storage is unavailable. You can still use the session and keep entries in this open tab.';
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
        heading.scrollIntoView({ block: 'start', behavior: 'instant' });
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
    paragraph(header, 'YOUR PROGRAM, STEP BY STEP', 'hep-session-eyebrow');
    const title = element('h2', '', 'Guided session & progress log');
    title.id = 'hep-session-title';
    header.append(title);
    paragraph(header, 'Follow the exercises at your own pace. Record a session if it helps you prepare for follow-up.', 'hep-session-intro');
    root.setAttribute('aria-labelledby', title.id);
    const panel = element('div', 'hep-session-panel');

    const safety = element('details', 'hep-session-safety');
    safety.append(element('summary', '', 'Before you start: program fit & symptom rules'));
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
    storageCheckbox.setAttribute('aria-describedby', storageHelp.id);
    storage.append(storageLabel, storageHelp);
    paragraph(storage, 'Your entries are optional and stay in this browser. Anyone using this browser may see saved entries. Clearing browser data can erase them. Printing or saving a summary does not send it to your doctor.');
    const privacyLink = element('a', '', 'Privacy and device storage');
    privacyLink.href = '../privacy/#exercise-progress';
    storage.append(privacyLink);
    const status = element('p', 'hep-session-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.setAttribute('data-hep-status', '');
    const responseIntro = element('p', 'hep-session-response-intro', program.responseIntro);
    shell.append(header, panel, responseIntro, safety, storage, status);
    root.replaceChildren(shell);

    function announce(message) { status.textContent = message; }
    function updateClearButton() {
        const clear = root.querySelector('[data-hep-clear]');
        if (clear) clear.disabled = state.records.length === 0 && !state.keep && !state.hasStoredData;
    }
    function updateStorageHelp() {
        if (!state.storageAvailable) {
            storageHelp.textContent = 'Browser storage is unavailable. Entries last only while this tab stays open.';
        } else if (state.keep) {
            storageHelp.textContent = 'Saving is on for this program in this browser. Up to 30 entries are kept.';
        } else {
            storageHelp.textContent = 'Saving is off. Entries last only while this tab stays open.';
        }
    }
    function decodeStoredProgress(raw) {
        if (typeof raw !== 'string' || raw.length > 200000) return null;
        try { return validateProgressStore(JSON.parse(raw), program.slug, program.exercises.length); } catch { return null; }
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
    function persistProgress({ explicitOptIn = false } = {}) {
        if (!state.keep) return true;
        try {
            const raw = window.localStorage.getItem(key);
            const stored = decodeStoredProgress(raw);
            // A missing or replaced consent must never be recreated by a stale
            // session save or response edit. Only a fresh checkbox opt-in can
            // start saving again after removal in another tab.
            if (!explicitOptIn && (raw === null || !stored || stored.generation !== state.generation)) {
                turnSavingOff('Device saving changed in another tab. Saving is now off here; your current entries remain in this open tab.', raw !== null);
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
            const serialized = JSON.stringify(nextStore);
            if (serialized !== raw) window.localStorage.setItem(key, serialized);
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
            announce('Progress could not be saved on this device. Your entries remain in this open tab. Previously saved entries may still exist in this browser.');
            return false;
        }
    }
    storageCheckbox.addEventListener('change', () => {
        if (storageCheckbox.checked) {
            state.keep = true;
            if (persistProgress({ explicitOptIn: true })) announce('Saving is on for this program in this browser.');
        } else {
            state.keep = false;
            try {
                window.localStorage.removeItem(key);
                state.hasStoredData = false;
                state.generation = undefined;
                announce('Saved progress was removed from this browser. Your current entries remain in this tab and will not be retained when it closes.');
            } catch {
                announce('Saving is off, but this browser could not remove previously saved progress. Your current entries remain in this tab.');
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
    window.addEventListener('storage', event => {
        if ((event.key !== key && event.key !== null) || !state.keep) return;
        if (event.newValue === null) {
            // If a stale write raced with deletion, discard that old consent
            // generation too. A fresh opt-in has a different generation.
            try {
                const current = decodeStoredProgress(window.localStorage.getItem(key));
                if (current && current.generation === state.generation) window.localStorage.removeItem(key);
            } catch { /* Keep the memory log usable when storage is blocked. */ }
            turnSavingOff('Saved progress was removed in another tab. Saving is now off here; your current entries remain in this open tab.');
            return;
        }
        const stored = decodeStoredProgress(event.newValue);
        if (!stored || stored.generation !== state.generation) {
            turnSavingOff('Device saving changed in another tab. Saving is now off here; your current entries remain in this open tab.', true);
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
    function counts() {
        return {
            completed: state.steps.filter(step => step === 'done').length,
            skipped: state.steps.filter(step => step === 'skipped').length
        };
    }
    function startSession() {
        state.steps = program.exercises.map(() => null);
        state.index = 0;
        state.started = true;
        state.date = localDateString();
        state.notes = '';
        state.response = 'not-checked';
        renderExercise(true);
        announce('Session started. Use each exercise’s original dose and frequency, and skip work that is not due today.');
    }
    function renderWelcome(moveFocus = false) {
        state.view = 'welcome';
        panel.replaceChildren();
        const heading = panelHeading('Your next session');
        paragraph(panel, program.title);
        paragraph(panel, 'Use the dose and frequency shown for each exercise. Skip exercises that are not due for this session or that your clinician has asked you to leave out.');
        panel.append(definitionList([
            ['Program frequency', program.frequency], ['Equipment', program.equipment],
            ['Checkpoint', program.checkpoint], ['Program goal', program.goal]
        ]));
        const actions = element('div', 'hep-session-actions');
        actions.append(button('Start session', startSession, 'data-hep-start'), button('Progress log', () => renderHistory(true), 'data-hep-log', false, true));
        panel.append(actions);
        if (moveFocus) focusHeading(heading);
    }
    function renderExercise(moveFocus = false) {
        state.view = 'exercise';
        panel.replaceChildren();
        const exercise = program.exercises[state.index];
        const progressGroup = element('div', 'hep-session-progress');
        paragraph(progressGroup, `Exercise ${state.index + 1} of ${program.exercises.length}`);
        const progress = element('progress');
        progress.max = program.exercises.length;
        progress.value = counts().completed + counts().skipped;
        progress.setAttribute('aria-label', 'Exercises marked done or skipped');
        progressGroup.append(progress);
        const card = element('article', 'hep-session-exercise');
        card.setAttribute('data-hep-exercise', '');
        const heading = element('h3', '', exercise.name);
        heading.setAttribute('data-hep-exercise-title', '');
        card.append(heading, definitionList([['Dose', exercise.dose], ['Frequency', exercise.frequency]]));
        card.append(element('h4', '', 'How to do it'), element('p', '', exercise.how));
        card.append(element('h4', '', 'Easier option'), element('p', '', exercise.easier));
        const harder = element('details', 'hep-session-detail');
        harder.append(element('summary', '', 'Harder option from this program'), element('p', '', exercise.harder));
        card.append(harder);
        if (state.steps[state.index]) paragraph(card, `Previously marked ${state.steps[state.index] === 'done' ? 'done' : 'skipped'}. You can change this below.`, 'hep-session-entry-meta');
        const advance = choice => {
            state.steps[state.index] = choice;
            if (state.index < program.exercises.length - 1) {
                state.index += 1;
                renderExercise(true);
            } else {
                renderReview(true);
            }
        };
        const actions = element('div', 'hep-session-actions');
        actions.append(button('Mark done & next', () => advance('done'), 'data-hep-done'), button('Skip & next', () => advance('skipped'), 'data-hep-skip', true));
        const previous = button('Previous exercise', () => {
            state.index -= 1;
            renderExercise(true);
        }, 'data-hep-back', false, true);
        previous.disabled = state.index === 0;
        actions.append(previous);
        card.append(actions);
        panel.append(progressGroup, card);
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
    function renderReview(moveFocus = false) {
        state.view = 'review';
        panel.replaceChildren();
        const heading = panelHeading('Session review');
        const totals = counts();
        const summary = element('p', 'hep-session-entry-summary');
        const completed = element('span', '', `${totals.completed} done`);
        completed.setAttribute('data-hep-completed-count', '');
        const skipped = element('span', '', `${totals.skipped} skipped`);
        skipped.setAttribute('data-hep-skipped-count', '');
        summary.append(completed, document.createTextNode(' · '), skipped);
        panel.append(summary);
        paragraph(panel, 'Adding a log entry is optional. Check your next-morning response later in the progress log.');
        const form = element('form', 'hep-session-form');
        form.setAttribute('data-hep-review', '');
        const dateField = textField('Session date', 'hep-session-date', 'date', state.date, null, value => { state.date = value; });
        dateField.input.required = true;
        const goalField = textField('Activity goal (optional)', 'hep-session-goal', 'text', state.goal, 140, value => { state.goal = value; state.goalChanged = true; });
        goalField.input.placeholder = 'For example: walk to the park comfortably';
        const notesField = textField('Notes (optional)', 'hep-session-notes', 'textarea', state.notes, 200, value => { state.notes = value; });
        notesField.input.placeholder = 'Resistance, activity, or anything to discuss at follow-up';
        const response = responseSelect('Next-morning response', 'hep-session-response', state.response);
        response.select.addEventListener('change', () => { state.response = response.select.value; });
        form.append(dateField.wrapper, goalField.wrapper, notesField.wrapper, response.wrapper);
        const actions = element('div', 'hep-session-actions');
        const save = element('button', 'hep-session-button', 'Add to progress log');
        save.type = 'submit';
        save.setAttribute('data-hep-save', '');
        actions.append(save, button('Previous exercise', () => {
            state.index = program.exercises.length - 1;
            renderExercise(true);
        }, 'data-hep-back', false, true), button('Finish without a log entry', () => {
            state.started = false;
            renderWelcome(true);
            announce('Session finished without a log entry.');
        }, 'data-hep-finish', true));
        form.append(actions);
        form.addEventListener('submit', event => {
            event.preventDefault();
            const record = createSessionRecord({
                id: newRecordId(), date: state.date, ...counts(),
                response: state.response, notes: state.notes, goal: state.goal,
                createdAt: Date.now(), updatedAt: Date.now()
            }, program.exercises.length);
            if (!record) {
                announce('Check the session date and field lengths before adding your entry.');
                dateField.input.focus();
                return;
            }
            state.records = [record, ...state.records].slice(0, MAX_RECORDS);
            state.changedIds.add(record.id);
            state.goalChanged = true;
            state.started = false;
            const saved = persistProgress();
            renderHistory(true);
            if (saved) announce(state.keep ? 'Session added to your progress log and saved in this browser.' : 'Session added to your progress log in this open tab. Device saving is off.');
        });
        panel.append(form);
        if (moveFocus) focusHeading(heading);
    }

    function returnToSession() {
        if (!state.started) { renderWelcome(true); return; }
        if (state.steps.every(step => step !== null)) renderReview(true);
        else renderExercise(true);
    }
    function renderHistory(moveFocus = false) {
        state.view = 'history';
        panel.replaceChildren();
        const heading = panelHeading('Progress log');
        paragraph(panel, 'A record of your sessions and next-morning responses to bring to follow-up. Keep using your program’s dose, frequency, and symptom rules.');
        const actions = element('div', 'hep-session-actions');
        actions.append(button(state.started ? 'Return to session' : 'Start session', state.started ? returnToSession : startSession, state.started ? 'data-hep-resume' : 'data-hep-start'));
        const printButton = button('Print follow-up summary', printSummary, 'data-hep-print-summary', true);
        printButton.disabled = state.records.length === 0;
        actions.append(printButton);
        const clearButton = button('Clear progress', () => showClearConfirmation(clearButton), 'data-hep-clear', false, true);
        clearButton.disabled = state.records.length === 0 && !state.keep && !state.hasStoredData;
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
                const response = responseSelect(`Next-morning response for ${displayDate(record.date)}`, `hep-response-${index}`, record.response);
                response.select.setAttribute('data-hep-next-response', '');
                response.select.addEventListener('change', () => {
                    if (!RESPONSE_VALUES.has(response.select.value)) return;
                    const current = state.records.find(item => item.id === record.id);
                    if (!current) return;
                    current.response = response.select.value;
                    current.updatedAt = Date.now();
                    state.changedIds.add(current.id);
                    if (persistProgress()) announce(state.keep ? 'Next-morning response updated and saved in this browser.' : 'Next-morning response updated for this open tab.');
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
        paragraph(confirmation, 'This removes all entries and the activity goal for this program from this tab and this browser.');
        const actions = element('div', 'hep-session-actions');
        const confirm = button('Yes, clear progress', () => {
            let removed = true;
            try {
                window.localStorage.removeItem(key);
                state.hasStoredData = false;
                state.generation = undefined;
            } catch { removed = false; }
            state.records = [];
            state.goal = '';
            state.notes = '';
            state.changedIds.clear();
            state.goalChanged = false;
            state.keep = false;
            storageCheckbox.checked = false;
            updateStorageHelp();
            renderHistory(true);
            announce(removed ? 'Progress cleared for this program. Device saving is off.' : 'Progress cleared from this tab. Browser storage is unavailable, so previously saved entries could not be removed.');
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
        paragraph(report, `Prepared ${displayDate(localDateString())} · Latest ${Math.min(state.records.length, 6)} entries`, 'hep-summary-meta');
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

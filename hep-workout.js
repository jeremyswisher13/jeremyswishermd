// Optional records of actual exercise. These controls never prescribe a dose.
export const MAX_SETS = 8;
export const MAX_PROGRESS_BYTES = 3000000;
const MEASURES = new Set(['reps', 'seconds', 'minutes', 'contacts']);
const UNITS = new Set(['none', 'bodyweight', 'lb', 'kg', 'band', 'other']);
const validLabel = value => typeof value === 'string' && value.trim() === value
    && value.length > 0 && value.length <= 40 && !/[<>\r\n\u0000-\u001f]/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, maximum) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum);

export function validateWorkoutOptions(value, count) {
    if (!Number.isInteger(count) || count < 1 || count > 24) return null;
    if (!Array.isArray(value) || value.length !== count) return null;
    if (!value.every(item => object(item) && Object.keys(item).length === 3
        && MEASURES.has(item.measure) && validLabel(item.label)
        && typeof item.resistance === 'boolean')) return null;
    return value.map(({ measure, label, resistance }) => ({ measure, label, resistance }));
}

export function validateWorkoutEntries(value, count, completed) {
    if (!Number.isInteger(count) || count < 1 || count > 24
        || !Number.isInteger(completed) || completed < 0 || completed > count) return null;
    if (!Array.isArray(value) || value.length !== count) return null;
    const result = [];
    for (const entry of value) {
        if (!object(entry) || !['done', 'skipped'].includes(entry.status) || !MEASURES.has(entry.measure)
            || (entry.label !== undefined && !validLabel(entry.label))
            || !Array.isArray(entry.sets) || entry.sets.length > MAX_SETS
            || (entry.status === 'skipped' && entry.sets.length)) return null;
        const sets = [];
        for (const set of entry.sets) {
            if (!object(set) || !number(set.amount, 10000) || !number(set.holdSeconds, 3600)
                || !number(set.load, 1000) || !UNITS.has(set.unit)
                || typeof set.resistance !== 'string' || set.resistance.length > 60
                || typeof set.note !== 'string' || set.note.length > 80
                || (!['lb', 'kg'].includes(set.unit) && set.load !== null)
                || (!['band', 'other'].includes(set.unit) && set.resistance !== '')
                || (set.holdSeconds !== null && !Number.isInteger(set.holdSeconds))
                || (entry.measure !== 'reps' && set.holdSeconds !== null)) return null;
            sets.push({ amount: set.amount, holdSeconds: set.holdSeconds, load: set.load,
                unit: set.unit, resistance: set.resistance, note: set.note });
        }
        const validated = { status: entry.status, measure: entry.measure, sets };
        if (entry.label !== undefined) validated.label = entry.label;
        result.push(validated);
    }
    if (result.filter(entry => entry.status === 'done').length !== completed) return null;
    return result;
}

export function blankSet() {
    return { amount: '', holdSeconds: '', load: '', unit: 'none', resistance: '', note: '' };
}

export function recordedSets(drafts, option) {
    return drafts.map(set => ({
        amount: set.amount === '' ? null : Number(set.amount),
        holdSeconds: option.measure === 'reps' && set.holdSeconds !== '' ? Number(set.holdSeconds) : null,
        load: option.resistance && ['lb', 'kg'].includes(set.unit) && set.load !== '' ? Number(set.load) : null,
        unit: option.resistance ? set.unit : 'none',
        resistance: option.resistance && ['band', 'other'].includes(set.unit) ? set.resistance : '',
        note: set.note
    })).filter(set => set.amount !== null || set.holdSeconds !== null || set.load !== null
        || set.unit !== 'none' || set.resistance || set.note);
}

export function describeSet(set, measure, label) {
    const parts = [];
    if (set.amount !== null) parts.push(label ? `${label}: ${set.amount}` : `${set.amount} ${measure}`);
    if (set.holdSeconds !== null) parts.push(set.amount === null
        ? `Timed variation: ${set.holdSeconds} seconds` : `${set.holdSeconds}-second holds`);
    if (['lb', 'kg'].includes(set.unit)) parts.push(set.load === null ? `${set.unit} (weight not entered)` : `${set.load} ${set.unit}`);
    if (set.unit === 'bodyweight') parts.push('body weight');
    if (set.unit === 'band') parts.push(set.resistance ? `Band: ${set.resistance}` : 'Band (not described)');
    if (set.unit === 'other') parts.push(set.resistance ? `Resistance: ${set.resistance}` : 'Other resistance (not described)');
    if (set.note) parts.push(set.note);
    return parts.join(' · ');
}

export function remainingSeconds(deadline, now) {
    return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function timerText(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const node = (tag, className = '', text = '') => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
};

export function appendWorkoutDetails(parent, workout, exercises, expanded = false) {
    const wrapper = node(expanded ? 'section' : 'details', 'hep-workout-record');
    wrapper.append(node(expanded ? 'h3' : 'summary', '', 'Recorded exercise details'));
    workout.forEach((entry, index) => {
        const section = node('section', 'hep-workout-record-exercise');
        section.append(node('h4', '', exercises[index].name));
        if (entry.status === 'skipped') section.append(node('p', '', 'Skipped'));
        else if (!entry.sets.length) section.append(node('p', '', 'Done · No set details recorded'));
        else {
            const list = node('ol');
            entry.sets.forEach(set => list.append(node('li', '', describeSet(set, entry.measure, entry.label))));
            section.append(list);
        }
        wrapper.append(section);
    });
    parent.append(wrapper);
}

// Recreating an exercise card cancels its timer. Draft sets belong to the
// session, so back/forward navigation can retain entries without a live timer.
export function mountWorkout(parent, option, drafts, previous, announce) {
    const workout = node('section', 'hep-workout');
    workout.setAttribute('data-hep-workout', '');
    workout.append(node('h4', '', 'Your sets'), node('p', 'hep-workout-help', 'Record what you completed. All fields are optional; use the dose and frequency above. For different sides or exercise variants, add a note.'));
    if (previous) {
        const reference = node('div', 'hep-workout-previous');
        reference.setAttribute('data-hep-previous-sets', '');
        reference.append(node('h5', '', `Last recorded · ${previous.date}`));
        const list = node('ol');
        previous.entry.sets.forEach(set => list.append(node('li', '', describeSet(set, previous.entry.measure, previous.entry.label))));
        reference.append(list, node('p', '', 'A reference for your records. Follow the program’s progression criteria before changing the exercise or resistance.'));
        workout.append(reference);
    }
    const rows = node('div', 'hep-workout-sets');
    workout.append(rows);
    const makeButton = (label, action, data, quiet = false) => {
        const button = node('button', `hep-session-button${quiet ? ' is-quiet' : ' is-secondary'}`, label);
        button.type = 'button';
        if (data) button.setAttribute(data, '');
        button.addEventListener('click', action);
        return button;
    };
    const add = makeButton('Add set', () => {
        if (drafts.length >= MAX_SETS) return;
        drafts.push(blankSet());
        renderRows();
        rows.lastElementChild.querySelector('input').focus();
        announce(`Set ${drafts.length} added. Record only sets you completed.`);
    }, 'data-hep-add-set');
    workout.append(add);
    function renderRows() {
        rows.replaceChildren();
        drafts.forEach((set, index) => {
            const row = node('fieldset', 'hep-workout-set');
            row.setAttribute('data-hep-set', '');
            row.append(node('legend', '', `Set ${index + 1}`));
            const grid = node('div', 'hep-workout-grid');
            const field = (label, key, maximum, type = 'number') => {
                const wrapper = node('div', 'hep-session-field');
                const labelNode = node('label', '', label);
                const input = node('input');
                input.id = `hep-set-${index}-${key}`;
                input.type = type;
                input.value = set[key];
                input.setAttribute(`data-hep-set-${key}`, '');
                labelNode.htmlFor = input.id;
                if (type === 'number') {
                    input.min = '0'; input.max = String(maximum); input.step = key === 'holdSeconds' ? '1' : 'any';
                    input.inputMode = 'decimal';
                } else input.maxLength = maximum;
                input.addEventListener('input', () => { set[key] = input.value; });
                wrapper.append(labelNode, input);
                return { wrapper, input };
            };
            grid.append(field(option.label, 'amount', 10000).wrapper);
            if (option.resistance) {
                const unitWrapper = node('div', 'hep-session-field');
                const label = node('label', '', 'Resistance');
                const select = node('select');
                select.id = `hep-set-${index}-unit`;
                label.htmlFor = select.id;
                select.setAttribute('data-hep-set-unit', '');
                [['none', 'Not recorded'], ['bodyweight', 'Body weight'], ['lb', 'Weight in lb'], ['kg', 'Weight in kg'], ['band', 'Band'], ['other', 'Other resistance']].forEach(([value, text]) => {
                    const choice = node('option', '', text); choice.value = value; select.append(choice);
                });
                select.value = set.unit;
                unitWrapper.append(label, select);
                grid.append(unitWrapper);
                const load = field('Weight', 'load', 1000);
                const description = field('Band / resistance description', 'resistance', 60, 'text');
                description.input.placeholder = 'For example: light blue band';
                const updateUnits = () => {
                    load.wrapper.hidden = !['lb', 'kg'].includes(set.unit);
                    load.input.disabled = load.wrapper.hidden;
                    load.wrapper.querySelector('label').textContent = `Weight (${set.unit === 'kg' ? 'kg' : 'lb'})`;
                    description.wrapper.hidden = !['band', 'other'].includes(set.unit);
                    description.input.disabled = description.wrapper.hidden;
                };
                select.addEventListener('change', () => { set.unit = select.value; updateUnits(); });
                grid.append(load.wrapper, description.wrapper);
                updateUnits();
            }
            row.append(grid);
            const extra = node('details', 'hep-workout-extra');
            extra.append(node('summary', '', option.measure === 'reps' ? 'Hold / timed variation / side' : 'Side / variation'));
            if (option.measure === 'reps') {
                extra.append(field('Hold / timed variation (seconds, optional)', 'holdSeconds', 3600).wrapper);
                extra.append(node('p', 'hep-workout-help', 'For repeated reps, enter the hold time per rep. For a timed hold or carry from your program, leave the rep count blank, enter seconds, and name the variation below.'));
            }
            extra.append(field('Side or variation (optional)', 'note', 80, 'text').wrapper);
            row.append(extra);
            if (drafts.length > 1) row.append(makeButton(`Remove set ${index + 1}`, () => {
                drafts.splice(index, 1); renderRows(); add.focus(); announce('Set removed.');
            }, 'data-hep-remove-set', true));
            rows.append(row);
        });
        add.disabled = drafts.length >= MAX_SETS;
    }
    renderRows();

    const timer = node('section', 'hep-workout-timer');
    timer.setAttribute('data-hep-timer', '');
    timer.append(node('h4', '', 'Hold or rest timer'), node('p', 'hep-workout-help', 'Choose the duration you need. For holds, follow the time in your program. A rest time you enter is your choice, not a prescribed rest interval.'));
    const form = node('form', 'hep-workout-timer-form');
    const kindLabel = node('label', '', 'Timer');
    const kind = node('select'); kind.id = 'hep-timer-kind'; kindLabel.htmlFor = kind.id;
    [['rest', 'Rest'], ['hold', 'Hold']].forEach(([value, text]) => { const choice = node('option', '', text); choice.value = value; kind.append(choice); });
    const durationLabel = node('label', '', 'Seconds');
    const duration = node('input'); duration.id = 'hep-timer-duration'; durationLabel.htmlFor = duration.id;
    duration.type = 'number'; duration.min = '1'; duration.max = '3600'; duration.step = '1'; duration.required = true; duration.inputMode = 'numeric';
    duration.setAttribute('data-hep-timer-duration', '');
    const kindField = node('div', 'hep-session-field'); kindField.append(kindLabel, kind);
    const durationField = node('div', 'hep-session-field'); durationField.append(durationLabel, duration);
    const start = node('button', 'hep-session-button is-secondary', 'Start timer'); start.type = 'submit'; start.setAttribute('data-hep-timer-start', '');
    form.append(kindField, durationField, start);
    const output = node('p', 'hep-workout-clock', '00:00'); output.setAttribute('role', 'timer'); output.setAttribute('aria-live', 'off'); output.setAttribute('aria-label', 'Time remaining'); output.setAttribute('data-hep-timer-clock', '');
    let interval = null, deadline = 0, paused = 0, running = false;
    const clear = () => { if (interval !== null) window.clearInterval(interval); interval = null; };
    const controls = node('div', 'hep-session-actions');
    const pause = makeButton('Pause', () => {
        if (running) { paused = remainingSeconds(deadline, Date.now()); running = false; clear(); pause.textContent = 'Resume'; announce('Timer paused.'); }
        else if (paused > 0) { deadline = Date.now() + paused * 1000; running = true; pause.textContent = 'Pause'; interval = window.setInterval(tick, 250); announce('Timer resumed.'); }
    }, 'data-hep-timer-pause');
    const extend = makeButton('Add 15 seconds', () => {
        if (running) deadline = Math.max(deadline, Date.now()) + 15000;
        else paused += 15;
        tick(); announce('15 seconds added to the timer.');
    }, 'data-hep-timer-extend', true);
    const cancel = makeButton('Cancel timer', () => { clear(); running = false; paused = 0; tick(); announce('Timer cancelled.'); }, 'data-hep-timer-cancel', true);
    controls.append(pause, extend, cancel);
    function tick() {
        const seconds = running ? remainingSeconds(deadline, Date.now()) : paused;
        output.textContent = timerText(seconds);
        if (running && seconds === 0) { clear(); running = false; paused = 0; announce('Timer finished. Continue when ready. No exercise was marked done.'); }
        pause.disabled = seconds === 0;
        extend.disabled = seconds === 0;
        cancel.disabled = seconds === 0;
        start.disabled = seconds > 0;
        kind.disabled = seconds > 0;
        duration.disabled = seconds > 0;
    }
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        deadline = Date.now() + Number(duration.value) * 1000;
        paused = 0; running = true; pause.textContent = 'Pause'; clear();
        interval = window.setInterval(tick, 250); tick();
        announce(`${kind.value === 'hold' ? 'Hold' : 'Rest'} timer started. You can pause or cancel it.`);
    });
    tick();
    timer.append(form, output, controls);
    workout.append(timer);
    parent.append(workout);
    const onVisible = () => { if (!document.hidden && running) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return { valid: () => {
        for (const input of rows.querySelectorAll('input')) {
            if (input.checkValidity()) continue;
            const details = input.closest('details');
            if (details) details.open = true;
            input.reportValidity();
            return false;
        }
        return true;
    },
        cleanup: () => { clear(); running = false; paused = 0; tick(); document.removeEventListener('visibilitychange', onVisible); } };
}

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

export function hasRecordedSetDetails(set) {
    return set.amount !== null || set.holdSeconds !== null || set.load !== null
        || set.unit !== 'none' || Boolean(set.resistance || set.note);
}

export function recordedSets(drafts, option) {
    return drafts.map(set => ({
        amount: set.amount === '' ? null : Number(set.amount),
        holdSeconds: option.measure === 'reps' && set.holdSeconds !== '' ? Number(set.holdSeconds) : null,
        load: option.resistance && ['lb', 'kg'].includes(set.unit) && set.load !== '' ? Number(set.load) : null,
        unit: option.resistance ? set.unit : 'none',
        resistance: option.resistance && ['band', 'other'].includes(set.unit) ? set.resistance : '',
        note: set.note
    })).filter(hasRecordedSetDetails);
}

export function describeSet(set, measure, label) {
    const parts = [];
    if (set.amount !== null) parts.push(label ? `${label}: ${set.amount}` : `${set.amount} ${measure}`);
    if (set.holdSeconds !== null) parts.push(set.amount === null
        ? `Timed variation: ${set.holdSeconds} ${set.holdSeconds === 1 ? 'second' : 'seconds'}` : `${set.holdSeconds}-second holds`);
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
        const sets = entry.sets.filter(hasRecordedSetDetails);
        if (entry.status === 'skipped') section.append(node('p', '', 'Skipped'));
        else if (!sets.length) section.append(node('p', '', 'Done · No set details recorded'));
        else {
            const list = node('ol');
            sets.forEach(set => list.append(node('li', '', describeSet(set, entry.measure, entry.label))));
            section.append(list);
        }
        wrapper.append(section);
    });
    parent.append(wrapper);
}

function makeButton(label, action, data, quiet = false) {
    const button = node('button', `hep-session-button${quiet ? ' is-quiet' : ' is-secondary'}`, label);
    button.type = 'button';
    if (data) button.setAttribute(data, '');
    button.addEventListener('click', action);
    return button;
}

// A single page may show a written card and its guided counterpart. Starting
// another countdown releases the previous one, including a paused countdown.
let activeTimerStop = null;
export function stopActiveTimer() { activeTimerStop?.(); }

// Starts only the durations already written in the exercise dose.
export function mountExerciseTimer(parent, presets, announce) {
    const timer = node('section', 'hep-workout-timer');
    timer.setAttribute('data-hep-timer', '');
    timer.append(node('h4', '', 'Optional timer'));
    const starts = [];
    const choices = node('div', 'hep-timer-choices');
    for (const { label, seconds } of presets) {
        const button = makeButton(label, () => begin(seconds, label, button), 'data-hep-timer-preset');
        starts.push(button);
        choices.append(button);
    }
    timer.append(choices);
    const output = node('p', 'hep-workout-clock', '00:00');
    output.setAttribute('role', 'timer'); output.setAttribute('aria-live', 'off');
    output.setAttribute('aria-label', 'Time remaining'); output.setAttribute('data-hep-timer-clock', '');
    let interval = null, deadline = 0, paused = 0, running = false, trigger = null, phase = '';
    const clear = () => { if (interval !== null) window.clearInterval(interval); interval = null; };
    const controls = node('div', 'hep-session-actions');
    const pause = makeButton('Pause', () => {
        if (running) {
            paused = remainingSeconds(deadline, Date.now());
            // A click can arrive before a delayed interval reconciles expiry.
            if (paused === 0) { tick(); return; }
            running = false; clear(); pause.textContent = 'Resume'; tick(); report('Timer paused.');
        } else if (paused > 0) {
            deadline = Date.now() + paused * 1000; running = true; pause.textContent = 'Pause';
            interval = window.setInterval(tick, 250); tick(); report('Timer resumed.');
        }
    }, 'data-hep-timer-pause');
    const cancel = makeButton('Cancel timer', () => {
        stop(); trigger?.focus?.(); report('Timer cancelled.');
    }, 'data-hep-timer-cancel', true);
    controls.append(pause, cancel);
    const status = node('p', 'hep-timer-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-atomic', 'true');
    const report = announce || (message => { status.textContent = message; });
    function display(seconds) {
        const active = seconds > 0;
        output.textContent = timerText(seconds);
        pause.disabled = cancel.disabled = !active;
        starts.forEach(button => { button.disabled = active; });
        controls.hidden = output.hidden = !active;
    }
    function onVisible() { if (!document.hidden && running) tick(); }
    function stop() {
        clear(); running = false; paused = 0;
        if (activeTimerStop === stop) activeTimerStop = null;
        document.removeEventListener('visibilitychange', onVisible);
        display(0);
        status.textContent = '';
    }
    function tick() {
        const seconds = running ? remainingSeconds(deadline, Date.now()) : paused;
        if (running && seconds === 0) {
            const returnFocus = document.activeElement && controls.contains(document.activeElement);
            stop();
            if (returnFocus) trigger?.focus?.({ preventScroll: true });
            report(`${phase} timer finished.`);
        } else display(seconds);
    }
    function begin(seconds, label, button) {
        stopActiveTimer();
        activeTimerStop = stop;
        trigger = button; phase = label;
        deadline = Date.now() + seconds * 1000;
        paused = 0; running = true; pause.textContent = 'Pause';
        document.addEventListener('visibilitychange', onVisible);
        interval = window.setInterval(tick, 250); tick();
        pause.focus?.({ preventScroll: true });
        report(`${label} timer started. You can pause or cancel it.`);
    }
    display(0);
    timer.append(output, controls);
    if (!announce) timer.append(status);
    parent.append(timer);
    return { cleanup: stop };
}

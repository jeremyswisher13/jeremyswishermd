import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_RECORDS, createSessionRecord, mergeProgressRecords, progressStorageKey, validateProgressStore,
} from '../../hep-session.js';
import {
  MAX_SETS, blankSet, describeSet, recordedSets, remainingSeconds, timerText, validateWorkoutEntries,
} from '../../hep-workout.js';

const slug = 'knee-osteoarthritis-exercises';
const reps = { measure: 'reps', label: 'Reps per side', resistance: true };
const recordedSet = changes => ({ amount: null, holdSeconds: null, load: null, unit: 'none', resistance: '', note: '', ...changes });
const entry = changes => ({ status: 'done', measure: 'reps', label: 'Reps per side', sets: [recordedSet({ amount: 12, holdSeconds: 5, load: 4.5, unit: 'kg' })], ...changes });
const legacy = changes => ({ id: 'legacy', date: '2026-10-07', completed: 1, skipped: 1, response: 'not-checked', notes: '', goal: '', ...changes });
const workout = changes => legacy({ id: 'workout', workout: [entry(), entry({ status: 'skipped', measure: 'minutes', label: 'Minutes', sets: [] })], ...changes });

test('empty drafts do not fabricate sets, zero amounts remain recorded, and optional fields normalize without mutating drafts', () => {
  const drafts = [blankSet(), { ...blankSet(), amount: '0' }, { ...blankSet(), amount: '12', holdSeconds: '5', unit: 'kg', load: '4.5', note: 'Left side' }];
  const before = structuredClone(drafts);
  assert.deepEqual(recordedSets(drafts, reps), [
    recordedSet({ amount: 0 }),
    recordedSet({ amount: 12, holdSeconds: 5, load: 4.5, unit: 'kg', note: 'Left side' }),
  ]);
  assert.deepEqual(drafts, before);
  assert.notEqual(blankSet(), blankSet());
  assert.deepEqual(recordedSets([blankSet()], reps), []);
});

test('descriptive resistance never becomes a numeric load and inapplicable fields are removed from saved actuals', () => {
  const band = { ...blankSet(), amount: '8', unit: 'band', load: '99', resistance: 'Light blue band' };
  assert.deepEqual(recordedSets([band], reps), [recordedSet({ amount: 8, unit: 'band', resistance: 'Light blue band' })]);
  const weight = { ...band, unit: 'lb', load: '10' };
  assert.deepEqual(recordedSets([weight], reps), [recordedSet({ amount: 8, unit: 'lb', load: 10 })]);
  const walk = { ...weight, amount: '12.5', holdSeconds: '30', note: 'Outside' };
  assert.deepEqual(recordedSets([walk], { measure: 'minutes', label: 'Minutes', resistance: false }), [recordedSet({ amount: 12.5, note: 'Outside' })]);
  assert.deepEqual(recordedSets([{ ...blankSet(), unit: 'bodyweight' }], reps), [recordedSet({ unit: 'bodyweight' })]);
});

test('workout validation rejects malformed numbers, excess sets, incompatible units, fractional holds, and unbounded personal fields', () => {
  const invalidSets = [
    null, [], true,
    recordedSet({ amount: -1 }), recordedSet({ amount: 10001 }), recordedSet({ amount: '12' }),
    recordedSet({ amount: NaN }), recordedSet({ amount: Infinity }),
    recordedSet({ holdSeconds: -1 }), recordedSet({ holdSeconds: 3601 }), recordedSet({ holdSeconds: 0.5 }),
    recordedSet({ load: -1, unit: 'kg' }), recordedSet({ load: 1001, unit: 'lb' }),
    recordedSet({ load: 5, unit: 'band' }), recordedSet({ load: 5, unit: 'bodyweight' }),
    recordedSet({ unit: 'LB' }), recordedSet({ unit: 'percent' }),
    recordedSet({ resistance: 'Blue', unit: 'kg' }), recordedSet({ resistance: 'r'.repeat(61), unit: 'band' }),
    recordedSet({ note: 'n'.repeat(81) }), recordedSet({ note: null }), recordedSet({ resistance: [] }),
  ];
  for (const set of invalidSets) assert.equal(validateWorkoutEntries([entry({ sets: [set] })], 1, 1), null, JSON.stringify(set));
  for (const field of ['amount', 'holdSeconds', 'load', 'unit', 'resistance', 'note']) {
    const incomplete = recordedSet();
    delete incomplete[field];
    assert.equal(validateWorkoutEntries([entry({ sets: [incomplete] })], 1, 1), null, `missing ${field}`);
  }
  const maximum = entry({ sets: Array.from({ length: MAX_SETS }, () => recordedSet({ amount: 10000, holdSeconds: 3600, load: 1000, unit: 'lb', note: 'n'.repeat(80) })) });
  assert.equal(MAX_SETS, 8);
  assert.deepEqual(validateWorkoutEntries([maximum], 1, 1), [maximum]);
  assert.equal(validateWorkoutEntries([entry({ sets: [...maximum.sets, recordedSet()] })], 1, 1), null);
  assert.equal(validateWorkoutEntries([entry({ measure: 'seconds' })], 1, 1), null);
  assert.ok(validateWorkoutEntries([entry({ sets: [recordedSet({ unit: 'other', resistance: 'r'.repeat(60) })] })], 1, 1));
});

test('status counts require one done/skipped decision per exercise and skipped exercises reject all set details', () => {
  const valid = [entry(), entry({ status: 'skipped', sets: [] })];
  assert.deepEqual(validateWorkoutEntries(valid, 2, 1), valid);
  assert.equal(validateWorkoutEntries(valid, 2, 0), null);
  assert.equal(validateWorkoutEntries(valid, 2, 2), null);
  assert.equal(validateWorkoutEntries([entry({ status: 'skipped' })], 1, 0), null);
  assert.deepEqual(validateWorkoutEntries([entry({ sets: [] })], 1, 1), [entry({ sets: [] })]);
  for (const count of [0, -1, 1.5, '1', null, 25]) assert.equal(validateWorkoutEntries([], count, 0), null, String(count));
  for (const completed of [-1, 2, 0.5, '1', null, NaN]) assert.equal(validateWorkoutEntries([entry()], 1, completed), null, String(completed));
  for (const invalid of [null, {}, true, 'done', [], [null], [entry({ status: 'pending' })], [entry({ measure: 'weight' })]]) {
    assert.equal(validateWorkoutEntries(invalid, 1, 1), null, JSON.stringify(invalid));
  }
  assert.equal(createSessionRecord(workout({ completed: 0, skipped: 2 }), 2), null);
});

test('reviewed amount labels survive restoration and display per-side meaning while older unlabeled workout entries remain readable', () => {
  const labelled = entry();
  assert.deepEqual(validateWorkoutEntries([labelled], 1, 1), [labelled]);
  assert.equal(describeSet(labelled.sets[0], labelled.measure, labelled.label), 'Reps per side: 12 · 5-second holds · 4.5 kg');
  const oldEntry = structuredClone(labelled);
  delete oldEntry.label;
  assert.deepEqual(validateWorkoutEntries([oldEntry], 1, 1), [oldEntry]);
  assert.equal(describeSet(oldEntry.sets[0], oldEntry.measure), '12 reps · 5-second holds · 4.5 kg');
  for (const label of ['', ' ', ' Reps', 'Reps ', 'r'.repeat(41), '<img>', 'Reps\nper side', 'Reps\u0000', null, []]) {
    assert.equal(validateWorkoutEntries([entry({ label })], 1, 1), null, JSON.stringify(label));
  }
  assert.ok(validateWorkoutEntries([entry({ label: 'r'.repeat(40) })], 1, 1));
  assert.equal(describeSet(recordedSet({ unit: 'band', resistance: 'Blue band', note: '<img> plain note' }), 'reps', 'Reps'), 'Band: Blue band · <img> plain note');
});

test('validated workout records are defensive copies and retain only supported entry and set fields', () => {
  const input = workout();
  input.workout[0].ignored = 'remove';
  input.workout[0].sets[0].html = '<script>ignored</script>';
  const before = structuredClone(input);
  const record = createSessionRecord(input, 2);
  assert.ok(record);
  assert.deepEqual(input, before);
  assert.equal(Object.hasOwn(record.workout[0], 'ignored'), false);
  assert.equal(Object.hasOwn(record.workout[0].sets[0], 'html'), false);
  record.workout[0].sets[0].note = 'Changed in memory';
  record.workout[0].label = 'Changed';
  assert.deepEqual(input, before);
  const validated = validateWorkoutEntries(input.workout, 2, 1);
  validated[0].sets.push(recordedSet({ amount: 20 }));
  assert.equal(input.workout[0].sets.length, 1);
});

test('the v1 store accepts mixed legacy and workout records, rejects duplicate IDs or malformed workouts, and preserves both during edits', () => {
  const original = { version: 1, slug, goal: '', records: [workout({ createdAt: 20, updatedAt: 20 }), legacy({ createdAt: 10, updatedAt: 10 })] };
  const restored = validateProgressStore(original, slug, 2);
  assert.deepEqual(restored, original);
  assert.equal(progressStorageKey(slug), `swishermd:hep-progress:v1:${slug}`);
  assert.equal(Object.hasOwn(restored.records[1], 'workout'), false);
  const edited = structuredClone(restored.records);
  edited[0].response = 'baseline';
  edited[0].updatedAt = 30;
  edited[1].response = 'more-symptomatic';
  edited[1].updatedAt = 40;
  const before = structuredClone(original);
  const merged = mergeProgressRecords(edited, restored.records, new Set(['workout', 'legacy']));
  assert.deepEqual(merged[0].workout, original.records[0].workout);
  assert.equal(merged[0].response, 'baseline');
  assert.equal(merged[1].response, 'more-symptomatic');
  assert.equal(Object.hasOwn(merged[1], 'workout'), false);
  assert.deepEqual(original, before);
  assert.equal(validateProgressStore({ ...original, records: [workout(), workout()] }, slug, 2), null);
  assert.equal(validateProgressStore({ ...original, records: [workout({ workout: [entry()] })] }, slug, 2), null);
  assert.equal(validateProgressStore({ ...original, version: 2 }, slug, 2), null);
  restored.records[0].workout[0].sets[0].amount = 99;
  assert.equal(original.records[0].workout[0].sets[0].amount, 12);
});

test('mixed history retains only the newest thirty entries without retaining discarded sets or sharing restored set objects', () => {
  const records = Array.from({ length: MAX_RECORDS + 5 }, (_, index) => index % 2
    ? legacy({ id: `simple-${index}` }) : workout({ id: `workout-${index}` }));
  const saved = { version: 1, slug, goal: '', records };
  const before = structuredClone(saved);
  const restored = validateProgressStore(saved, slug, 2);
  assert.equal(restored.records.length, 30);
  assert.equal(restored.records[0].id, 'workout-0');
  assert.equal(restored.records.at(-1).id, 'simple-29');
  assert.ok(!restored.records.some(record => record.id === 'workout-30'));
  assert.deepEqual(saved, before);
  restored.records[0].workout[0].sets[0].load = 99;
  assert.equal(saved.records[0].workout[0].sets[0].load, 4.5);
});

test('remaining time derives from a wall-clock deadline, rounds up partial seconds, and reaches zero after delayed callbacks', () => {
  const start = 100000;
  const deadline = start + 30000;
  assert.equal(remainingSeconds(deadline, start), 30);
  assert.equal(remainingSeconds(deadline, start + 1), 30);
  assert.equal(remainingSeconds(deadline, start + 15001), 15);
  assert.equal(remainingSeconds(deadline, deadline - 1), 1);
  assert.equal(remainingSeconds(deadline, deadline), 0);
  assert.equal(remainingSeconds(deadline, deadline + 60000), 0);
  assert.equal(timerText(0), '00:00');
  assert.equal(timerText(59), '00:59');
  assert.equal(timerText(75), '01:15');
  assert.equal(timerText(3600), '60:00');
});

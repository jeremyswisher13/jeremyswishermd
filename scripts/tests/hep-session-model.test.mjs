import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GUIDED_PROGRAM_SLUGS, MAX_RECORDS, SESSION_STORAGE_VERSION, createSessionRecord, isValidSessionDate,
  localDateString, mergeProgressRecords, progressStorageKey, validateProgramData, validateProgressStore,
} from '../../hep-session.js';

const programs = JSON.parse(readFileSync(new URL('../hep-programs.json', import.meta.url), 'utf8'));
const slug = 'knee-osteoarthritis-exercises';
const program = programs.find(item => item.slug === slug);
const exerciseCount = program.exercises.length;
const validProgram = { ...program, canonical: `https://jeremyswishermd.com/${slug}/` };
const validRecord = {
  id: 'session-2026-oct-07', date: '2026-10-07', completed: 4, skipped: 1,
  response: 'not-checked', notes: '', goal: '',
};
const makeStore = (records = [validRecord]) => ({ version: SESSION_STORAGE_VERSION, slug, goal: '', records });

test('concurrent progress merges retain both additions and the newest edited response without mutating either input', () => {
  const shared = { ...validRecord, createdAt: 10, updatedAt: 10 };
  const local = [{ ...shared, response: 'baseline', updatedAt: 30 }, { ...validRecord, id: 'local', createdAt: 20, updatedAt: 20 }];
  const stored = [{ ...shared, response: 'more-symptomatic', updatedAt: 40 }, { ...validRecord, id: 'peer', createdAt: 25, updatedAt: 25 }];
  const original = JSON.stringify({ local, stored });
  const merged = mergeProgressRecords(local, stored);
  assert.deepEqual(merged.map(record => record.id), ['peer', 'local', shared.id]);
  assert.equal(merged.at(-1).response, 'more-symptomatic');
  assert.equal(JSON.stringify({ local, stored }), original);
  const edited = mergeProgressRecords(local, stored, new Set([shared.id]));
  assert.equal(edited.at(-1).response, 'baseline');
  assert.ok(edited.at(-1).updatedAt > stored[0].updatedAt);
});

test('simultaneous response edits converge and merged history retains only the newest thirty additions', () => {
  const left = [{ ...validRecord, response: 'baseline', createdAt: 10, updatedAt: 30 }];
  const right = [{ ...validRecord, response: 'more-symptomatic', createdAt: 10, updatedAt: 30 }];
  assert.deepEqual(mergeProgressRecords(left, right), mergeProgressRecords(right, left));
  const older = Array.from({ length: 30 }, (_, index) => ({ ...validRecord, id: `old-${index}`, createdAt: index + 1, updatedAt: index + 1 }));
  const newer = [{ ...validRecord, id: 'new', createdAt: 40, updatedAt: 40 }];
  const merged = mergeProgressRecords(newer, older);
  assert.equal(merged.length, MAX_RECORDS);
  assert.equal(merged[0].id, 'new');
  assert.ok(!merged.some(record => record.id === 'old-0'));
});

test('program validation preserves the published clinical prescription and rejects incomplete or unsupported programs', () => {
  const validated = validateProgramData(validProgram);
  assert.deepEqual(validated.exercises, program.exercises);
  for (const field of ['fitIntro', 'programIntro', 'frequency', 'equipment', 'checkpoint', 'goal', 'responseIntro', 'green', 'yellow', 'red']) {
    assert.equal(validated[field], program[field]);
  }
  assert.equal(validateProgramData({ ...validProgram, slug: 'unsupported-exercise-program' }), null);
  assert.equal(validateProgramData({ ...validProgram, exercises: [{ ...program.exercises[0], dose: '' }] }), null);
  assert.equal(validateProgramData({ ...validProgram, exercises: [] }), null);
  assert.equal(validateProgramData({ ...validProgram, frequency: null }), null);
});

test('all 25 maintained programs preserve their prescriptions and use isolated valid progress stores', () => {
  assert.equal(programs.length, 25);
  assert.deepEqual(new Set(GUIDED_PROGRAM_SLUGS), new Set(programs.map(item => item.slug)));
  const keys = new Set();
  for (const maintained of programs) {
    assert.equal(maintained.guidedSession, true, maintained.slug);
    const validated = validateProgramData({ ...maintained, canonical: `https://jeremyswishermd.com/${maintained.slug}/` });
    assert.ok(validated, maintained.slug);
    assert.deepEqual(validated.exercises, maintained.exercises);
    const store = { version: SESSION_STORAGE_VERSION, slug: maintained.slug, goal: '', records: [] };
    assert.deepEqual(validateProgressStore(store, maintained.slug, maintained.exercises.length), store);
    assert.equal(validateProgressStore(store, 'unsupported-exercise-program', maintained.exercises.length), null);
    keys.add(progressStorageKey(maintained.slug));
  }
  assert.equal(keys.size, 25);
});

test('program data rejects unsafe canonical URLs and malformed exercise instructions', () => {
  for (const canonical of [
    'javascript:alert(1)', 'data:text/html,hello', 'http://jeremyswishermd.com/',
    'https://name:secret@jeremyswishermd.com/', 'https://jeremyswishermd.com/?private=note',
    'https://jeremyswishermd.com/#private-note', 'not a URL',
  ]) assert.equal(validateProgramData({ ...validProgram, canonical }), null, canonical);
  for (const value of [null, [], 'unsafe', { ...program.exercises[0], easier: { html: 'value' } }]) {
    assert.equal(validateProgramData({ ...validProgram, exercises: [value] }), null);
  }
});

test('session dates reject impossible dates and local defaults retain the calendar date near midnight', () => {
  for (const value of ['2024-02-29', '2026-10-07', '2026-12-31']) assert.equal(isValidSessionDate(value), true, value);
  for (const value of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-07', '2026-10-00', '2026-1-7', '10/07/2026', '2026-10-07T00:00:00Z', null]) {
    assert.equal(isValidSessionDate(value), false, String(value));
  }
  assert.equal(localDateString(new Date(2026, 9, 7, 23, 59, 59)), '2026-10-07');
  assert.equal(localDateString(new Date(2026, 9, 8, 0, 0, 1)), '2026-10-08');
  assert.equal(localDateString(new Date('invalid')), '');
});

test('records require one done or skipped decision per exercise with nonnegative whole counts', () => {
  assert.deepEqual(createSessionRecord(validRecord, exerciseCount), validRecord);
  assert.ok(createSessionRecord({ ...validRecord, completed: 0, skipped: exerciseCount }, exerciseCount));
  assert.ok(createSessionRecord({ ...validRecord, completed: exerciseCount, skipped: 0 }, exerciseCount));
  for (const changes of [
    { completed: 0, skipped: 0 }, { completed: exerciseCount, skipped: 1 },
    { completed: -1, skipped: exerciseCount + 1 }, { completed: 1.5, skipped: 3.5 },
    { completed: '4' }, { skipped: null }, { date: '2026-02-31' }, { id: '<img>' },
  ]) assert.equal(createSessionRecord({ ...validRecord, ...changes }, exerciseCount), null, JSON.stringify(changes));
  for (const count of [0, -1, 1.5, 25]) assert.equal(createSessionRecord(validRecord, count), null);
});

test('record response and text validation accepts plain notes and enforces bounded personal fields', () => {
  const note = '<img src=x onerror="alert(1)"> remains plain text';
  assert.equal(createSessionRecord({ ...validRecord, notes: note }, exerciseCount).notes, note);
  assert.ok(createSessionRecord({ ...validRecord, notes: 'n'.repeat(200), goal: 'g'.repeat(140) }, exerciseCount));
  for (const response of ['not-checked', 'baseline', 'more-symptomatic', 'not-sure']) {
    assert.equal(createSessionRecord({ ...validRecord, response }, exerciseCount).response, response);
  }
  for (const changes of [
    { response: 'clearance-to-progress' }, { notes: 'n'.repeat(201) },
    { goal: 'g'.repeat(141) }, { notes: null }, { goal: [] },
  ]) assert.equal(createSessionRecord({ ...validRecord, ...changes }, exerciseCount), null);
});

test('progress restoration is scoped to its program and rejects incompatible or duplicate records', () => {
  assert.equal(progressStorageKey(slug), `swishermd:hep-progress:v1:${slug}`);
  assert.notEqual(progressStorageKey(slug), progressStorageKey('rotator-cuff-pain-exercises'));
  assert.deepEqual(validateProgressStore(makeStore(), slug, exerciseCount), makeStore());
  for (const changes of [
    { version: 0 }, { version: 999 }, { slug: 'rotator-cuff-pain-exercises' },
    { records: {} }, { goal: 'g'.repeat(141) }, { records: [validRecord, validRecord] },
    { records: [{ ...validRecord, completed: 100 }] },
  ]) assert.equal(validateProgressStore({ ...makeStore(), ...changes }, slug, exerciseCount), null, JSON.stringify(changes));
  for (const raw of [null, [], true, 'not-json']) assert.equal(validateProgressStore(raw, slug, exerciseCount), null);
});

test('restoration retains the newest thirty entries without mutating the saved input', () => {
  const records = Array.from({ length: MAX_RECORDS + 5 }, (_, index) => ({ ...validRecord, id: `session-${index}`, notes: `Entry ${index}` }));
  const stored = makeStore(records);
  const original = structuredClone(stored);
  const validated = validateProgressStore(stored, slug, exerciseCount);
  assert.equal(validated.records.length, 30);
  assert.equal(validated.records[0].id, 'session-0');
  assert.equal(validated.records.at(-1).id, 'session-29');
  assert.deepEqual(stored, original);
  validated.records[0].notes = 'Changed in memory';
  assert.equal(stored.records[0].notes, 'Entry 0');
});

test('restored records and programs retain only supported fields', () => {
  const record = createSessionRecord({ ...validRecord, html: '<script>bad()</script>', destination: 'https://example.com' }, exerciseCount);
  assert.deepEqual(record, validRecord);
  const restored = validateProgressStore({ ...makeStore(), unrelated: 'other program data' }, slug, exerciseCount);
  assert.deepEqual(restored, makeStore());
  const validated = validateProgramData({ ...validProgram, unexpected: 'untrusted', exercises: program.exercises.map(exercise => ({ ...exercise, html: '<script>bad()</script>' })) });
  assert.equal(Object.hasOwn(validated, 'unexpected'), false);
  assert.deepEqual(validated.exercises, program.exercises);
});

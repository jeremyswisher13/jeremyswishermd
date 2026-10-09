import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateWorkoutOptions } from '../../hep-workout.js';

const programs = JSON.parse(readFileSync(new URL('../hep-programs.json', import.meta.url), 'utf8'));
const optionsBySlug = JSON.parse(readFileSync(new URL('../hep-workout-options.json', import.meta.url), 'utf8'));
const optionFields = ['label', 'measure', 'resistance'];
const clinicalFields = ['dose', 'easier', 'frequency', 'harder', 'how', 'name'];
const measures = new Set(['reps', 'seconds', 'minutes', 'contacts']);
const firstProgram = programs[0];
const firstOptions = optionsBySlug[firstProgram.slug];

test('the manually maintained logging sidecar covers all 25 programs and 134 exercises in source order', () => {
  assert.equal(programs.length, 25);
  assert.deepEqual(Object.keys(optionsBySlug).sort(), programs.map(program => program.slug).sort());
  let exerciseCount = 0;
  for (const program of programs) {
    const options = optionsBySlug[program.slug];
    assert.equal(options.length, program.exercises.length, program.slug);
    assert.deepEqual(validateWorkoutOptions(options, program.exercises.length), options, program.slug);
    exerciseCount += options.length;
    for (const [index, option] of options.entries()) {
      const context = `${program.slug}: ${program.exercises[index].name}`;
      assert.deepEqual(Object.keys(option).sort(), optionFields, context);
      assert.ok(measures.has(option.measure), context);
      assert.equal(typeof option.resistance, 'boolean', context);
      assert.equal(typeof option.label, 'string', context);
      assert.equal(option.label, option.label.trim(), context);
      assert.ok(option.label.length > 0 && option.label.length <= 40, context);
      assert.ok(!/[<>\r\n\u0000-\u001f]/.test(option.label), context);
    }
  }
  assert.equal(exerciseCount, 134);
});

test('optional logging metadata does not modify or extend the maintained clinical prescriptions', () => {
  for (const program of programs) {
    for (const exercise of program.exercises) {
      assert.deepEqual(Object.keys(exercise).sort(), clinicalFields, `${program.slug}: ${exercise.name}`);
    }
  }
  // Changing the logging UI must not silently rewrite an existing dose, cue, or progression.
  const prescriptions = JSON.stringify(programs.map(program => ({ slug: program.slug, exercises: program.exercises })));
  assert.equal(createHash('sha256').update(prescriptions).digest('hex'),
    '4bfa05bfc871dbd6e716d77df8d6c3d7a0b4f159f6610d387500074d918cf02a');
});

test('logging option validation enforces coverage, literal units, exact fields, and bounded labels', () => {
  const cloneOptions = () => structuredClone(firstOptions);
  for (const value of [null, {}, true, 'reps', [], firstOptions.slice(1), [...firstOptions, firstOptions[0]]]) {
    assert.equal(validateWorkoutOptions(value, firstProgram.exercises.length), null, JSON.stringify(value));
  }
  for (const change of [
    { measure: 'weight' }, { measure: 'Seconds' }, { measure: '' },
    { label: '' }, { label: ' ' }, { label: 'n'.repeat(41) }, { label: null },
    { label: '<img src=x>' }, { label: 'Reps\nper side' }, { label: ' Reps' },
    { resistance: 'true' }, { resistance: 1 }, { resistance: null },
    { defaultReps: 10 }, { restSeconds: 60 }, { prescribedSets: 3 },
  ]) {
    const malformed = cloneOptions();
    malformed[0] = { ...malformed[0], ...change };
    assert.equal(validateWorkoutOptions(malformed, firstProgram.exercises.length), null, JSON.stringify(change));
  }
  for (const field of optionFields) {
    const malformed = cloneOptions();
    delete malformed[0][field];
    assert.equal(validateWorkoutOptions(malformed, firstProgram.exercises.length), null, `missing ${field}`);
  }
  const boundary = cloneOptions();
  boundary[0].label = 'n'.repeat(40);
  assert.ok(validateWorkoutOptions(boundary, firstProgram.exercises.length));
  for (const count of [0, -1, 1.5, '5', null]) {
    assert.equal(validateWorkoutOptions(firstOptions, count), null, String(count));
  }
  const original = structuredClone(firstOptions);
  const validated = validateWorkoutOptions(firstOptions, firstProgram.exercises.length);
  assert.deepEqual(firstOptions, original);
  validated[0].label = 'Changed in memory';
  assert.deepEqual(firstOptions, original);
});

test('mixed prescriptions keep a reviewed primary unit and avoid loading fields on stretches or sport drills', () => {
  const find = (slug, name) => {
    const program = programs.find(item => item.slug === slug);
    const index = program.exercises.findIndex(exercise => exercise.name === name);
    assert.ok(index >= 0, name);
    return optionsBySlug[slug][index];
  };
  for (const slug of ['lateral-elbow-tendinopathy-exercises', 'medial-elbow-tendinopathy-exercises']) {
    assert.deepEqual(find(slug, 'Controlled grip'), { measure: 'reps', label: 'Squeezes', resistance: true });
  }
  assert.equal(find('hamstring-strain-exercises', 'Heel-dig isometric').measure, 'reps');
  assert.equal(find('low-back-pain-exercises', 'Hip hinge and carry progression').measure, 'reps');
  assert.equal(find('iliotibial-band-syndrome-exercises', 'Supported split squat').measure, 'reps');
  assert.equal(find('plantar-fasciitis-exercises', 'Seated plantar-fascia stretch').measure, 'reps');
  assert.equal(find('patellofemoral-pain-return-to-running-exercises', 'Landing, pogo, and deceleration progression').measure, 'contacts');
  assert.deepEqual(find('achilles-tendinopathy-return-to-sport-exercises', 'Basketball return-to-court exposure'),
    { measure: 'minutes', label: 'Court minutes', resistance: false });
  for (const program of programs) {
    for (const [index, exercise] of program.exercises.entries()) {
      if (/stretch|web-space opening|single-leg balance|pogo|hop and|hop readiness|plyometric|running|run progression|run-walk|court exposure|deceleration|sport-specific jump/i.test(exercise.name)) {
        assert.equal(optionsBySlug[program.slug][index].resistance, false, `${program.slug}: ${exercise.name}`);
      }
    }
  }
});

test('generated guided payloads keep options separate and reorder options with their matching exercises', () => {
  for (const program of programs) {
    const html = readFileSync(new URL(`../../${program.slug}/index.html`, import.meta.url), 'utf8');
    const rawPayload = html.match(/<script type="application\/json" id="hep-session-data">([^<]*)<\/script>/)?.[1];
    assert.ok(rawPayload, `${program.slug}: safe guided payload`);
    const payload = JSON.parse(rawPayload);
    const order = program.guidedExerciseOrder || program.exercises.map((_, index) => index);
    assert.deepEqual(payload.exercises, order.map(index => program.exercises[index]), program.slug);
    assert.deepEqual(payload.workoutOptions, order.map(index => optionsBySlug[program.slug][index]), program.slug);
    for (const exercise of payload.exercises) {
      assert.deepEqual(Object.keys(exercise).sort(), clinicalFields, `${program.slug}: ${exercise.name}`);
    }
  }
  const advanced = programs.find(program => program.slug === 'advanced-meniscus-rehabilitation-exercises');
  assert.deepEqual(advanced.guidedExerciseOrder, [3, 4, 5, 0, 1, 2]);
  assert.deepEqual(optionsBySlug[advanced.slug].map(option => option.measure),
    ['reps', 'reps', 'reps', 'minutes', 'contacts', 'reps']);
});

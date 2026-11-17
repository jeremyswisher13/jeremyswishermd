import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const start = source.indexOf('// Exercise-search helpers shared with the static validators.');
const end = source.indexOf('// End exercise-search helpers.', start);

if (start < 0 || end <= start) {
    throw new Error('Could not locate the exercise-search helpers in script.js');
}

export const { createProgramSearchEntry, getProgramSearchTokens, programSearchEntryMatches } = runInNewContext(
    source.slice(start, end) + '\n({ createProgramSearchEntry, getProgramSearchTokens, programSearchEntryMatches })',
    {},
    { filename: 'script.js', lineOffset: source.slice(0, start).split('\n').length - 1 }
);

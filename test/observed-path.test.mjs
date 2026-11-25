import assert from 'node:assert/strict';
import test from 'node:test';
import { fresh } from '../lib/archive.mjs';
import { changedPathWitness } from '../lib/kane.mjs';

test('a positive wrong-path check requires an identifiable bookmark and a different visible path', () => {
  const actual = {
    ...fresh(),
    folders: [
      { id: 'a', name: 'First', parent: null },
      { id: 'b', name: 'Second', parent: null },
      { id: 'c', name: 'Documents', parent: 'b' }
    ],
    bookmarks: [
      { id: 'doc', title: 'Record', url: 'https://example.test/record', folder: 'c', tags: [] }
    ]
  };
  const other = structuredClone(actual);
  other.folders[2].parent = 'a';
  const witness = changedPathWitness(actual, other, 'doc');
  assert.deepEqual(witness.expectedPath, ['Second', 'Documents']);
  assert.deepEqual(witness.actualPath, ['First', 'Documents']);
  assert.match(witness.objective, /"First \/ Documents"/);
  assert.match(witness.objective, /Parent relationship reads "Known"/);
  assert.equal(changedPathWitness(actual, actual, 'doc'), null);
  other.bookmarks.push({ ...other.bookmarks[0], id: 'other' });
  assert.equal(changedPathWitness(actual, other, 'doc'), null);
  assert.equal(changedPathWitness(other, actual, 'doc'), null);
});

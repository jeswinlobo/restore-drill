import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { replayDecisions } from '../evidence/decisions/replay.mjs';
import { assessRecovery } from '../lib/recovery-decision.mjs';
import { restoreVerifiedArchive } from '../lib/linkwarden.mjs';

const load = (name) => readFile(new URL('../evidence/' + name, import.meta.url), 'utf8');
const reference = await load('negative-control/holdout-workspace.json');
const archive = (name) => load('decisions/' + name + '.json');

test('recorded backup decisions reproduce against the live target report and Kane holdouts', async () => {
  const { cases } = await replayDecisions();
  assert.deepEqual(
    cases.map((c) => [c.decision, c.recordedWrites]),
    [
      ['needs-evidence', 0],
      ['blocked', 0],
      ['ready', 4]
    ]
  );
  for (const c of cases) {
    assert.deepEqual(c.folders, [3, 3]);
    assert.deepEqual(c.bookmarks, [1, 1]);
  }
});

test('a missing parent and a plausible wrong parent both stop before opening the target', async () => {
  for (const [file, decision] of [
    ['unknown', 'needs-evidence'],
    ['wrong', 'blocked']
  ]) {
    const result = await restoreVerifiedArchive(
      () => assert.fail('target contacted'),
      reference,
      await archive(file)
    );
    assert.equal(result.outcome, 'withheld');
    assert.equal(result.decision, decision);
    assert.equal(result.comparison.changedPaths.length, 1);
  }
});

test('assessment binds the exact UTF-8 input, including BOM and whitespace', async () => {
  const text = await archive('recoverable');
  const withBom = '\uFEFF' + text + '\n';
  assert.equal(assessRecovery(reference, withBom).decision, 'ready');
  assert.equal(
    assessRecovery(reference, withBom).archiveHash,
    createHash('sha256').update(withBom).digest('hex')
  );
  assert.notEqual(
    assessRecovery(reference, text).archiveHash,
    assessRecovery(reference, withBom).archiveHash
  );
});

test('an unresolved reference cannot authorize its own archive', async () => {
  const invalid = await archive('unknown');
  await assert.rejects(
    restoreVerifiedArchive(() => assert.fail('target contacted'), invalid, invalid),
    /source has unknown/
  );
});

test('a target that acknowledges writes but drops folder relationships fails recapture', async () => {
  const folders = [],
    bookmarks = [],
    journal = [];
  async function request(path, options) {
    if (options?.method === 'POST') {
      const row = JSON.parse(options.body);
      const id = 500 + folders.length + bookmarks.length;
      if (path === 'collections') folders.push({ ...row, id, parentId: null });
      else bookmarks.push({ ...row, id, collectionId: row.collection.id });
      return { response: { id } };
    }
    return { response: path === 'collections' ? folders : path === 'links' ? bookmarks : [] };
  }
  const result = await restoreVerifiedArchive(
    request,
    reference,
    await archive('recoverable'),
    (entry) => journal.push(entry)
  );
  assert.equal(result.decision, 'ready');
  assert.equal(journal.length, 4);
  assert.equal(result.outcome, 'target-mismatch');
  assert.equal(result.restored.status, 'different');
});

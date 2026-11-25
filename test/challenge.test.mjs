import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { challengeCases, evaluateController } from '../lib/challenge.mjs';

test('the recorded-workspace false pass is rejected on the independent library', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'restore-drill-control-test-'));
  try {
    const cases = await challengeCases(17);
    const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
    const fixed = await evaluateController(
      await read('../evidence/kane/repair-1-candidate.ts'),
      cases,
      scratch
    );
    const wrong = await evaluateController(
      await read('../integrations/controls/first-root-fallback.ts'),
      cases,
      scratch
    );
    assert.equal(fixed.accepted, true);
    assert.equal(wrong.accepted, false);
    const [original, holdout] = wrong.outcomes;
    assert.equal(original.status, 'matched');
    assert.equal(holdout.status, 'different');
    assert.deepEqual(holdout.folders, [3, 3]);
    assert.deepEqual(holdout.bookmarks, [1, 1]);
    assert.equal(holdout.changedPaths.length, 1);
    assert.deepEqual(holdout.changedPaths[0].source, ['Lab 197488', 'Purchases 7571b']);
    assert.deepEqual(holdout.changedPaths[0].restored, ['Studio 197488', 'Purchases 7571b']);
    const twins = wrong.outcomes.find((outcome) => outcome.name === 'Identically named branches');
    assert.deepEqual(twins.changedPaths, []);
    assert.deepEqual(twins.differenceKinds, ['folder subtree']);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
});

test('a seed reproduces the generated libraries while independent seeds change them', async () => {
  const [first, replay, fresh] = await Promise.all([
    challengeCases(0),
    challengeCases(0),
    challengeCases(4294967295)
  ]);
  assert.deepEqual(first, replay);
  assert.deepEqual(first.slice(0, 2), fresh.slice(0, 2));
  for (let i = 2; i < first.length; i++) assert.notDeepEqual(first[i].source, fresh[i].source);
  await assert.rejects(challengeCases(4294967296), /32-bit/);
});

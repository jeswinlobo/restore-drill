import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fresh } from '../lib/archive.mjs';
import { loopbackOrigin, rehearsePair } from '../integrations/upstream/run-pair.mjs';

test('only local, distinct application origins can create disposable accounts', async () => {
  assert.equal(loopbackOrigin('http://127.0.0.1:8131/'), 'http://127.0.0.1:8131');
  assert.equal(loopbackOrigin('http://[::1]:8131'), 'http://[::1]:8131');
  for (const url of [
    'https://example.com',
    'file:///a',
    'http://user@localhost',
    'http://localhost/a',
    'http://localhost?api=1'
  ])
    assert.throws(() => loopbackOrigin(url));
  await assert.rejects(
    rehearsePair({ source: 'http://localhost:1', target: 'http://localhost:1/' }),
    /distinct/
  );
  await assert.rejects(
    rehearsePair({
      source: 'http://localhost:1',
      target: 'http://localhost:2',
      workspace: fresh()
    }),
    /nested/
  );
});

const saved = (name) =>
  readFile(new URL('../evidence/upstream/' + name, import.meta.url), 'utf8').then(JSON.parse);
test('saved full-app pair observed a lost folder edge with counts, bookmark and tags preserved', async () => {
  const { original, nativeMigration, portableRecovery } = await saved('pair.json');
  assert.equal(nativeMigration.comparison, 'different');
  assert.equal(portableRecovery.comparison, 'matched');
  assert.equal(nativeMigration.folders, original.folders);
  assert.deepEqual(portableRecovery.bookmarks, original.bookmarks);
  assert.equal(original.bookmarks.length, nativeMigration.bookmarks.length);
  const before = original.bookmarks[0],
    after = nativeMigration.bookmarks[0];
  assert.deepEqual({ ...after, path: before.path }, before);
  assert.deepEqual(after.path, before.path.slice(-1));
  assert.ok(before.path.length > after.path.length);
});

test('real database export used the exact recorded Kane repair', async () => {
  const report = await saved('candidate.json');
  const candidate = await readFile(
    new URL('../evidence/kane/repair-1-candidate.ts', import.meta.url)
  );
  assert.equal(createHash('sha256').update(candidate).digest('hex'), report.candidateSha256);
  assert.equal(report.candidateArchive.comparison, 'matched');
  assert.equal(report.stockImporterWithCandidateArchive.comparison, 'different');
  assert.equal(report.mappedRestoreWithCandidateArchive.comparison, 'matched');
  assert.deepEqual(report.mappedRestoreWithCandidateArchive.bookmarks, report.original.bookmarks);
});

test('production run differentiates same-named folders and bookmark titles across branches', async () => {
  const report = await saved('production-branching.json');
  const before = report.original.bookmarks;
  assert.equal(report.original.folders, 6);
  assert.equal(before.length, 2);
  assert.equal(before[0].title, before[1].title);
  assert.notEqual(before[0].url, before[1].url);
  assert.equal(report.nativeMigration.comparison, 'different');
  const byUrl = (a, b) => a.url.localeCompare(b.url);
  assert.deepEqual(report.portableRecovery.bookmarks.toSorted(byUrl), before.toSorted(byUrl));
  assert.equal(report.portableRecovery.comparison, 'matched');
  assert.equal(report.portableRecovery.acknowledgedWrites, 8);
});

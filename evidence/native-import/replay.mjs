import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { compare, digest, readArchive } from '../../lib/archive.mjs';

const read = (file) => readFile(new URL(file, import.meta.url));
const json = async (file) => JSON.parse(await read(file));
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function replayNativeImport() {
  const manifest = await json('manifest.json');
  for (const [file, hash] of Object.entries(manifest.files)) {
    assert.equal(hashBytes(await read(file)), hash, file);
  }
  const scenarios = [];
  for (const name of ['first', 'holdout']) {
    const bytes = await read(name + '.json');
    const fixture = JSON.parse(bytes);
    const reference = readArchive(fixture.reference);
    const archiveHash = digest(JSON.stringify(fixture.archive));
    assert.equal(compare(reference, readArchive(fixture.archive)).status, 'matched');
    const original = await json('stock-' + name + '/report.json');
    assert.equal(original.check.status, 'inconclusive');
    assert.equal(original.fixtureHash, hashBytes(bytes));
    assert.equal(original.objective, fixture.objective);
    for (const [directory, expected] of [
      ['observed-stock-' + name, 'different'],
      ['patched-' + name, 'matched']
    ]) {
      const report = await json(directory + '/report.json');
      assert.equal(report.fixtureHash, hashBytes(bytes), directory);
      assert.equal(report.archiveHash, archiveHash, directory);
      assert.deepEqual(report.importPosts, ['migration'], directory);
      assert.equal(report.confirmed, true, directory);
      assert.equal(report.check.status, 'passed', directory);
      assert.ok(report.check.runId && report.check.accountUnchanged);
      assert.ok(report.check.rootGridMatchesExpectation);
      assert.equal(
        hashBytes(await read(directory + '/' + report.check.gridScreenshot)),
        report.check.gridScreenshotSha256
      );
      const actual = readArchive(report.observedArchive);
      const comparison = compare(reference, actual);
      assert.deepEqual(comparison, report.comparison);
      assert.equal(comparison.status, expected);
      const sourceIds = new Set(reference.folders.map(({ id }) => id));
      assert.ok(actual.folders.every(({ id }) => !sourceIds.has(id)));
      if (expected === 'different') {
        assert.ok(actual.folders.every(({ parent }) => parent === null));
        assert.ok(comparison.changedPaths.some(({ url }) => url === fixture.witness.url));
      } else {
        assert.equal(report.objective, fixture.objective);
      }
    }
    scenarios.push({ name, folders: reference.folders.length, bookmarks: reference.bookmarks.length });
  }
  const { cases } = await json('control.json');
  const erased = cases.find(({ file }) => file === 'unknown.json');
  assert.equal(erased.archiveHash, hashBytes(await read('../decisions/unknown.json')));
  assert.equal(erased.decision, 'needs-evidence');
  assert.equal(erased.outcome, 'withheld');
  assert.deepEqual(
    [erased.targetRequests, erased.writes, erased.foldersAfter, erased.bookmarksAfter],
    [0, 0, 0, 0]
  );
  return { scenarios, erasedParent: { targetRequests: erased.targetRequests, writes: erased.writes } };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(await replayNativeImport(), null, 2));
}

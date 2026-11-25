import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { capture, restoreVerifiedArchive } from '../../lib/linkwarden.mjs';
import { createAccount, loopbackOrigin } from './run-pair.mjs';

// All three files came from the same library. The earlier Kane control
// records the exact fingerprint of the archive that guesses the wrong owner.
const root = new URL('../../evidence/', import.meta.url);
const load = (path) => readFile(new URL(path, root), 'utf8');
const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    out: { type: 'string' },
    'create-disposable-account': { type: 'boolean' }
  }
});
if (!values.target || !values['create-disposable-account'])
  throw Error('Supply --target LOOPBACK_ORIGIN --create-disposable-account [--out NEW_FILE]');
const origin = loopbackOrigin(values.target);
const source = await load('negative-control/holdout-workspace.json');
const account = await createAccount(origin);
const cases = [];
for (const [file, expected] of [
  ['unknown.json', 'needs-evidence'],
  ['wrong.json', 'blocked'],
  ['recoverable.json', 'ready']
]) {
  const archive = await load('decisions/' + file);
  const before = await capture(account.api);
  assert.equal(before.folders.length + before.bookmarks.length, 0);
  let requests = 0,
    writes = 0;
  const result = await restoreVerifiedArchive(
    (path, options) => {
      requests++;
      if (options?.method === 'POST') writes++;
      return account.api(path, options);
    },
    source,
    archive
  );
  assert.equal(result.decision, expected);
  const after = await capture(account.api);
  if (expected === 'ready') {
    assert.equal(result.outcome, 'verified');
    assert.equal(writes, after.folders.length + after.bookmarks.length);
  } else {
    assert.equal(requests, 0);
    assert.deepEqual(before, after);
  }
  cases.push({
    file,
    decision: result.decision,
    outcome: result.outcome,
    archiveHash: result.archiveHash,
    targetRequests: requests,
    writes,
    foldersAfter: after.folders.length,
    bookmarksAfter: after.bookmarks.length,
    observedChanges: result.comparison.changedPaths
  });
}
const text =
  JSON.stringify(
    { recorded: new Date().toISOString(), surface: 'Linkwarden v2.7.1 REST API', cases },
    null,
    2
  ) + '\n';
if (values.out) await writeFile(values.out, text, { flag: 'wx' });
console.log(text);

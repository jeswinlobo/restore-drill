import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { compare, digest, readArchive } from '../../lib/archive.mjs';
import { importToEmpty } from '../../lib/linkwarden.mjs';
import { createAccount, describe, loopbackOrigin } from './run-pair.mjs';
import { checkRole } from './verify-native.mjs';

const { values } = parseArgs({
  options: {
    fixture: { type: 'string' },
    target: { type: 'string' },
    out: { type: 'string' },
    expect: { type: 'string' },
    chrome: { type: 'string' },
    'playwright-module': { type: 'string' },
    'observe-stock': { type: 'boolean' },
    'create-disposable-account': { type: 'boolean' }
  }
});
if (
  !values.fixture ||
  !values.target ||
  !values.out ||
  !values['create-disposable-account'] ||
  !['flat', 'repaired'].includes(values.expect)
)
  throw Error(
    'Supply --fixture FILE --target LOOPBACK --expect flat|repaired --out NEW_DIRECTORY --create-disposable-account'
  );
const origin = loopbackOrigin(values.target);
const fixtureBytes = await readFile(values.fixture, 'utf8');
const fixture = JSON.parse(fixtureBytes);
const baseline = readArchive(fixture.reference);
assert.equal(compare(baseline, readArchive(fixture.archive)).status, 'matched');
const require = createRequire(import.meta.url);
const { chromium } = require(
  values['playwright-module'] ? resolve(values['playwright-module']) : 'playwright'
);
const out = resolve(values.out);
await mkdir(out);
const temp = await mkdtemp(join(tmpdir(), 'native-import-trial-'));
try {
  const account = await createAccount(origin);
  const operations = [];
  const archiveBytes = JSON.stringify(fixture.archive);
  const after = await importToEmpty(async (resource, options) => {
    if (options?.method === 'POST') operations.push(resource);
    return account.api(resource, options);
  }, archiveBytes);
  assert.deepEqual(operations, ['migration']);
  const actual = describe(after);
  const comparison = compare(baseline, after);
  const expectedFlat = values.expect === 'flat';
  if (values['observe-stock'] && !expectedFlat)
    throw Error('The stock observation applies only to a stock trial');
  const objective = values['observe-stock']
    ? 'On the native Collections page, inspect the main collection cards beside New Collection, ignoring the left sidebar. Verify there is a visible card named ' +
      JSON.stringify(fixture.witness.path.at(-1)) +
      ' in the main grid and report its name. Leave the data unchanged.'
    : fixture.objective;
  const check = await checkRole({
    role: expectedFlat ? 'legacy' : 'recovered',
    account: { origin, cookies: account.browserCookies },
    chromium,
    chrome: values.chrome,
    witness: fixture.witness,
    objective,
    out,
    temp
  });
  const record = check.runId
    ? JSON.parse(await readFile(join(temp, check.role + '-kane', 'verdict.json'), 'utf8'))
    : {};
  const archivedIds = new Set(fixture.archive.collections.map((c) => String(c.id)));
  const remapped = after.folders.every((f) => !archivedIds.has(f.id));
  const confirmed =
    remapped &&
    check.runId &&
    check.rootGridMatchesExpectation &&
    check.accountUnchanged &&
    check.status === (expectedFlat && !values['observe-stock'] ? 'failed' : 'passed') &&
    comparison.status === (expectedFlat ? 'different' : 'matched') &&
    (!expectedFlat ||
      (after.folders.every((f) => f.parent === null) &&
        comparison.changedPaths.some((p) => p.url === fixture.witness.url)));
  const report = {
    recorded: new Date().toISOString(),
    fixtureHash: digest(fixtureBytes),
    archiveHash: digest(archiveBytes),
    objective,
    kind: values['observe-stock'] ? 'positive-stock-observation' : 'frozen-objective',
    expectedPaths: describe(baseline),
    observedPaths: actual,
    observedArchive: after,
    comparison,
    remapped,
    importPosts: operations,
    observedTargetIds: after.folders.map((f) => f.id),
    check,
    browserSummary: record.summary ?? null,
    confirmed: Boolean(confirmed)
  };
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log('Native import: ' + comparison.status + '; Kane: ' + check.status);
  if (!confirmed) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
}

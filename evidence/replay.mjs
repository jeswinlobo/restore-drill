import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare, digest, readArchive } from '../lib/archive.mjs';
import { executeExporter } from '../lib/exporter.mjs';

const artifact = name => readFile(new URL('./kane/' + name, import.meta.url), 'utf8');
const record = JSON.parse(await artifact('verification.json'));
const original = record.runs.find(r => r.stage === 'original');
const repair = record.runs.findLast(r => /^repair-[12]$/.test(r.stage));
const holdout = record.runs.find(r => r.stage === 'holdout');
assert.ok(original && repair && holdout, 'A complete two-workspace rehearsal is required');

const primary = readArchive(await artifact('original-workspace.json'));
const secondary = readArchive(await artifact('holdout-workspace.json'));
const oldBytes = await artifact('original-archive.json');
assert.equal(digest(oldBytes), original.archiveHash);
assert.equal(compare(primary, readArchive(oldBytes)).status, original.comparison);
const candidate = await artifact(repair.stage + '-candidate.ts');
assert.equal(digest(candidate), repair.controllerHash);

const scratch = await mkdtemp(join(tmpdir(), 'restore-drill-replay-'));
try {
  for (const [data, expected] of [[primary, repair], [secondary, holdout]]) {
    const newBytes = await executeExporter(candidate, data, scratch);
    assert.equal(digest(newBytes), expected.archiveHash);
    assert.equal(compare(data, readArchive(newBytes)).status, 'matched');
    console.log(expected.stage + ' reproduced the recorded archive, including every checked bookmark path.');
  }
  assert.equal(record.originalArchiveReplay.archiveHash, digest(oldBytes));
  console.log('The original archive still needs review. Recorded Kane results are in evidence/kane/verification.json.');
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}

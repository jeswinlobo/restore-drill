import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, digest, readArchive } from './archive.mjs';
import { executeExporter } from './exporter.mjs';

const evidenceRoot = fileURLToPath(new URL('../evidence/', import.meta.url));
const publicFile =
  /^(verification\.json|agent-handoff\.json|(?:original|holdout)-workspace\.json|(?:original|repair-[12])-archive\.json|repair-[12]-candidate\.ts|pair\.json|production-branching\.json|native-(?:kane|repair)\.json|(?:unattended-)?candidate\.json|result\.json)$/;

export async function optionalRecord(bundle, name) {
  try {
    return JSON.parse(await evidenceFile(bundle, name));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function evidenceFile(bundle, filename) {
  if (!/^[a-z][a-z0-9-]*$/.test(bundle) || !publicFile.test(filename))
    throw Object.assign(Error('Unknown evidence file'), { status: 404 });
  return readFile(join(evidenceRoot, bundle, filename), 'utf8');
}

export async function recordedEvidence() {
  const packs = [];
  for (const dir of await readdir(evidenceRoot, { withFileTypes: true })) {
    if (!dir.isDirectory() || !/^[a-z][a-z0-9-]*$/.test(dir.name)) continue;
    try {
      const record = JSON.parse(await evidenceFile(dir.name, 'verification.json'));
      if (record.project !== 'Restore Drill' || !Array.isArray(record.runs)) continue;
      const files = (await readdir(join(evidenceRoot, dir.name))).filter((name) =>
        publicFile.test(name)
      );
      packs.push({ bundle: dir.name, files, ...record });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return packs.sort((a, b) => b.finished.localeCompare(a.finished));
}

export async function replayRecordedRepair(bundle = 'kane') {
  const artifact = (name) => evidenceFile(bundle, name);
  const record = JSON.parse(await artifact('verification.json'));
  const original = record.runs.find((r) => r.stage === 'original');
  const repair = record.runs.findLast((r) => /^repair-[12]$/.test(r.stage));
  const holdout = record.runs.find((r) => r.stage === 'holdout');
  assert.ok(
    record.status === 'verified-repair' && original && repair && holdout,
    'Choose a completed two-workspace repair'
  );
  const primary = readArchive(await artifact('original-workspace.json'));
  const secondary = readArchive(await artifact('holdout-workspace.json'));
  const oldBytes = await artifact('original-archive.json');
  assert.equal(digest(oldBytes), original.archiveHash, 'Original archive bytes differ from the record');
  const originalReplay = compare(primary, readArchive(oldBytes)).status;
  assert.equal(originalReplay, original.comparison);
  assert.equal(originalReplay, record.originalArchiveReplay.comparison);
  assert.equal(record.originalArchiveReplay.archiveHash, digest(oldBytes));
  const candidate = await artifact(repair.stage + '-candidate.ts');
  assert.equal(digest(candidate), repair.controllerHash, 'Candidate source differs from the record');
  const cases = [];
  const scratch = await mkdtemp(join(tmpdir(), 'restore-drill-replay-'));
  try {
    for (const [data, expected] of [
      [primary, repair],
      [secondary, holdout]
    ]) {
      const bytes = await executeExporter(candidate, data, scratch);
      assert.equal(
        digest(bytes),
        expected.archiveHash,
        'Generated archive differs from the recorded bytes'
      );
      const compared = compare(data, readArchive(bytes));
      assert.equal(compared.status, 'matched');
      cases.push({
        stage: expected.stage,
        status: compared.status,
        archiveHash: digest(bytes),
        folders: compared.folders,
        bookmarks: compared.bookmarks
      });
    }
    return { status: 'reproduced', bundle, checkedAt: new Date().toISOString(), originalReplay, cases };
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

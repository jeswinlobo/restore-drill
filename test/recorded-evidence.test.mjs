import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../lib/archive.mjs';
import { evidenceFile, recordedEvidence, replayRecordedRepair } from '../lib/recordings.mjs';

test('recorded repairs reproduce against independent libraries and the original bytes', async () => {
  const packs = await recordedEvidence();
  const repaired = packs.filter((p) => p.status === 'verified-repair');
  assert.ok(repaired.some((p) => p.bundle === 'unattended'));
  for (const pack of repaired) {
    const result = await replayRecordedRepair(pack.bundle);
    assert.equal(result.originalReplay, 'needs-review');
    assert.equal(result.cases.length, 2);
    assert.ok(result.cases.every((r) => r.status === 'matched'));
  }
  const negative = packs.find((p) => p.bundle === 'negative-control');
  assert.equal(negative.runs[0].recovery, 'passed');
  assert.equal(negative.runs[1].recovery, 'failed');
  await assert.rejects(replayRecordedRepair(negative.bundle), /completed two-workspace repair/);
});

test('the inference receipt identifies the same controller that ran against real Prisma', async () => {
  const provenance = JSON.parse(await evidenceFile('unattended', 'agent-handoff.json'));
  const candidate = await evidenceFile('unattended', provenance.response.sourceFile);
  const database = JSON.parse(await evidenceFile('upstream', 'unattended-candidate.json'));
  assert.equal(provenance.response.controllerSha256, digest(candidate));
  assert.equal(database.candidateSha256, digest(candidate));
  assert.equal(provenance.inferenceRequests.at(-1).result, 'accepted');
  assert.equal(typeof provenance.modelOutput.condition, 'string');
  await assert.rejects(evidenceFile('..', 'verification.json'), /Unknown evidence file/);
  await assert.rejects(evidenceFile('kane', '.local-tools.json'), /Unknown evidence file/);
});

test('the three native browser verdicts trace back to the exact unattended archive bytes', async () => {
  const native = JSON.parse(await evidenceFile('upstream', 'native-repair.json'));
  const recorded = await evidenceFile('unattended', 'verification.json');
  const archive = await evidenceFile('unattended', 'repair-1-archive.json');
  assert.equal(native.status, 'verified');
  assert.equal(native.repairEvidence.verificationSha256, digest(recorded));
  assert.equal(native.repairEvidence.candidateBytes, Buffer.byteLength(archive));
  assert.equal(native.repairEvidence.candidateArchiveSha256, digest(archive));
  assert.deepEqual(
    native.checks.map(({ role, status }) => [role, status]),
    [
      ['original', 'passed'],
      ['legacy', 'failed'],
      ['recovered', 'passed']
    ]
  );
  assert.ok(native.checks.every((c) => c.accountUnchanged));
});

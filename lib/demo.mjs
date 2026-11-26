import assert from 'node:assert/strict';
import { digest, inventory, readArchive } from './archive.mjs';
import { evidenceFile } from './recordings.mjs';

const bundle = 'unattended-fresh';
const read = (name) => evidenceFile(bundle, name);

export async function guidedDemo() {
  const [record, handoff, sourceBytes, brokenBytes, repairedBytes] = await Promise.all([
    read('verification.json').then(JSON.parse),
    read('agent-handoff.json').then(JSON.parse),
    read('original-workspace.json'),
    read('original-archive.json'),
    read('repair-1-archive.json')
  ]);
  const original = record.runs.find((run) => run.stage === 'original');
  const repaired = record.runs.find((run) => run.stage === 'repair-1');
  const holdout = record.runs.find((run) => run.stage === 'holdout');

  assert.equal(digest(brokenBytes), original.archiveHash);
  assert.equal(digest(repairedBytes), repaired.archiveHash);
  assert.equal(original.taskHash, repaired.taskHash, 'The repaired destination must use the original task');

  const sourceArchive = readArchive(sourceBytes);
  assert.equal(digest(sourceArchive), record.sourceHash);
  const source = inventory(sourceArchive);
  const broken = inventory(readArchive(brokenBytes));
  const fixed = inventory(readArchive(repairedBytes));
  const observed = (run, side) => {
    const { status, summary, serviceReason } = run.checks.find((check) => check.side === side);
    return { status, summary, serviceReason };
  };
  return {
    bundle,
    cli: record.cli,
    recorded: record.finished,
    objective: record.objective,
    model: handoff.agent.model,
    source,
    broken,
    fixed,
    checks: {
      source: observed(original, 'source'),
      broken: observed(original, 'destination'),
      fixed: observed(repaired, 'destination'),
      holdout: observed(holdout, 'destination')
    }
  };
}

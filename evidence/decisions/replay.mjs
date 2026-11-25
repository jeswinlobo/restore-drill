import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessRecovery } from '../../lib/recovery-decision.mjs';

const load = (path) => readFile(new URL(path, import.meta.url), 'utf8');

export async function replayDecisions() {
  const [reference, native, wrongControl, repaired] = await Promise.all([
    load('../negative-control/holdout-workspace.json'),
    load('native.json').then(JSON.parse),
    load('../negative-control/verification.json').then(JSON.parse),
    load('../unattended/verification.json').then(JSON.parse)
  ]);
  const holdout = (record) => record.runs.find((run) => run.stage === 'holdout').archiveHash;
  const scenarios = [
    ['unknown.json', 'Owner missing', 'needs-evidence'],
    ['wrong.json', 'Wrong owner', 'blocked', holdout(wrongControl)],
    ['recoverable.json', 'Owner preserved', 'ready', holdout(repaired)]
  ];
  const cases = [];
  for (const [file, label, expected, browserArchiveHash] of scenarios) {
    const check = assessRecovery(reference, await load(file));
    const observation = native.cases.find((row) => row.file === file);
    assert.equal(check.decision, expected);
    assert.equal(check.archiveHash, observation.archiveHash);
    assert.equal(check.decision, observation.decision);
    assert.deepEqual(check.comparison.changedPaths, observation.observedChanges);
    if (browserArchiveHash) assert.equal(check.archiveHash, browserArchiveHash);
    cases.push({
      label,
      file,
      decision: check.decision,
      reason: check.reason,
      sourceHash: check.sourceHash,
      archiveHash: check.archiveHash,
      changedPaths: check.comparison.changedPaths,
      folders: check.comparison.folders,
      bookmarks: check.comparison.bookmarks,
      recordedOutcome: observation.outcome,
      recordedWrites: observation.writes
    });
  }
  return { surface: native.surface, recorded: native.recorded, cases };
}

if (import.meta.main) console.log(JSON.stringify(await replayDecisions(), null, 2));

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compare, digest, inventory, readArchive } from '../../lib/archive.mjs';
import { bookmarkTask } from '../../lib/kane.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');

export function chooseWitness(workspace, preferredId, requiredId) {
  const view = inventory(workspace);
  const names = new Map(),
    markers = new Map();
  const marker = (b) => JSON.stringify([b.title, b.url]);
  for (const f of view.folders) names.set(f.name, (names.get(f.name) || 0) + 1);
  for (const b of view.bookmarks) markers.set(marker(b), (markers.get(marker(b)) || 0) + 1);
  const candidates = view.bookmarks.filter(
    (b) =>
      !b.unresolved &&
      b.segments.length >= 2 &&
      names.get(b.segments[0]) === 1 &&
      names.get(b.segments.at(-1)) === 1 &&
      markers.get(marker(b)) === 1
  );
  const chosen = requiredId
    ? candidates.find((b) => b.id === requiredId)
    : candidates.find((b) => b.id === preferredId) || candidates[0];
  if (!chosen)
    throw Error(
      'Choose a nested witness whose root and leaf collection names are unique and whose bookmark title and URL identify one record.'
    );
  return { title: chosen.title, url: chosen.url, tags: chosen.tags, path: chosen.segments };
}

// Archives are data only. The candidate source is hashed and never loaded into a runtime.
export async function readRepairInput(directory, witnessId) {
  const read = (name) => readFile(join(directory, name));
  const rawReceipt = await read('verification.json');
  const receipt = JSON.parse(rawReceipt);
  if (
    receipt.project !== 'Restore Drill' ||
    receipt.status !== 'verified-repair' ||
    !Array.isArray(receipt.runs) ||
    typeof receipt.objective !== 'string'
  )
    throw Error('Choose a completed Restore Drill verified-repair evidence directory.');
  const old = receipt.runs.find((r) => r.stage === 'original');
  const repair = receipt.runs.findLast((r) => /^repair-[12]$/.test(r.stage));
  const holdout = receipt.runs.find((r) => r.stage === 'holdout');
  const lossWitness = ['confirmed-parent-loss', 'confirmed-wrong-path'].includes(old?.recovery);
  if (
    !old ||
    !repair ||
    !holdout ||
    (!lossWitness && old.recovery !== 'failed') ||
    old.comparison === 'matched' ||
    ![repair, holdout].every((r) => r.comparison === 'matched' && r.recovery === 'passed') ||
    repair.controllerHash !== holdout.controllerHash ||
    old.taskHash !== repair.taskHash ||
    repair.taskHash !== sha(receipt.objective)
  )
    throw Error(
      'The repair receipt lacks the original failure, matched primary and independent holdout.'
    );
  const controls = [
    [old, 'source', 'passed'],
    [old, 'destination', lossWitness ? 'inconclusive' : 'failed'],
    [repair, 'source', 'passed'],
    [repair, 'destination', 'passed'],
    [holdout, 'source', 'passed'],
    [holdout, 'destination', 'passed']
  ];
  if (lossWitness) controls.push([old, 'parent-witness', 'passed']);
  if (
    controls.some(
      ([run, side, status]) =>
        !run.checks?.some(
          (c) =>
            c.side === side &&
            c.status === status &&
            typeof c.runId === 'string' &&
            c.runId.length > 0 &&
            /^[a-f0-9]{64}$/.test(c.eventStreamSha256)
        )
    )
  )
    throw Error('The repair receipt is missing a required browser observation.');
  const [sourceBytes, candidateBytes, controller, oldBytes] = await Promise.all([
    read('original-workspace.json'),
    read(repair.stage + '-archive.json'),
    read(repair.stage + '-candidate.ts'),
    read('original-archive.json')
  ]);
  if (
    sha(candidateBytes) !== repair.archiveHash ||
    sha(controller) !== repair.controllerHash ||
    sha(oldBytes) !== old.archiveHash ||
    old.archiveHash !== receipt.originalArchiveReplay?.archiveHash ||
    old.comparison !== receipt.originalArchiveReplay?.comparison
  )
    throw Error('The evidence files differ from the SHA-256 values in the repair receipt.');
  const payload = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(candidateBytes);
  const workspace = readArchive(sourceBytes.toString('utf8')),
    parsed = JSON.parse(payload);
  if (!Array.isArray(parsed.collections))
    throw Error('The stock importer requires a Linkwarden collections archive.');
  if (receipt.sourceHash !== undefined && digest(workspace) !== receipt.sourceHash)
    throw Error('The frozen source workspace hash differs from the repair receipt.');
  if (
    compare(workspace, readArchive(parsed)).status !== 'matched' ||
    compare(workspace, readArchive(oldBytes.toString('utf8'))).status !== old.comparison
  )
    throw Error(
      'Source workspace does not reproduce both archive comparisons in the repair receipt.'
    );
  const frozen = workspace.bookmarks.find((b) => {
    if (!receipt.objective.includes(JSON.stringify(b.url))) return false;
    try {
      return bookmarkTask(workspace, b.id) === receipt.objective;
    } catch {
      return false;
    }
  });
  if (!frozen) throw Error('The frozen source browser objective does not match a source bookmark.');
  return {
    workspace,
    payload,
    witness: chooseWitness(workspace, frozen.id, witnessId),
    receipt: {
      rehearsal: receipt.rehearsal,
      stage: repair.stage,
      verificationSha256: sha(rawReceipt),
      candidateArchiveSha256: repair.archiveHash,
      candidateBytes: candidateBytes.length,
      candidateControllerSha256: repair.controllerHash,
      sourceHash: digest(workspace),
      frozenObjectiveSha256: repair.taskHash,
      sourceHashInReceipt: receipt.sourceHash !== undefined
    }
  };
}

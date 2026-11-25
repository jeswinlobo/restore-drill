import { compare, digest, readArchive } from './archive.mjs';

// The reference is an independently captured workspace supplied by the operator.
export function assessRecovery(reference, archiveText) {
  if (typeof archiveText !== 'string') throw Error('Supply the original archive text.');
  const source = readArchive(reference);
  const candidate = readArchive(archiveText);
  const comparison = compare(source, candidate);
  const decisions = {
    matched: ['ready', 'The archive reproduces the supplied reference.'],
    'needs-review': [
      'needs-evidence',
      'Some parent references cannot be resolved. Confirm them from an independent source.'
    ],
    different: [
      'blocked',
      'The archive disagrees with the supplied reference. Inspect the differences before recovery.'
    ]
  };
  const [decision, reason] = decisions[comparison.status];
  return { decision, reason, sourceHash: digest(source), archiveHash: digest(archiveText), comparison };
}

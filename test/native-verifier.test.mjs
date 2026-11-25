import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../lib/archive.mjs';
import {
  rootObjective,
  nativeOutcome,
  missingReceiptReason
} from '../integrations/upstream/verify-native.mjs';

test('missing network or login yields a shareable diagnostic', () => {
  assert.equal(missingReceiptReason('Error 401: not logged in'), 'authentication_required');
  assert.equal(
    missingReceiptReason('Network fetch failed on a private route'),
    'service_connection_unavailable'
  );
  assert.equal(missingReceiptReason('EACCES on browser profile'), 'local_permission_denied');
  assert.equal(missingReceiptReason('Other private output'), 'missing_service_receipt');
});

test('native reproduction needs both transfer comparisons, the same objective, all three live receipts and stable accounts', () => {
  const objective = rootObjective('Studio "West"', 'Agreements');
  assert.ok(objective.includes(JSON.stringify('Studio "West"')));
  const pair = {
    nativeMigration: { comparison: 'different' },
    portableRecovery: { comparison: 'matched' }
  };
  const checks = ['original', 'legacy', 'recovered'].map((role) => ({
    role,
    status: role === 'legacy' ? 'failed' : 'passed',
    runId: 'run-0',
    taskSha256: digest(objective),
    accountUnchanged: true,
    rootGridMatchesExpectation: true,
    bookmarkVisible: 'Contract'
  }));
  assert.equal(nativeOutcome(checks, pair), 'verified');
  for (const change of [
    { status: 'inconclusive' },
    { status: 'passed' },
    { taskSha256: digest('different') },
    { accountUnchanged: false },
    { rootGridMatchesExpectation: false },
    { bookmarkVisible: null },
    { runId: null }
  ]) {
    const mutated = structuredClone(checks);
    Object.assign(mutated[1], change);
    assert.equal(nativeOutcome(mutated, pair), 'inconclusive');
  }
  assert.equal(
    nativeOutcome(checks, { ...pair, nativeMigration: { comparison: 'matched' } }),
    'inconclusive'
  );
  assert.equal(nativeOutcome(checks.slice(1), pair), 'inconclusive');
});

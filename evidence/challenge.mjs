import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { challengeCases, evaluateController } from '../lib/challenge.mjs';

const { values } = parseArgs({
  options: {
    candidate: { type: 'string' },
    seed: { type: 'string' },
    replay: { type: 'string' },
    report: { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean' }
  }
});

async function main() {
  if (values.help) {
    console.log(
      'node evidence/challenge.mjs [--candidate exporter.ts] [--seed INTEGER | --replay result.json] [--report result.json] [--json]'
    );
    return;
  }
  if (values.replay && values.seed !== undefined)
    throw Error('A replay uses the seed in the recorded report.');
  const replay = values.replay && JSON.parse(await readFile(values.replay, 'utf8'));
  // Freeze the controller bytes before drawing a new seed.
  const candidate = await readFile(
    values.candidate || new URL('./kane/repair-1-candidate.ts', import.meta.url),
    'utf8'
  );
  const control = await readFile(
    new URL('../integrations/controls/first-root-fallback.ts', import.meta.url),
    'utf8'
  );
  if (values.seed !== undefined && !/^\d+$/.test(values.seed))
    throw Error('Use an unsigned 32-bit seed.');
  const seed = replay
    ? replay.seed
    : values.seed !== undefined
      ? Number(values.seed)
      : randomBytes(4).readUInt32BE();
  const cases = await challengeCases(seed);
  const scratch = await mkdtemp(join(tmpdir(), 'restore-drill-challenge-'));
  try {
    const report = {
      format: 'restore-drill/exporter-challenge/v1',
      seed,
      engine: 'Local exporter execution, archive import and structural comparison',
      candidate: await evaluateController(candidate, cases, scratch),
      negativeControl: await evaluateController(control, cases, scratch)
    };
    const [original, independent] = report.negativeControl.outcomes;
    assert.equal(original.status, 'matched', 'The negative control must fool the original workspace.');
    assert.equal(
      independent.status,
      'different',
      'The independent workspace must reject the negative control.'
    );
    assert.ok(
      independent.changedPaths.length,
      'The negative control must move a bookmark to the wrong folder.'
    );
    if (replay) assert.deepEqual(report, replay, 'The replay differs from the recorded evidence.');
    if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', 'utf8');
    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('Seed', seed, '| Local archive comparisons');
      console.table(
        cases.map(({ name }, i) => ({
          Workspace: name,
          Candidate: report.candidate.outcomes[i].status,
          'First-root control': report.negativeControl.outcomes[i].status
        }))
      );
      const witness = independent.changedPaths[0];
      console.log(
        'Control moved "' +
          witness.title +
          '" from ' +
          witness.source.join(' / ') +
          ' to ' +
          witness.restored.join(' / ')
      );
      console.log(
        'Candidate',
        report.candidate.accepted ? 'accepted' : 'rejected',
        '(' + report.candidate.matched + '/' + report.candidate.total + ' matched)'
      );
      if (replay) console.log('All recorded controller, input and archive hashes reproduced.');
    }
    if (!report.candidate.accepted) process.exitCode = 1;
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});

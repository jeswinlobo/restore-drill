import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digest, fresh } from '../lib/archive.mjs';
import { exportRehearsal } from '../lib/export-rehearsal.mjs';
import { bookmarkTask } from '../lib/kane.mjs';
import { openStore } from '../lib/store.mjs';

const writeJson = (file, value) => writeFile(file, JSON.stringify(value));
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

test('offline export checks recorded bytes and receipts before creating a new, sanitized bundle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restore-export-check-'));
  const runId = randomUUID(),
    root = join(dir, 'rehearsals', runId);
  const store = openStore(dir);
  try {
    await mkdir(join(root, 'repair-1'), { recursive: true });
    const make = (rootName) => ({
      ...fresh(),
      folders: [
        { id: 'x', name: rootName, parent: null },
        { id: 'y', name: 'Records', parent: 'x' }
      ],
      bookmarks: [{ id: 'b', folder: 'y', title: 'Case', url: 'https://example.test/record', tags: [] }]
    });
    const first = store.create('First', make('Owner A')),
      second = store.create('Second', make('Owner B'));
    const broken = structuredClone(first.archive);
    broken.folders[1].parent = null;
    const original = 'original test controller',
      candidate = 'generated test controller';
    await writeFile(join(root, 'original.ts'), original);
    await writeFile(join(root, 'repair-1', 'candidate.ts'), candidate);
    await writeJson(join(root, 'repair-1', 'proposal.json'), {
      source: candidate,
      explanation: 'private service detail'
    });
    const contract = {
      task: bookmarkTask(first.archive, 'b'),
      revision: 1,
      sourceHash: digest(first.archive),
      holdoutRevision: 1,
      holdoutHash: digest(second.archive)
    };
    await writeJson(join(root, 'contract.json'), contract);
    async function record(stage, workspace, output, controller) {
      const drill = store.run(workspace.id, output, workspace.revision);
      const task = bookmarkTask(workspace.archive, 'b'),
        evidence = randomUUID();
      const folder = join(dir, 'evidence', drill.id, evidence);
      const destinationStatus = stage === 'original' ? 'failed' : 'passed';
      const observation = {
        id: evidence,
        created: new Date().toISOString(),
        item: 'b',
        task,
        taskHash: digest(task),
        status: destinationStatus
      };
      for (const side of ['source', 'destination']) {
        const status = side === 'source' ? 'passed' : destinationStatus;
        const code = status === 'passed' ? 0 : 1;
        const verdict = {
          code,
          status,
          summary: 'private service detail',
          link: 'https://test-manager.lambdatest.com/projects/private',
          credits: 1234
        };
        const sideDir = join(folder, side);
        await mkdir(sideDir, { recursive: true });
        await writeJson(join(sideDir, 'verdict.json'), verdict);
        await writeJson(join(sideDir, 'events.ndjson'), {
          type: 'run_end',
          status,
          run_id: 'test-protocol',
          result_code: code ? 740 : 0,
          summary: verdict.summary
        });
        observation[side] = verdict;
      }
      store.addObservation(drill.id, observation);
      return {
        stage,
        controllerHash: digest(controller),
        drill: drill.id,
        evidence,
        taskHash: digest(task),
        comparison: drill.report.status,
        archiveHash: drill.report.archiveHash,
        kane: destinationStatus,
        sourceKane: 'passed'
      };
    }
    const start = await record('original', first, broken, original);
    const fixed = await record('repair-1', first, first.archive, candidate);
    const holdout = await record('holdout', second, second.archive, candidate);
    const replay = store.run(first.id, broken, first.revision);
    const report = {
      id: runId,
      started: new Date().toISOString(),
      finished: new Date().toISOString(),
      status: 'verified-repair',
      proposalDelivery: 'reviewed agent response',
      workspaces: [first.id, second.id],
      attempts: [start, fixed],
      holdout,
      legacyReplay: {
        drill: replay.id,
        archiveHash: replay.report.archiveHash,
        status: replay.report.status
      }
    };
    const reportFile = join(root, 'report.json');
    await writeJson(reportFile, report);
    const out = join(dir, 'bundle'),
      exportTo = (target) => exportRehearsal({ dir, runId, out: target });
    const result = await exportTo(out);
    const receipt = await readJson(join(out, 'verification.json'));
    assert.equal(receipt.sourceHash, contract.sourceHash);
    assert.equal(receipt.holdoutHash, contract.holdoutHash);
    assert.equal(receipt.runs[1].controllerHash, digest(candidate));
    assert.equal(
      receipt.runs[2].archiveHash,
      digest(await readFile(join(out, 'holdout-archive.json'), 'utf8'))
    );
    for (const name of result.files)
      assert.doesNotMatch(
        await readFile(join(out, name), 'utf8'),
        /private service detail|test-manager\.lambdatest|credits/
      );
    await assert.rejects(exportTo(out), { code: 'EEXIST' });
    const invalid = join(dir, 'invalid');
    await writeJson(reportFile, { ...report, finished: null });
    await assert.rejects(exportTo(invalid), /completed/);
    await writeJson(reportFile, report);
    await writeJson(join(root, 'contract.json'), { ...contract, holdoutHash: digest('different') });
    await assert.rejects(exportTo(invalid), /fingerprint/);
    await writeJson(join(root, 'contract.json'), contract);
    await writeFile(join(root, 'repair-1', 'candidate.ts'), 'changed');
    await assert.rejects(exportTo(invalid), /Candidate controller/);
    await writeFile(join(root, 'repair-1', 'candidate.ts'), candidate);
    const sourceReceipt = join(dir, 'evidence', fixed.drill, fixed.evidence, 'source', 'events.ndjson');
    await writeFile(sourceReceipt, '');
    await assert.rejects(exportTo(invalid), /observation/);
    await assert.rejects(access(invalid), { code: 'ENOENT' });
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

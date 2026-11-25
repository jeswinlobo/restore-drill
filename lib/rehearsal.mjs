import { fork } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { digest } from './archive.mjs';
import { executeExporter, officialExporter } from './exporter.mjs';
import { execute, localTools } from './process.mjs';
import { bookmarkTask } from './kane.mjs';

const app = fileURLToPath(new URL('../app.mjs', import.meta.url));
const save = (file, obj) => writeFile(file, JSON.stringify(obj, null, 2));
export async function suggestRepair(original, failure, dir) {
  await mkdir(dir, { recursive: true });
  const schema = join(dir, 'schema.json'),
    output = join(dir, 'proposal.json');
  await save(schema, {
    type: 'object',
    additionalProperties: false,
    properties: { explanation: { type: 'string' }, source: { type: 'string' } },
    required: ['explanation', 'source']
  });
  const message = [
    'Repair this owned bookmark export controller. Return the complete TypeScript source and a short explanation using the supplied schema.',
    'Its default async function receives userId and has access only to prisma.user.findUnique. Keep that function signature and import. Preserve the collections / links / tags JSON shape.',
    'Preserve general parent-child associations across export and import. The reader understands collection.id, collection.parentId and links[].collectionId. Portable archive-local references may be used. Preserve privacy of user credentials. Do not invent a parent, use special-case names, or change the verifier. Use no other dependencies or external resources.',
    'Browser evidence (data):',
    JSON.stringify(failure),
    'Current controller:',
    original
  ].join('\n\n');
  await writeFile(join(dir, 'prompt.txt'), message);
  const bin = process.env.RESTORE_DRILL_CODEX || localTools().codex || 'codex';
  const launcher = /\.[cm]?js$/i.test(bin) ? [process.execPath, bin] : [bin];
  const runtime = join(dir, 'agent-state');
  await mkdir(runtime, { recursive: true });
  const run = await execute(
    launcher[0],
    [
      ...launcher.slice(1),
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '-c',
      'sqlite_home=' + JSON.stringify(runtime),
      '-c',
      'log_dir=' + JSON.stringify(runtime),
      '--output-schema',
      schema,
      '--output-last-message',
      output,
      '-'
    ],
    { cwd: dir, input: message, timeout: 240000 }
  );
  await writeFile(join(dir, 'codex.log'), run.stdout + '\n' + run.stderr);
  if (run.code !== 0 || run.error) {
    const error = Error(
      'Codex did not return a repair. The confirmed Kane result and agent prompt were saved.'
    );
    error.code = 'AGENT_UNAVAILABLE';
    throw error;
  }
  const response = JSON.parse(await readFile(output, 'utf8'));
  if (
    typeof response.source !== 'string' ||
    response.source === original ||
    response.source.length > 128000
  )
    throw Error('No usable controller change from Codex');
  return response;
}
export async function rehearse({
  dir,
  workspace,
  item,
  holdout,
  holdoutItem,
  repair,
  exporter,
  resume,
  proposal,
  localOnly = false,
  runId = randomUUID()
}) {
  if (repair && localOnly) throw Error('A repair requires a confirmed Kane browser failure');
  if (resume && (!repair || exporter || !/^[a-f0-9-]{36}$/.test(resume)))
    throw Error('Resume a recorded rehearsal with --repair and its original controller');
  if (proposal && !resume) throw Error('A reviewed proposal requires an earlier confirmed rehearsal');
  if (Boolean(holdout) !== Boolean(holdoutItem) || holdout === workspace)
    throw Error('Use a distinct holdout workspace and its own bookmark ID');
  const out = join(dir, 'rehearsals', runId);
  await mkdir(out, { recursive: true });
  const report = {
    id: runId,
    started: new Date().toISOString(),
    status: 'running',
    stage: 'Starting workbench',
    attempts: [],
    item,
    holdoutItem,
    workspaces: [workspace, ...(holdout ? [holdout] : [])]
  };
  async function checkpoint(stage) {
    report.stage = stage;
    await save(join(out, 'report.tmp'), report);
    await rename(join(out, 'report.tmp'), join(out, 'report.json'));
  }
  await checkpoint('Freezing source and task');
  const child = fork(app, ['--data', dir, '--port', '0'], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    windowsHide: true
  });
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Workbench startup timed out')), 20000);
      child.once('message', (m) => {
        clearTimeout(timer);
        resolve(m.base);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(Error('Workbench stopped'));
      });
    });
    async function api(path, data) {
      const response = await fetch(
        base + '/api/' + path,
        data === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(data)
            }
      );
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      return body;
    }
    const primary = await api('workspaces/' + workspace);
    const frozenTask = bookmarkTask(primary.archive, item);
    const hidden = holdout ? await api('workspaces/' + holdout) : null;
    if (hidden) bookmarkTask(hidden.archive, holdoutItem);
    const baselineDir = resume ? join(dir, 'rehearsals', resume) : null;
    let source = baselineDir
      ? await readFile(join(baselineDir, 'original.ts'), 'utf8')
      : exporter
        ? await readFile(exporter, 'utf8')
        : (await officialExporter(dir)).source;
    await writeFile(join(out, 'original.ts'), source);
    const contract = {
      task: frozenTask,
      sourceHash: digest(primary.archive),
      revision: primary.revision,
      ...(hidden ? { holdoutHash: digest(hidden.archive), holdoutRevision: hidden.revision } : {})
    };
    await save(join(out, 'contract.json'), contract);
    async function check(w, witness, raw) {
      const drill = await api('workspaces/' + w.id + '/run', { archive: raw, revision: w.revision });
      if (localOnly)
        return {
          drill: drill.id,
          comparison: drill.report.status,
          archiveHash: drill.report.archiveHash
        };
      await api('drills/' + drill.id + '/verify', { item: witness });
      const deadline = Date.now() + 665000;
      while (Date.now() < deadline) {
        const response = await api('drills/' + drill.id);
        if (!response.pending) {
          const o = response.observations[0];
          return {
            drill: drill.id,
            comparison: drill.report.status,
            archiveHash: drill.report.archiveHash,
            kane: o?.status || 'inconclusive',
            sourceKane: o?.source?.status,
            sourceSummary: o?.source?.summary,
            destination: o?.destination,
            parentWitness: o?.parentWitness,
            taskHash: o?.taskHash,
            evidence: o?.id
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      throw Error('Timed out waiting for browser observations');
    }
    const originalRaw = await executeExporter(source, primary.archive, join(out, 'executions'));
    await checkpoint(localOnly ? 'Comparing archive' : 'Verifying original controller');
    let first;
    if (baselineDir) {
      const past = JSON.parse(await readFile(join(baselineDir, 'report.json'), 'utf8'));
      const priorContract = JSON.parse(await readFile(join(baselineDir, 'contract.json'), 'utf8'));
      const prior = past.attempts[0];
      if (
        !past.finished ||
        JSON.stringify(report.workspaces) !== JSON.stringify(past.workspaces) ||
        digest(contract) !== digest(priorContract) ||
        prior?.controllerHash !== digest(source) ||
        prior.archiveHash !== digest(originalRaw) ||
        prior.taskHash !== digest(frozenTask)
      )
        throw Error(
          'The original controller, task, workspaces or revisions have changed. Start a new rehearsal.'
        );
      const stored = await api('drills/' + prior.drill);
      const observation = stored.observations.find((o) => o.id === prior.evidence);
      if (
        !observation ||
        observation.source?.status !== 'passed' ||
        !['failed', 'confirmed-parent-loss'].includes(observation.status) ||
        observation.status !== prior.kane ||
        stored.report.archiveHash !== prior.archiveHash ||
        stored.report.status === 'matched'
      )
        throw Error('A saved, confirmed Kane loss is required to resume');
      report.baselineRehearsal = resume;
      first = prior;
    } else {
      first = await check(primary, item, originalRaw);
    }
    report.attempts.push({ stage: 'original', controllerHash: digest(source), ...first });
    if (localOnly || (first.kane === 'passed' && first.comparison === 'matched')) {
      if (hidden) {
        await checkpoint('Checking independent workspace');
        const holdRaw = await executeExporter(source, hidden.archive, join(out, 'executions'));
        report.holdout = await check(hidden, holdoutItem, holdRaw);
      }
      report.status = localOnly
        ? 'local-comparison-only'
        : report.holdout && (report.holdout.kane !== 'passed' || report.holdout.comparison !== 'matched')
          ? 'holdout-did-not-pass'
          : 'passed-original';
      return report;
    }
    const verifiedLoss = (check) =>
      ['failed', 'confirmed-parent-loss'].includes(check.kane) &&
      check.comparison !== 'matched' &&
      check.sourceKane === 'passed';
    if (!verifiedLoss(first)) {
      report.status = 'inconclusive';
      return report;
    }
    report.status = 'confirmed-failure';
    if (!repair) return report;
    let failure = first;
    for (let attempt = 1; attempt <= (proposal ? 1 : 2); attempt++) {
      await checkpoint(
        proposal ? 'Reading reviewed coding-agent proposal' : 'Asking Codex for repair ' + attempt
      );
      const folder = join(out, 'repair-' + attempt);
      await mkdir(folder, { recursive: true });
      const candidate = proposal
        ? JSON.parse(await readFile(proposal, 'utf8'))
        : await suggestRepair(
            source,
            {
              objective: frozenTask,
              routeVerdict: failure.destination?.summary,
              missingParentObservation: failure.parentWitness?.verdict?.summary,
              comparison: failure.comparison
            },
            folder
          );
      if (
        typeof candidate.source !== 'string' ||
        candidate.source === source ||
        candidate.source.length > 128000 ||
        typeof candidate.explanation !== 'string'
      )
        throw Error('Expected changed controller source and a repair explanation');
      if (proposal) {
        report.proposalDelivery = 'reviewed agent response';
        await save(join(folder, 'proposal.json'), candidate);
      }
      source = candidate.source;
      await writeFile(join(folder, 'candidate.ts'), source);
      const raw = await executeExporter(source, primary.archive, join(out, 'executions'));
      await checkpoint('Rechecking repair ' + attempt);
      const checked = await check(primary, item, raw);
      report.attempts.push({
        stage: 'repair-' + attempt,
        controllerHash: digest(source),
        explanation: candidate.explanation,
        ...checked
      });
      if (checked.taskHash !== digest(frozenTask)) {
        report.status = 'inconclusive';
        return report;
      }
      if (checked.kane === 'passed' && checked.comparison === 'matched') {
        if (hidden) {
          await checkpoint('Verifying independent workspace');
          const hiddenRaw = await executeExporter(source, hidden.archive, join(out, 'executions'));
          const test = await check(hidden, holdoutItem, hiddenRaw);
          report.holdout = test;
          if (test.kane !== 'passed' || test.comparison !== 'matched') {
            report.status = 'holdout-did-not-pass';
            return report;
          }
        }
        // A new exporter cannot retrospectively change the archived bytes.
        const old = await api('workspaces/' + workspace + '/run', {
          archive: originalRaw,
          revision: primary.revision
        });
        report.legacyReplay = {
          drill: old.id,
          archiveHash: old.report.archiveHash,
          status: old.report.status,
          unknown: old.report.unknown
        };
        if (old.report.archiveHash !== first.archiveHash) throw Error('Archive fingerprint changed');
        report.status = 'verified-repair';
        return report;
      }
      if (!verifiedLoss(checked)) {
        report.status = 'inconclusive';
        return report;
      }
      failure = checked;
    }
    report.status = 'repair-incomplete';
    return report;
  } catch (e) {
    report.status = e.code === 'AGENT_UNAVAILABLE' ? 'awaiting-agent-repair' : 'inconclusive';
    report.error = e.message;
    return report;
  } finally {
    child.kill();
    report.finished = new Date().toISOString();
    await checkpoint('Finished');
  }
}

import { mkdir, open, readFile, rm, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { compare, digest, readArchive } from './archive.mjs';
import { bookmarkTask, classify } from './kane.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const losses = new Set(['failed', 'confirmed-parent-loss', 'confirmed-wrong-path']);
const deliveries = new Set([
  'unattended local model',
  'unattended Codex CLI',
  'reviewed agent response'
]);

function check(condition, message) {
  if (!condition) throw Error(message);
}

// Source and archive bytes must remain exact for consumers that verify fingerprints.
// Refuse recognizable credentials instead of silently modifying either artifact.
function checkShareable(name, text) {
  const sensitivePatterns = [
    /https?:\/\/[^\s"']*test-manager\.(?:lambdatest|testmuai)\.com\//i,
    /https?:\/\/[^\s/:"]+:[^\s/@"]+@/,
    /[?&](?:[^=&#\s]*token|signature|x-amz-(?:signature|credential)|api[_-]?key|password|secret)=/i,
    /\b(?:password|token|access[_-]?token|refresh[_-]?token|api[_-]?key|session[_-]?(?:token|id)|authorization|cookie|secret(?:key)?)["']?\s*[:=]\s*["'][^"']+["']/i,
    /-----BEGIN [^-]*PRIVATE KEY-----/
  ];
  check(
    !sensitivePatterns.some((pattern) => pattern.test(text)),
    'A credential or private service link may be present in ' +
      name +
      '. Use synthetic data for shareable evidence.'
  );
}

function snapshot(db, drill, hash, revision) {
  check(uuid.test(drill), 'Invalid stored drill identifier.');
  const row = db.prepare('SELECT source,payload,report FROM drills WHERE id=?').get(drill);
  check(row, 'Missing stored drill snapshot.');
  const source = readArchive(row.source),
    report = JSON.parse(row.report);
  const sourceHash = digest(source),
    archiveHash = digest(row.payload);
  check(
    sourceHash === hash && sourceHash === report.sourceHash && report.sourceRevision === revision,
    'Stored source fingerprint or revision differs from the frozen contract.'
  );
  check(archiveHash === report.archiveHash, 'Stored archive bytes differ from their drill fingerprint.');
  const restored = readArchive(row.payload);
  const status = compare(source, restored).status;
  check(
    status === report.status && digest(restored) === report.restoredHash,
    'Stored archive comparison differs from its drill result.'
  );
  return { source, payload: row.payload, status, archiveHash };
}

async function receipt(folder, side, stored, versions) {
  const root = join(folder, side);
  const raw = await readFile(join(root, 'events.ndjson'), 'utf8');
  const saved = await readJson(join(root, 'verdict.json'));
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event && typeof event === 'object') events.push(event);
    } catch {}
  }
  const end = events.findLast((event) => event.type === 'run_end');
  check(
    end && typeof end.run_id === 'string' && /^[\w:.-]{1,128}$/.test(end.run_id),
    'Missing completed Kane service observation.'
  );
  const result = classify({ stdout: raw, stderr: '', code: saved.code });
  check(
    result.status === saved.status && saved.status === stored?.status && saved.code === stored.code,
    'Browser receipt and saved verdict disagree.'
  );
  const version = events.find((event) => typeof event.cli_version === 'string')?.cli_version;
  if (version && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) versions.add(version);
  return {
    side,
    status: saved.status,
    exitCode: saved.code,
    serviceStatus: end.status,
    runId: end.run_id,
    ...(typeof end.reason_code === 'string' && /^[\w.-]{1,120}$/.test(end.reason_code)
      ? { serviceReason: end.reason_code }
      : {}),
    ...(Number.isInteger(end.result_code) ? { resultCode: end.result_code } : {}),
    eventStreamSha256: digest(raw)
  };
}

async function collect({ dir, runId }, db) {
  const root = join(dir, 'rehearsals', runId);
  const report = await readJson(join(root, 'report.json')),
    contract = await readJson(join(root, 'contract.json'));
  check(
    report.id === runId &&
      report.finished &&
      report.status === 'verified-repair' &&
      report.workspaces?.length === 2 &&
      report.workspaces[0] !== report.workspaces[1] &&
      report.holdout?.kane === 'passed' &&
      report.holdout.comparison === 'matched' &&
      report.legacyReplay &&
      report.attempts?.length >= 2 &&
      report.attempts.length <= 3,
    'Choose a completed, verified two-workspace repair.'
  );
  check(
    Number.isFinite(Date.parse(report.started)) && Number.isFinite(Date.parse(report.finished)),
    'Invalid rehearsal timestamps.'
  );
  const original = await readFile(join(root, 'original.ts'), 'utf8');
  const versions = new Set(),
    files = new Map(),
    runs = [],
    repairs = [];
  let previousHash = digest(original);
  const stages = [...report.attempts, { ...report.holdout, stage: 'holdout' }];
  for (const [index, attempt] of stages.entries()) {
    const held = index === stages.length - 1;
    const stage = held ? 'holdout' : index === 0 ? 'original' : 'repair-' + index;
    check(
      attempt.stage === stage && uuid.test(attempt.evidence),
      'Invalid recorded stage or observation.'
    );
    const finalRepair = index === stages.length - 2;
    const stagePassed = held || finalRepair;
    check(
      (stagePassed
        ? attempt.kane === 'passed' && attempt.comparison === 'matched'
        : losses.has(attempt.kane) && attempt.comparison !== 'matched') &&
        attempt.sourceKane === 'passed',
      'Unexpected browser result sequence.'
    );
    const saved = snapshot(
      db,
      attempt.drill,
      held ? contract.holdoutHash : contract.sourceHash,
      held ? contract.holdoutRevision : contract.revision
    );
    check(
      saved.archiveHash === attempt.archiveHash && saved.status === attempt.comparison,
      'Rehearsal stage differs from the stored archive.'
    );
    const row = db
      .prepare("SELECT data FROM observations WHERE drill=? AND json_extract(data,'$.id')=?")
      .get(attempt.drill, attempt.evidence);
    check(row, 'Observation is missing from the source database.');
    const observation = JSON.parse(row.data),
      folder = join(dir, 'evidence', attempt.drill, attempt.evidence);
    const selected = held ? report.holdoutItem : report.item;
    check(
      selected === undefined || selected === observation.item,
      'The recorded bookmark selection changed.'
    );
    const objective = bookmarkTask(saved.source, observation.item);
    check(held || objective === contract.task, 'The primary bookmark task changed.');
    check(digest(objective) === attempt.taskHash, 'Bookmark task fingerprint mismatch.');
    check(
      observation.id === attempt.evidence &&
        observation.task === objective &&
        observation.taskHash === attempt.taskHash &&
        observation.status === attempt.kane &&
        observation.source?.status === 'passed',
      'Browser observation disagrees with the frozen rehearsal.'
    );
    const checks = [
      await receipt(folder, 'source', observation.source, versions),
      await receipt(folder, 'destination', observation.destination, versions)
    ];
    if (observation.parentWitness)
      checks.push(await receipt(folder, 'parent-witness', observation.parentWitness.verdict, versions));
    if (attempt.kane.startsWith('confirmed-')) {
      check(
        observation.parentWitness?.verdict?.status === 'passed' &&
          observation.destination.status === 'inconclusive',
        'Required browser witness is missing.'
      );
    } else check(observation.destination.status === attempt.kane, 'Destination verdict mismatch.');
    if (!index)
      check(previousHash === attempt.controllerHash, 'Original controller fingerprint mismatch.');
    if (index && !held) {
      const candidate = await readFile(join(root, stage, 'candidate.ts'), 'utf8');
      const candidateHash = digest(candidate);
      check(
        candidateHash === attempt.controllerHash && candidateHash !== previousHash,
        'Candidate controller fingerprint mismatch.'
      );
      const proposal = await readJson(join(root, stage, 'proposal.json'));
      check(proposal.source === candidate, 'Candidate differs from its recorded proposal.');
      const repair = {
        stage,
        previousControllerSha256: previousHash,
        controllerSha256: candidateHash,
        sourceFile: stage + '-candidate.ts'
      };
      if (report.proposalDelivery === 'unattended local model') {
        const log = await readJson(join(root, stage, 'agent-run.json'));
        const accepted = log.requests.findLast((r) => r.result === 'accepted');
        check(
          log.candidateHash === candidateHash &&
            log.sourceHash === previousHash &&
            Number.isSafeInteger(accepted?.attempt) &&
            accepted.attempt > 0,
          'Unattended model receipt does not identify this candidate.'
        );
        const request = await readJson(join(root, stage, 'request-' + accepted.attempt + '.json'));
        const response = await readJson(join(root, stage, 'response-' + accepted.attempt + '.json'));
        const completion = response.choices?.[0]?.message?.content;
        check(
          digest(request) === accepted.inputHash &&
            typeof completion === 'string' &&
            digest(completion) === accepted.outputHash,
          'Unattended model request or response fingerprint mismatch.'
        );
        Object.assign(repair, {
          requestSha256: accepted.inputHash,
          responseSha256: accepted.outputHash,
          acceptedAttempt: accepted.attempt
        });
        if (typeof log.model === 'string' && /^[\w./:-]{1,128}$/.test(log.model))
          repair.model = log.model;
        if (typeof log.weightsSha256 === 'string' && /^[0-9a-f]{64}$/.test(log.weightsSha256))
          repair.weightsSha256 = log.weightsSha256;
      }
      files.set(repair.sourceFile, candidate);
      repairs.push(repair);
      previousHash = candidateHash;
    }
    if (!index || held) files.set(stage + '-workspace.json', json(saved.source));
    files.set(stage + '-archive.json', saved.payload);
    runs.push({
      stage,
      comparison: saved.status,
      recovery: attempt.kane,
      taskHash: attempt.taskHash,
      controllerHash: previousHash,
      archiveHash: saved.archiveHash,
      checks
    });
  }
  const replay = snapshot(db, report.legacyReplay.drill, contract.sourceHash, contract.revision);
  check(
    replay.payload === files.get('original-archive.json') &&
      replay.status === runs[0].comparison &&
      replay.archiveHash === report.legacyReplay.archiveHash &&
      replay.status === report.legacyReplay.status,
    'Original archive replay fingerprint or comparison mismatch.'
  );
  const delivery = deliveries.has(report.proposalDelivery)
    ? report.proposalDelivery
    : 'recorded proposal';
  const final = repairs.at(-1);
  files.set(
    'agent-handoff.json',
    json({
      delivery,
      originalControllerSha256: digest(original),
      repairs,
      response: { sourceFile: final.sourceFile, controllerSha256: final.controllerSha256 }
    })
  );
  const verification = {
    project: 'Restore Drill',
    title: 'Verified two-workspace repair',
    status: report.status,
    cli: versions.size ? 'Kane CLI ' + [...versions].join(', ') : 'Kane CLI (version not recorded)',
    rehearsal: runId,
    started: new Date(report.started).toISOString(),
    finished: new Date(report.finished).toISOString(),
    ...(uuid.test(report.baselineRehearsal) ? { baselineRehearsal: report.baselineRehearsal } : {}),
    proposalDelivery: delivery,
    sourceHash: contract.sourceHash,
    holdoutHash: contract.holdoutHash,
    objective: contract.task,
    revisions: { source: contract.revision, holdout: contract.holdoutRevision },
    runs,
    originalArchiveReplay: { archiveHash: replay.archiveHash, comparison: replay.status }
  };
  files.set('verification.json', json(verification));
  for (const [name, text] of files) checkShareable(name, text);
  return files;
}

export async function exportRehearsal({ dir, runId, out }) {
  check(
    typeof runId === 'string' && uuid.test(runId) && out,
    'Use export-rehearsal RUN_ID NEW_DIRECTORY [--data PATH].'
  );
  const db = new DatabaseSync(join(dir, 'source.sqlite'), { readOnly: true });
  let files;
  try {
    db.exec('BEGIN');
    files = await collect({ dir, runId }, db);
  } finally {
    db.close();
  }
  const target = resolve(out);
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  const written = [];
  try {
    for (const [name, text] of files) {
      const file = join(target, name);
      const handle = await open(file, 'wx');
      written.push(file);
      try {
        await handle.writeFile(text);
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    await Promise.allSettled(written.map((file) => rm(file)));
    await rmdir(target).catch(() => {});
    throw error;
  }
  return { status: 'exported', rehearsal: runId, directory: target, files: [...files.keys()] };
}

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compare, readArchive, inventory } from './lib/archive.mjs';
import { openStore } from './lib/store.mjs';
import {
  capture,
  connection,
  importToEmpty,
  restoreBookmarkArchive,
  restoreVerifiedArchive
} from './lib/linkwarden.mjs';
import { assessRecovery } from './lib/recovery-decision.mjs';
import { codexCommand, execute, kaneCommand, localTools } from './lib/process.mjs';
import { officialExporter } from './lib/exporter.mjs';
import { rehearse } from './lib/rehearsal.mjs';
import { proveAmbiguity } from './lib/ambiguity.mjs';
import { exportRehearsal } from './lib/export-rehearsal.mjs';

const args = process.argv.slice(2),
  position = [],
  options = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) {
    position.push(args[i]);
    continue;
  }
  const key = args[i].slice(2);
  if (['repair', 'local-only', 'write-to-empty-target', 'help'].includes(key)) options[key] = true;
  else {
    const v = args[++i];
    if (!v || v.startsWith('--')) throw Error('Missing value for --' + key);
    options[key] = v;
  }
}
const dir = resolve(options.data || process.env.RESTORE_DRILL_DATA || '.restore-drill');
const [command, a, b] = position;
const read = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const emit = (x) => console.log(JSON.stringify(x, null, 2));
const writeNew = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const usage = [
  'Restore Drill · Node.js 24+',
  'node app.mjs [--port 4317] [--data PATH]',
  'node cli.mjs doctor | fetch-exporter',
  'node cli.mjs inspect ARCHIVE.json',
  'node cli.mjs ambiguity KNOWN_SOURCE.json [--data PATH]',
  'node cli.mjs compare BASELINE.json CANDIDATE.json',
  'node cli.mjs assess-recovery INDEPENDENT_SOURCE.json ARCHIVE.json',
  'node cli.mjs restore-verified INDEPENDENT_SOURCE.json ARCHIVE.json --target URL --write-to-empty-target',
  'node cli.mjs workspaces | workspace ID',
  'node cli.mjs import ARCHIVE.json --name NAME',
  'node cli.mjs capture LINKWARDEN_URL OUTPUT.json [--owner-id ID]  (LINKWARDEN_SOURCE_TOKEN)',
  'node cli.mjs live --source URL --target URL --write-to-empty-target  (LINKWARDEN_SOURCE_TOKEN and LINKWARDEN_TARGET_TOKEN)',
  'node cli.mjs restore-into ARCHIVE.json --target URL --write-to-empty-target  (LINKWARDEN_TARGET_TOKEN)',
  'node cli.mjs rehearse WORKSPACE_ID --item BOOKMARK_ID [--holdout OTHER_WORKSPACE --holdout-item ID] [--repair | --local-only] [--exporter PATH]',
  'Add --repair --resume PRIOR_RUN [--proposal RESPONSE.json] to continue from recorded Kane evidence.',
  'node cli.mjs export-rehearsal RUN_ID NEW_DIRECTORY [--data PATH]',
  'Private records default to .restore-drill. Use --data PATH to select a different store.'
].join('\n');
try {
  if (!command || command === 'help' || options.help) console.log(usage);
  else if (command === 'doctor') {
    const [cmd, ...prefix] = kaneCommand();
    const version = await execute(cmd, [...prefix, '--version'], { timeout: 30000 });
    const identity =
      version.code === 0 ? await execute(cmd, [...prefix, 'whoami'], { timeout: 30000 }) : null;
    const local = localTools();
    const [codexBin, ...codexArgs] = codexCommand(local);
    const codex = await execute(codexBin, [...codexArgs, '--version'], {
      timeout: 15000
    });
    emit({
      node: process.version,
      kaneVersion: version.code === 0 ? version.stdout.trim() : null,
      kaneSignedIn: identity?.code === 0,
      codex: codex.code === 0 ? codex.stdout.trim() : null,
      repairProvider: process.env.RESTORE_DRILL_AGENT_ENDPOINT
        ? { type: 'local model endpoint', model: process.env.RESTORE_DRILL_AGENT_MODEL || null }
        : !process.env.RESTORE_DRILL_CODEX && local.localAgent
          ? { type: 'local coding model', model: local.localAgent.model }
          : { type: 'Codex CLI' },
      data: dir
    });
    if (version.code !== 0 || identity?.code !== 0) process.exitCode = 2;
  } else if (command === 'fetch-exporter') {
    console.log((await officialExporter(dir)).path);
  } else if (command === 'inspect') {
    emit(inventory(readArchive(await read(a))));
  } else if (command === 'ambiguity') {
    emit(await proveAmbiguity(readArchive(await read(a)), dir));
  } else if (command === 'assess-recovery' || command === 'restore-verified') {
    const reference = await read(a);
    const bytes = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(b));
    if (command === 'assess-recovery') {
      const result = assessRecovery(reference, bytes);
      emit(result);
      if (result.decision !== 'ready') process.exitCode = 1;
    } else {
      if (!options.target || !options['write-to-empty-target'])
        throw Error('Provide --target and --write-to-empty-target');
      const folder = join(dir, 'live', crypto.randomUUID());
      await mkdir(folder, { recursive: true });
      console.error('Restore journal: ' + folder);
      const result = await restoreVerifiedArchive(
        connection(options.target, process.env.LINKWARDEN_TARGET_TOKEN),
        reference,
        bytes,
        (row) => appendFile(join(folder, 'created.ndjson'), JSON.stringify(row) + '\n')
      );
      await writeNew(join(folder, 'decision.json'), result);
      emit(result);
      if (result.outcome !== 'verified') process.exitCode = 1;
    }
  } else if (command === 'compare') {
    const r = compare(readArchive(await read(a)), readArchive(await read(b)));
    emit(r);
    process.exitCode = r.status === 'matched' ? 0 : 1;
  } else if (['workspaces', 'workspace', 'import'].includes(command)) {
    const s = openStore(dir);
    try {
      if (command === 'workspaces') emit(s.workspaces());
      if (command === 'workspace') emit(s.workspace(a));
      if (command === 'import') emit(s.create(options.name || 'Imported workspace', await read(a)));
    } finally {
      s.close();
    }
  } else if (command === 'capture') {
    await writeNew(
      b,
      await capture(connection(a, process.env.LINKWARDEN_SOURCE_TOKEN), options['owner-id'])
    );
    console.log('Captured ' + b);
  } else if (command === 'restore-into') {
    if (!options.target || !options['write-to-empty-target'])
      throw Error('Provide --target and --write-to-empty-target');
    const path = join(dir, 'live', crypto.randomUUID());
    await mkdir(path, { recursive: true });
    console.error('Restore journal: ' + path);
    const r = await restoreBookmarkArchive(
      connection(options.target, process.env.LINKWARDEN_TARGET_TOKEN),
      await read(a),
      (row) => appendFile(join(path, 'created.ndjson'), JSON.stringify(row) + '\n')
    );
    await writeNew(join(path, 'report.json'), r);
    emit({ path, status: r.status });
    if (r.status !== 'matched') process.exitCode = 1;
  } else if (command === 'live') {
    if (!options.source || !options.target || !options['write-to-empty-target'])
      throw Error('Provide --source, --target and --write-to-empty-target');
    if (new URL(options.source).href === new URL(options.target).href)
      throw Error('Choose distinct source and destination instances');
    const source = connection(options.source, process.env.LINKWARDEN_SOURCE_TOKEN),
      target = connection(options.target, process.env.LINKWARDEN_TARGET_TOKEN);
    const baseline = await capture(source, options['owner-id']),
      archive = await source('migration');
    if (JSON.stringify(baseline) !== JSON.stringify(await capture(source, options['owner-id'])))
      throw Error('Source changed during export');
    const restored = await importToEmpty(target, archive);
    const report = compare(baseline, restored),
      folder = join(dir, 'live', crypto.randomUUID());
    await mkdir(folder, { recursive: true });
    for (const [name, obj] of Object.entries({ baseline, archive, restored, report }))
      await writeNew(join(folder, name + '.json'), obj);
    emit({ folder, status: report.status, differences: report.differences.length });
    if (report.status !== 'matched') process.exitCode = 1;
  } else if (command === 'export-rehearsal') {
    emit(await exportRehearsal({ dir, runId: a, out: b }));
  } else if (command === 'rehearse') {
    if (!a || !options.item) throw Error('Select a workspace and bookmark ID');
    const r = await rehearse({
      dir,
      workspace: a,
      item: options.item,
      holdout: options.holdout,
      holdoutItem: options['holdout-item'],
      repair: options.repair,
      localOnly: options['local-only'],
      exporter: options.exporter,
      resume: options.resume,
      proposal: options.proposal
    });
    emit(r);
    if (r.status === 'local-comparison-only') {
      const checks = r.holdout ? [...r.attempts, r.holdout] : r.attempts;
      process.exitCode = checks.every((check) => check.comparison === 'matched') ? 0 : 1;
    } else if (['inconclusive', 'awaiting-agent-repair'].includes(r.status)) {
      process.exitCode = 2;
    } else {
      process.exitCode = ['passed-original', 'verified-repair'].includes(r.status) ? 0 : 1;
    }
  } else throw Error('Unknown command. Run node cli.mjs help');
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
}

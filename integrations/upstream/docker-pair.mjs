import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { rehearsePair } from './run-pair.mjs';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    workspace: { type: 'string' },
    scenario: { type: 'string' },
    native: { type: 'boolean' },
    'repair-evidence': { type: 'string' },
    'witness-id': { type: 'string' },
    chrome: { type: 'string' },
    'playwright-module': { type: 'string' },
    help: { type: 'boolean' }
  }
});
if (values.help) {
  console.log(
    'node integrations/upstream/docker-pair.mjs [--out NEW_FILE] [--workspace FILE | --scenario branching]\nnode integrations/upstream/docker-pair.mjs --native --out NEW_DIRECTORY [--repair-evidence DIRECTORY] [--witness-id ID] [--chrome PATH] [--playwright-module PATH]'
  );
  process.exit(0);
}

function reservePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const project = 'restoredrill' + randomBytes(10).toString('hex');
const composeFile = fileURLToPath(new URL('./compose.yaml', import.meta.url));
const env = { ...process.env };
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(Error('The command exited with code ' + code))
    );
  });
}

const compose = (args) => run('docker', ['compose', '-p', project, '-f', composeFile, ...args]);
let starting = false;
try {
  const nativeOptions = ['repair-evidence', 'witness-id', 'chrome', 'playwright-module'];
  if (
    values.native
      ? !values.out || values.workspace || values.scenario
      : nativeOptions.some((key) => values[key])
  )
    throw Error(
      'Use --native with --out NEW_DIRECTORY for the browser verifier. Workspace files and named scenarios apply to the HTTP-only run.'
    );
  const workspace = values.workspace
    ? JSON.parse(await readFile(values.workspace, 'utf8'))
    : undefined;
  const reservations = await Promise.all([reservePort(), reservePort()]);
  const ports = reservations.map((server) => server.address().port);
  for (const [index, role] of ['SOURCE', 'TARGET'].entries()) {
    env['DRILL_' + role + '_PORT'] = String(ports[index]);
    env['DRILL_' + role + '_DB_PASSWORD'] = randomBytes(24).toString('hex');
    env['DRILL_' + role + '_AUTH_SECRET'] = randomBytes(48).toString('hex');
  }
  await Promise.all(reservations.map((server) => new Promise((resolve) => server.close(resolve))));
  await compose(['version']);
  starting = true;
  await compose(['up', '--detach', '--wait', '--wait-timeout', '240']);
  const source = 'http://127.0.0.1:' + ports[0],
    target = 'http://127.0.0.1:' + ports[1];
  if (values.native) {
    const verifier = fileURLToPath(new URL('./verify-native.mjs', import.meta.url));
    const flags = nativeOptions.flatMap((key) => (values[key] ? ['--' + key, values[key]] : []));
    await run(process.execPath, [
      verifier,
      '--source',
      source,
      '--target',
      target,
      '--create-disposable-accounts',
      '--out',
      values.out,
      ...flags
    ]);
  } else {
    const report = await rehearsePair({ source, target, workspace, scenario: values.scenario });
    const json = JSON.stringify(report, null, 2) + '\n';
    if (values.out) {
      await mkdir(dirname(resolve(values.out)), { recursive: true });
      await writeFile(values.out, json, { flag: 'wx' });
    }
    console.log(json);
    if (
      report.nativeMigration.comparison === 'matched' ||
      report.portableRecovery.comparison !== 'matched'
    )
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (starting) {
    try {
      await compose(['down', '--volumes']);
    } catch (error) {
      console.error(
        'Cleanup for the disposable Compose project ' + project + ' failed. ' + error.message
      );
      process.exitCode = 1;
    }
  }
}

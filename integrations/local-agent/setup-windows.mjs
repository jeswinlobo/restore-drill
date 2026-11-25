import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../../', import.meta.url));
const model = 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf';
const weightsHash = 'cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046';
const snapshot = 'f86cb2c1fa58255f8052cc32aeede1b7482d4361';
const archive = 'llama-b6851-bin-win-cpu-x64.zip';
const archiveHash = 'a3ed8ac2f68435494efa1d3da8fe247301697cbcd267d0111e4f4a0f2056507d';
const args = process.argv.slice(2);
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw Error(
    'This provisioner installs the Windows x64 runtime. For other systems, use the loopback server instructions.'
  );
}
if (args.length && (args.length !== 2 || args[0] !== '--cache')) {
  throw Error('Usage: node integrations/local-agent/setup-windows.mjs [--cache DIRECTORY]');
}
const cache = resolve(args[1] || join(project, '.restore-drill', 'local-model'));
await mkdir(cache, { recursive: true });

async function fingerprint(file) {
  const sum = createHash('sha256');
  for await (const block of createReadStream(file)) sum.update(block);
  return sum.digest('hex');
}

async function getVerified(name, url, expected) {
  const file = join(cache, name);
  try {
    if ((await fingerprint(file)) !== expected) throw Error('Unexpected fingerprint on cached ' + name);
    return file;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = file + '.' + randomUUID() + '.part';
  try {
    console.log('Downloading ' + name);
    const response = await fetch(url, { signal: AbortSignal.timeout(900000) });
    if (!response.ok) throw Error('Download failed with HTTP ' + response.status);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temp, { flags: 'wx' }));
    if ((await fingerprint(temp)) !== expected)
      throw Error('Unexpected download fingerprint for ' + name);
    await rename(temp, file);
    return file;
  } finally {
    await rm(temp, { force: true });
  }
}

const weights = await getVerified(
  model,
  'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/' + snapshot + '/' + model,
  weightsHash
);
const zip = await getVerified(
  archive,
  'https://github.com/ggml-org/llama.cpp/releases/download/b6851/' + archive,
  archiveHash
);
const runtime = join(cache, 'llama-b6851-cpu');
await mkdir(runtime, { recursive: true });
execFileSync('tar.exe', ['-xf', zip, '-C', runtime], { stdio: 'inherit', windowsHide: true });
const server = join(runtime, 'llama-server.exe');
await access(server);
const configPath = join(project, '.local-tools.json');
let config = {};
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
config.localAgent = {
  model: 'Qwen2.5-Coder-1.5B-Instruct-Q4_K_M',
  server,
  weights,
  weightsSha256: weightsHash
};
const temp = configPath + '.' + randomUUID() + '.tmp';
try {
  await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  await rename(temp, configPath);
} finally {
  await rm(temp, { force: true });
}
console.log('Local coding model configured in ' + configPath);

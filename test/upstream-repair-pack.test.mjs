import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { digest } from '../lib/archive.mjs';
import { importToEmpty } from '../lib/linkwarden.mjs';
import { chooseWitness, readRepairInput } from '../integrations/upstream/repair-input.mjs';
import { testWorkspace } from '../integrations/upstream/run-pair.mjs';

const published = fileURLToPath(new URL('../evidence/unattended/', import.meta.url));
async function copyPack(t) {
  const dir = await mkdtemp(join(tmpdir(), 'drill-pack-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const names = [
    'verification.json',
    'original-workspace.json',
    'original-archive.json',
    'repair-1-archive.json',
    'repair-1-candidate.ts'
  ];
  await Promise.all(names.map((name) => copyFile(join(published, name), join(dir, name))));
  return dir;
}

test('a verified input ties the frozen objective and original source semantics to the exact repair bytes', async () => {
  const input = await readRepairInput(published);
  assert.deepEqual(input.witness.path, ['Studio 197488', 'Licences']);
  assert.equal(input.receipt.sourceHash, digest(input.workspace));
  assert.equal(
    input.receipt.candidateArchiveSha256,
    createHash('sha256').update(input.payload).digest('hex')
  );
  assert.equal(input.receipt.candidateBytes, Buffer.byteLength(input.payload));
});

test('rejects a changed archive byte or source fingerprint before using a server', async (t) => {
  const dir = await copyPack(t),
    file = join(dir, 'verification.json');
  const receipt = JSON.parse(await readFile(file));
  receipt.sourceHash = '0'.repeat(64);
  await writeFile(file, JSON.stringify(receipt));
  await assert.rejects(readRepairInput(dir), /source workspace hash/);
  delete receipt.sourceHash;
  await writeFile(file, JSON.stringify(receipt));
  await appendFile(join(dir, 'repair-1-archive.json'), '\n');
  await assert.rejects(readRepairInput(dir), /SHA-256/);
});

test('older receipts still bind source bookmark data, including its parent, to candidate and original replay', async (t) => {
  const dir = await copyPack(t),
    file = join(dir, 'original-workspace.json');
  const source = JSON.parse(await readFile(file));
  source.bookmarks[0].tags.push('changed');
  await writeFile(file, JSON.stringify(source));
  await assert.rejects(readRepairInput(dir), /Source workspace/);
});

test('recognizes a separately confirmed baseline loss only with the matching parent verification', async (t) => {
  const dir = await copyPack(t),
    file = join(dir, 'verification.json');
  const receipt = JSON.parse(await readFile(file)),
    old = receipt.runs.find((r) => r.stage === 'original');
  old.recovery = 'confirmed-parent-loss';
  old.checks.find((c) => c.side === 'destination').status = 'inconclusive';
  await writeFile(file, JSON.stringify(receipt));
  await assert.rejects(readRepairInput(dir), /required browser observation/);
  old.checks.push({ ...old.checks[0], side: 'parent-witness' });
  await writeFile(file, JSON.stringify(receipt));
  assert.ok((await readRepairInput(dir)).witness);
});

test('multiple bookmarks choose an unambiguous route and an explicit ambiguous selection fails', () => {
  const source = testWorkspace('http://127.0.0.1:3000', 'branching');
  assert.equal(chooseWitness(source, 'north-contract').path.at(-1), 'Renewals');
  assert.throws(() => chooseWitness(source, undefined, 'north-contract'), /names are unique/);
  assert.equal(chooseWitness(source, undefined, 'south-contract').tags.includes('renewal'), true);
});

test('the native import envelope preserves saved whitespace and UTF-8 text exactly', async () => {
  const archive = '{\r\n  "collections": [{"name":"Café","links":[]}]\r\n}\n';
  let imported = false;
  const request = async (path, opts) => {
    if (path === 'migration') {
      const envelope = JSON.parse(opts.body);
      assert.equal(envelope.format, 0);
      assert.equal(envelope.data, archive);
      imported = true;
      return { response: 'Success.' };
    }
    return {
      response: path === 'collections' && imported ? [{ id: 2, name: 'Café', parentId: null }] : []
    };
  };
  const observed = await importToEmpty(request, archive);
  assert.equal(observed.folders[0].name, 'Café');
});

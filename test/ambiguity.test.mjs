import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compare, digest, fresh, readArchive } from '../lib/archive.mjs';
import { prepareAmbiguityInputs, proveAmbiguity } from '../lib/ambiguity.mjs';
import { executeExporter, executeProjectedExporter } from '../lib/exporter.mjs';

test('saved proof is bound to the actual archive from the recorded Kane rehearsal', async () => {
  const location = new URL('../evidence/ambiguity/original-workspace.json', import.meta.url);
  const record = JSON.parse(await readFile(location, 'utf8'));
  const source = await readFile(new URL(record.rehearsal.workspace, location), 'utf8');
  const archived = await readFile(new URL(record.rehearsal.archive, location), 'utf8');
  const prepared = prepareAmbiguityInputs(source);
  assert.equal(record.legacy.sha256, digest(archived));
  assert.equal(record.legacy.bytes, Buffer.byteLength(archived));
  assert.deepEqual([record.pathA, record.pathB], [prepared.pathA, prepared.pathB]);
  assert.deepEqual(record.inputs, { hashA: digest(prepared.stateA), hashB: digest(prepared.stateB) });
});

function workspace() {
  return {
    ...fresh(),
    folders: [
      { id: 'file', name: 'Designs', parent: 'client' },
      { id: 'south', name: 'South', parent: null },
      { id: 'client', name: 'Client', parent: 'north' },
      { id: 'north', name: 'North', parent: null }
    ],
    bookmarks: [
      {
        id: 'draft',
        folder: 'file',
        title: 'Draft',
        url: 'https://example.test/spec',
        tags: ['archived']
      }
    ]
  };
}

test('two valid projected workspaces differ in ownership even when children precede parents', async () => {
  const source = workspace();
  const copy = structuredClone(source);
  const { stateA, stateB, pathA, pathB, bookmark } = prepareAmbiguityInputs(source);
  assert.deepEqual(source, copy);
  assert.deepEqual(pathA, ['North', 'Client', 'Designs']);
  assert.deepEqual(pathB, ['South', 'Client', 'Designs']);
  assert.equal(bookmark.title, 'Draft');
  for (const state of [stateA, stateB]) {
    const ids = state.collections.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const folder of state.collections) {
      assert.ok(folder.parentId === null || ids.includes(folder.parentId));
      for (const link of folder.links) assert.equal(link.collectionId, folder.id);
    }
  }
  const knownA = readArchive({ collections: stateA.collections });
  const knownB = readArchive({ collections: stateB.collections });
  assert.equal(compare(source, knownA).status, 'matched');
  assert.equal(compare(knownA, knownB).status, 'different');

  const controller = await readFile(
    new URL('../integrations/linkwarden/bookmark-export.ts', import.meta.url),
    'utf8'
  );
  const scratch = await mkdtemp(join(tmpdir(), 'restore-drill-ambiguity-test-'));
  try {
    const exportA = await executeProjectedExporter(controller, stateA, scratch);
    const exportB = await executeProjectedExporter(controller, stateB, scratch);
    assert.notEqual(exportA, exportB);
    assert.equal(exportA, await executeExporter(controller, source, scratch));
    assert.equal(compare(knownB, readArchive(exportB)).status, 'matched');
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
});

test('unsupported or indistinguishable roots produce no witness without fetching a controller', async () => {
  const source = workspace();
  const noNetwork = () => proveAmbiguity(source, undefined);
  source.folders[1].name = 'North';
  assert.equal((await noNetwork()).status, 'no-witness');
  source.folders[1].name = 'South';
  source.bookmarks.push({ ...source.bookmarks[0], id: 'index', folder: 'south' });
  assert.equal((await noNetwork()).status, 'no-witness');
  source.bookmarks.pop();
  source.folders.push({ id: 'mirror', name: 'Client', parent: 'south' });
  source.folders.push({ id: 'leaf', name: 'Designs', parent: 'mirror' });
  source.bookmarks.push({ ...source.bookmarks[0], id: 'mirror-draft', folder: 'leaf' });
  assert.equal((await noNetwork()).status, 'no-witness');
  source.bookmarks.push({ ...source.bookmarks[0], id: 'extra-copy', folder: 'leaf' });
  assert.equal(prepareAmbiguityInputs(source).status, 'prepared');
  source.folders[2].parent = null;
  source.folders[2].unresolved = 'missing-1';
  assert.equal((await noNetwork()).status, 'no-witness');
});

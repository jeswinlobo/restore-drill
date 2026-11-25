import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, readArchive, compare, addEntry, inventory } from '../lib/archive.mjs';
import { classify, bookmarkTask } from '../lib/kane.mjs';
import { openStore, openDestination } from '../lib/store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const archive = () =>
  readArchive({
    ...fresh(),
    folders: [
      { id: 'p', name: 'Client / East', parent: null },
      { id: 'c', name: 'Contracts', parent: 'p' }
    ],
    bookmarks: [
      {
        id: 'b',
        title: 'Agreement',
        url: 'https://example.test/record',
        folder: 'c',
        tags: ['work', 'client']
      }
    ]
  });
test('round trip uses segment arrays, canonical tags and identities independent of exported ids', () => {
  const a = archive(),
    b = structuredClone(a);
  b.folders[0].id = 'other';
  b.folders[1].parent = 'other';
  b.bookmarks[0].tags.reverse();
  assert.equal(compare(a, readArchive(b)).status, 'matched');
  b.folders[0].name = 'Client';
  b.folders[1].name = 'East / Contracts';
  assert.equal(compare(a, readArchive(b)).status, 'different');
});
test('unknown parent propagates through descendants and survives a portable re-export', () => {
  const legacy = {
    collections: [
      { name: 'A', links: [] },
      {
        name: 'B',
        parentId: 41,
        links: [{ name: 'Ref', collectionId: 60, url: 'https://example.test' }]
      },
      {
        name: 'C',
        parentId: 60,
        links: [{ name: 'Doc', collectionId: 65, url: 'https://example.test/c' }]
      }
    ]
  };
  const parsed = readArchive(legacy),
    view = inventory(parsed);
  assert.equal(view.bookmarks[1].unresolved, '41');
  assert.deepEqual(parsed, readArchive(JSON.stringify(parsed)));
  assert.equal(compare(archive(), parsed).status, 'needs-review');
  assert.throws(() => compare(parsed, archive()), /unknown/);
});
test('native Linkwarden collection IDs or consistent per-link IDs preserve nesting', () => {
  const raw = {
    collections: [
      { name: 'Root', links: [{ collectionId: 8, url: 'https://example.test' }] },
      { name: 'Sub', parentId: 8, id: 55, links: [] }
    ]
  };
  assert.deepEqual(inventory(readArchive(raw)).folders[1].segments, ['Root', 'Sub']);
  raw.collections[0].id = 2;
  assert.throws(() => readArchive(raw), /Conflicting/);
});
test('cycles, invalid URLs, dangling bookmarks and duplicate ids are rejected', () => {
  let a = archive();
  a.folders[0].parent = 'c';
  assert.throws(() => readArchive(a), /cycle/);
  a = archive();
  a.bookmarks[0].url = 'javascript:123';
  assert.throws(() => readArchive(a), /HTTP/);
  a = archive();
  a.bookmarks[0].folder = 'none';
  assert.throws(() => readArchive(a), /missing/);
  a = archive();
  a.folders.push(a.folders[0]);
  assert.throws(() => readArchive(a), /Duplicate/);
});
test('multiplicities and subtrees under identical names are preserved', () => {
  const a = archive();
  a.folders.push({ ...a.folders[1], id: 'twin' });
  a.bookmarks.push({ ...a.bookmarks[0], id: 'b2', url: 'https://example.test/other' });
  const b = structuredClone(a);
  b.bookmarks[1].folder = 'twin';
  assert.equal(compare(a, b).status, 'different');
  b.bookmarks.pop();
  assert.equal(compare(a, b).status, 'different');
  assert.throws(() => bookmarkTask(a, 'b'), /identically/);
});
test('Kane only accepts matching completed events and process exits', () => {
  const result = (code, end) =>
    classify({
      code,
      stdout: end ? JSON.stringify({ type: 'run_end', ...end }) : '',
      stderr: '',
      error: null
    }).status;
  assert.equal(result(0, { status: 'passed' }), 'passed');
  assert.equal(
    result(1, { status: 'failed', reason_code: 'assertion_error.confirmed_product_bug' }),
    'failed'
  );
  for (const sample of [
    [0, null],
    [2, { status: 'passed' }],
    [1, { status: 'failed', reason_code: 'infra' }],
    [3, { status: 'failed' }]
  ])
    assert.equal(result(...sample), 'inconclusive');
});
test('SQLite persists snapshots, isolates destination and rejects stale updates', () => {
  const folder = mkdtempSync(join(tmpdir(), 'rd-test-'));
  try {
    let store = openStore(folder);
    const w = store.create('My library', archive());
    const d = store.run(w.id, null, w.revision),
      v = openDestination(folder);
    store.update(w.id, w.revision, addEntry(w.archive, { kind: 'folder', name: 'Later' }));
    assert.throws(() => store.update(w.id, w.revision, w.archive), /changed/);
    assert.equal(v.copy(d.id).archive.folders.length, 2);
    v.close();
    store.close();
    store = openStore(folder);
    assert.equal(store.drill(d.id).report.status, 'matched');
    assert.equal(store.workspace(w.id).archive.folders.length, 3);
    store.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { capture, importToEmpty, restoreBookmarkArchive } from '../lib/linkwarden.mjs';
import { fresh } from '../lib/archive.mjs';
test('live connector paginates, verifies stability and preserves source hierarchy', async () => {
  const fake = async (path) => {
    if (path === 'collections')
      return {
        response: [
          { id: 4, name: 'Client', parentId: null },
          { id: 9, parentId: 4, name: 'Research' }
        ]
      };
    if (path === 'links')
      return {
        response: [
          {
            id: 51,
            name: 'Reference',
            collectionId: 9,
            url: 'https://example.test',
            tags: [{ name: 'tag' }]
          }
        ]
      };
    assert.equal(path, 'links?cursor=51');
    return { response: [] };
  };
  const a = await capture(fake);
  assert.equal(a.folders[1].parent, '4');
  assert.deepEqual(a.bookmarks[0].tags, ['tag']);
  await assert.rejects(importToEmpty(fake, { collections: [] }), /empty/);
});
test('empty target checked before import and a fresh destination snapshot returned', async () => {
  let imported = false;
  const c = async (p, opt) => {
    if (p === 'migration') {
      assert.equal(JSON.parse(opt.body).format, 0);
      imported = true;
      return { response: 'Success.' };
    }
    if (p === 'collections')
      return { response: imported ? [{ id: 2, name: 'Docs', parentId: null }] : [] };
    return { response: [] };
  };
  const result = await importToEmpty(c, { collections: [{ name: 'Docs', links: [] }] });
  assert.equal(result.folders[0].name, 'Docs');
});

test('portable restore remaps server identifiers and records accepted writes in dependency order', async () => {
  const collections = [],
    links = [],
    journal = [];
  const request = async (path, options) => {
    if (options?.method === 'POST') {
      const row = JSON.parse(options.body);
      const id = 100 + collections.length + links.length;
      if (path === 'collections') collections.push({ ...row, id });
      else links.push({ ...row, id, collectionId: row.collection.id });
      return { response: { id } };
    }
    return { response: path === 'collections' ? collections : path === 'links' ? links : [] };
  };
  const archive = {
    ...fresh(),
    folders: [
      { id: 's', parent: 'p', name: 'Orders' },
      { id: 'p', parent: null, name: 'Team' }
    ],
    bookmarks: [
      { id: 'b', folder: 's', title: 'Invoice', url: 'https://example.test/invoice', tags: ['billing'] }
    ]
  };
  const result = await restoreBookmarkArchive(request, archive, (entry) => journal.push(entry));
  assert.equal(result.status, 'matched');
  assert.deepEqual(
    journal.map((x) => [x.sourceId, x.targetId]),
    [
      ['p', 100],
      ['s', 101],
      ['b', 102]
    ]
  );
  assert.equal(collections[1].parentId, 100);
  assert.equal(links[0].collectionId, 101);
});

test('an archive with a missing parent stops before contacting a target', async () => {
  const raw = { collections: [{ name: 'Docs', parentId: 555, links: [] }] };
  await assert.rejects(
    restoreBookmarkArchive(() => assert.fail('unexpected request'), raw),
    /unknown parent/
  );
});

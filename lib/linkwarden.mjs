import { readArchive, fresh, digest, inventory, compare } from './archive.mjs';
export function connection(raw, token) {
  const base = new URL(raw);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw Error('Provide a Linkwarden base URL without credentials or query');
  if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
    throw Error('Use HTTPS to send a token outside localhost');
  if (!token) throw Error('Missing Linkwarden API token. Supply it in the named environment variable.');
  const endpoint = (path) => base.href.replace(/\/$/, '') + '/api/v1/' + path;
  return async function request(path, options = {}) {
    const response = await fetch(endpoint(path), {
      ...options,
      signal: AbortSignal.timeout(60000),
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        ...options.headers
      }
    });
    if (!response.ok)
      throw Error('Linkwarden ' + path.split('?')[0] + ' returned HTTP ' + response.status);
    return response.json();
  };
}
export async function capture(request, ownerId) {
  const once = async () => {
    const collections = (await request('collections')).response;
    if (!Array.isArray(collections)) throw Error('Invalid Linkwarden collection listing');
    const workspace = fresh();
    const chosen = collections.filter((c) => !ownerId || String(c.ownerId) === String(ownerId));
    const ids = new Set(chosen.map((c) => String(c.id))),
      seen = new Set();
    workspace.folders = chosen.map((c) => ({
      id: String(c.id),
      name: c.name,
      parent: c.parentId == null ? null : String(c.parentId)
    }));
    let cursor = '';
    do {
      const links = (await request('links' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')))
        .response;
      if (!Array.isArray(links)) throw Error('Invalid Linkwarden bookmark listing');
      if (!links.length) break;
      for (const l of links) {
        const id = String(l.id);
        if (seen.has(id)) throw Error('Unstable Linkwarden pagination; retry after edits finish');
        seen.add(id);
        if (seen.size > 50000) throw Error('Capture exceeds 50,000 links');
        if (ids.has(String(l.collectionId)))
          workspace.bookmarks.push({
            id,
            folder: String(l.collectionId),
            title: l.name || l.url,
            url: l.url,
            tags: l.tags || []
          });
      }
      cursor = String(links.at(-1).id);
    } while (cursor);
    workspace.folders.sort((a, b) => a.id.localeCompare(b.id));
    workspace.bookmarks.sort((a, b) => a.id.localeCompare(b.id));
    return readArchive(workspace);
  };
  const first = await once(),
    second = await once();
  if (digest(first) !== digest(second))
    throw Error('Source changed during capture. Retry with a stable workspace.');
  return first;
}
export async function importToEmpty(request, raw) {
  const before = await capture(request);
  if (before.folders.length || before.bookmarks.length)
    throw Error('Target account must be empty. Create a fresh disposable account.');
  const expected = readArchive(raw);
  const result = await request('migration', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ format: 0, data: typeof raw === 'string' ? raw : JSON.stringify(raw) })
  });
  if (typeof result.response !== 'string') throw Error('Unexpected migration response');
  // Newer servers can queue imports. Wait for the expected counts or report incomplete.
  const deadline = Date.now() + 90000;
  do {
    const restored = await capture(request);
    if (
      restored.folders.length >= expected.folders.length &&
      restored.bookmarks.length >= expected.bookmarks.length
    )
      return restored;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } while (Date.now() < deadline);
  throw Error(
    'Import did not reach the expected counts. Inspect this destination and use a fresh target for a retry.'
  );
}
export async function restoreBookmarkArchive(request, raw, record = async () => {}) {
  const archive = readArchive(raw),
    view = inventory(archive),
    ids = new Map();
  if (view.folders.some((f) => f.unresolved))
    throw Error(
      'Archive contains unknown parent references. Supply an independently confirmed mapping before restoring.'
    );
  const before = await capture(request);
  if (before.folders.length || before.bookmarks.length)
    throw Error('A fresh empty target account is required. Existing data was left untouched.');
  async function post(path, body) {
    const result = await request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!Number.isSafeInteger(result.response?.id))
      throw Error('Target did not confirm a created record');
    return result.response.id;
  }
  for (const folder of view.folders.sort((a, b) => a.segments.length - b.segments.length)) {
    const id = await post('collections', {
      name: folder.name,
      parentId: folder.parent === null ? null : ids.get(folder.parent)
    });
    ids.set(folder.id, id);
    await record({ kind: 'folder', sourceId: folder.id, targetId: id });
  }
  for (const bookmark of archive.bookmarks) {
    const id = await post('links', {
      type: 'url',
      name: bookmark.title,
      url: bookmark.url,
      collection: { id: ids.get(bookmark.folder) },
      tags: bookmark.tags.map((name) => ({ name }))
    });
    await record({ kind: 'bookmark', sourceId: bookmark.id, targetId: id });
  }
  return compare(archive, await capture(request));
}

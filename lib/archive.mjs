import { createHash, randomUUID } from 'node:crypto';

export const FORMAT = 'restore-drill/bookmarks';
export const fresh = () => ({ format: FORMAT, version: 1, folders: [], bookmarks: [] });
export const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export function required(value, field, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('Invalid ' + field);
  return value.trim();
}
function list(value, field) {
  if (!Array.isArray(value) || value.length > 50000) throw Error('Invalid or oversized ' + field);
  return value;
}
function key(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return required(value, 'identifier', 200);
}
function address(value) {
  const url = required(value, 'bookmark URL', 8192);
  if (!['https:', 'http:'].includes(new URL(url).protocol))
    throw Error('Bookmarks require an HTTP or HTTPS URL');
  return url;
}
function tags(value = []) {
  return [
    ...new Set(list(value, 'tags').map((t) => required(typeof t === 'string' ? t : t?.name, 'tag')))
  ].sort();
}
function canonical(raw) {
  if (raw.version !== 1) throw Error('Unsupported portable archive version');
  const folders = list(raw.folders, 'folders').map((f) => ({
    id: key(f.id),
    name: required(f.name, 'folder name'),
    parent: f.parent == null ? null : key(f.parent),
    ...(f.unresolved != null ? { unresolved: key(f.unresolved) } : {})
  }));
  const bookmarks = list(raw.bookmarks, 'bookmarks').map((b) => ({
    id: key(b.id),
    folder: key(b.folder),
    title: required(b.title, 'bookmark title', 2000),
    url: address(b.url),
    tags: tags(b.tags)
  }));
  const byId = new Map(folders.map((f) => [f.id, f]));
  if (byId.size !== folders.length || new Set(bookmarks.map((b) => b.id)).size !== bookmarks.length)
    throw Error('Duplicate archive identifier');
  if (bookmarks.some((b) => !byId.has(b.folder))) throw Error('Bookmark references a missing folder');
  for (const f of folders) {
    if (f.unresolved && f.parent !== null)
      throw Error('Folder cannot have both a known and unknown parent');
    let node = f,
      depth = 0;
    while (node.parent !== null) {
      if (++depth > 128) throw Error('Folder cycle or nesting exceeds 128 levels');
      node = byId.get(node.parent);
      if (!node) throw Error('Portable archive references a missing parent');
    }
  }
  return { format: FORMAT, version: 1, folders, bookmarks };
}
function linkwarden(raw) {
  const collections = list(raw.collections, 'collections');
  const folderIds = new Map();
  const rows = collections.map((c, index) => {
    const links = list(c.links, 'collection links');
    // Linkwarden's old exporter strips id, but links may retain their owning collectionId.
    const hints = new Set(links.filter((l) => l.collectionId != null).map((l) => key(l.collectionId)));
    if (c.id != null) hints.add(key(c.id));
    if (hints.size > 1) throw Error('Conflicting collection identifiers in ' + c.name);
    const reference = [...hints][0];
    const id = 'collection-' + index;
    if (reference !== undefined) {
      if (folderIds.has(reference)) throw Error('Multiple collections claim the same identifier');
      folderIds.set(reference, id);
    }
    return { c, links, id };
  });
  const result = fresh();
  for (const { c, links, id } of rows) {
    const reference = c.parentId == null ? null : key(c.parentId);
    const parent = reference === null ? null : folderIds.get(reference);
    result.folders.push({
      id,
      name: c.name,
      parent: parent ?? null,
      ...(parent === undefined ? { unresolved: reference } : {})
    });
    for (const [i, link] of links.entries()) {
      result.bookmarks.push({
        id: id + '-item-' + i,
        folder: id,
        title: link.name || link.url,
        url: link.url,
        tags: link.tags || []
      });
    }
  }
  return canonical(result);
}
export function readArchive(raw) {
  if (typeof raw === 'string') raw = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!raw || typeof raw !== 'object') throw Error('Expected an archive object');
  if (raw.format === FORMAT) return canonical(raw);
  if (Array.isArray(raw.collections)) return linkwarden(raw);
  throw Error('Choose a Restore Drill v1 archive or a Linkwarden JSON bookmark export');
}
export function addEntry(archive, entry) {
  const next = structuredClone(archive);
  if (entry.kind === 'folder')
    next.folders.push({ id: randomUUID(), name: entry.name, parent: entry.parent || null });
  else if (entry.kind === 'bookmark')
    next.bookmarks.push({
      id: randomUUID(),
      folder: entry.folder,
      title: entry.title,
      url: entry.url,
      tags: entry.tags || []
    });
  else throw Error('Unknown entry type');
  return canonical(next);
}
export function editEntry(archive, entry, remove = false) {
  const next = structuredClone(archive);
  if (!['folder', 'bookmark'].includes(entry.kind)) throw Error('Choose a folder or bookmark');
  const rows = entry.kind === 'folder' ? next.folders : next.bookmarks;
  const index = rows.findIndex((row) => row.id === entry.id);
  if (index < 0) throw Error('Entry no longer exists');
  if (remove) {
    if (
      entry.kind === 'folder' &&
      (next.folders.some((f) => f.parent === entry.id) ||
        next.bookmarks.some((b) => b.folder === entry.id))
    )
      throw Error('Move or remove the folder contents first');
    rows.splice(index, 1);
  } else if (entry.kind === 'bookmark') {
    rows[index] = {
      id: entry.id,
      title: entry.title,
      url: entry.url,
      tags: entry.tags,
      folder: entry.folder
    };
  } else {
    const old = rows[index];
    if (old.unresolved && entry.parent !== old.parent)
      throw Error('Confirm the unknown parent before moving this folder');
    rows[index] = { ...old, name: entry.name, parent: entry.parent || null };
  }
  return canonical(next);
}
export function inventory(archive) {
  const byId = new Map(archive.folders.map((f) => [f.id, f]));
  const memo = new Map();
  function path(id) {
    if (memo.has(id)) return memo.get(id);
    const folder = byId.get(id);
    const parent = folder.parent === null ? { segments: [], unresolved: null } : path(folder.parent);
    const item = {
      segments: [...parent.segments, folder.name],
      unresolved: folder.unresolved ?? parent.unresolved
    };
    memo.set(id, item);
    return item;
  }
  return {
    folders: archive.folders.map((f) => ({ ...f, ...path(f.id) })),
    bookmarks: archive.bookmarks.map((b) => ({ ...b, ...path(b.folder) }))
  };
}
function counts(rows) {
  const out = new Map();
  for (const row of rows) {
    const token = JSON.stringify(row);
    out.set(token, (out.get(token) || 0) + 1);
  }
  return out;
}
export function compare(source, target) {
  const before = inventory(source),
    after = inventory(target);
  const differences = [];
  if (before.folders.some((f) => f.unresolved))
    throw Error(
      'The source has unknown folder relationships. Resolve them from independent knowledge before using it as a baseline.'
    );
  function compareRows(kind, left, right, signature) {
    const a = counts(left.map(signature)),
      b = counts(right.map(signature));
    for (const token of new Set([...a.keys(), ...b.keys()])) {
      const expected = a.get(token) || 0,
        actual = b.get(token) || 0;
      if (expected !== actual) differences.push({ kind, value: JSON.parse(token), expected, actual });
    }
  }
  compareRows('folder', before.folders, after.folders, (f) => [f.unresolved, f.segments]);
  compareRows('bookmark', before.bookmarks, after.bookmarks, (b) => [
    b.unresolved,
    b.segments,
    b.title,
    b.url,
    b.tags
  ]);
  // Equal display paths can hide a changed distribution under identically named siblings.
  if (!differences.length) {
    function forest(a) {
      const children = new Map(),
        items = new Map();
      function append(map, k, v) {
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(v);
      }
      for (const f of a.folders) append(children, f.parent, f);
      for (const b of a.bookmarks) append(items, b.folder, digest([b.title, b.url, b.tags]));
      function branch(f) {
        return digest([
          f.name,
          (items.get(f.id) || []).sort(),
          (children.get(f.id) || []).map(branch).sort()
        ]);
      }
      return (children.get(null) || []).map(branch).sort();
    }
    compareRows('folder subtree', forest(source), forest(target), (s) => s);
  }
  const unknown = after.folders
    .filter((f) => f.unresolved)
    .map((f) => ({ name: f.name, segments: f.segments, reference: f.unresolved }));
  function uniqueBookmarks(rows) {
    const index = new Map();
    for (const b of rows) {
      const ref = JSON.stringify([b.title, b.url, b.tags]);
      index.set(ref, index.has(ref) ? null : b);
    }
    return index;
  }
  const first = uniqueBookmarks(before.bookmarks),
    second = uniqueBookmarks(after.bookmarks),
    changedPaths = [];
  for (const [ref, b] of first) {
    const other = second.get(ref);
    if (
      b &&
      other &&
      (other.unresolved || JSON.stringify(b.segments) !== JSON.stringify(other.segments))
    ) {
      changedPaths.push({
        title: b.title,
        url: b.url,
        source: b.segments,
        restored: other.segments,
        unresolved: other.unresolved
      });
    }
  }
  return {
    status: unknown.length ? 'needs-review' : differences.length ? 'different' : 'matched',
    folders: [source.folders.length, target.folders.length],
    bookmarks: [source.bookmarks.length, target.bookmarks.length],
    differences,
    unknown,
    changedPaths
  };
}

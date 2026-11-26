import { inventory } from './archive.mjs';
export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
export function collectionPage(name, archive, side, params) {
  const inv = inventory(archive),
    folderId = params.get('folder'),
    itemId = params.get('item');
  const f = folderId && inv.folders.find((x) => x.id === folderId);
  const item = itemId && inv.bookmarks.find((x) => x.id === itemId);
  if ((folderId && !f) || (itemId && !item))
    throw Object.assign(Error('Record not found'), { status: 404 });
  const href = (k, v) => '?' + k + '=' + encodeURIComponent(v);
  const row = (url, title, sub) =>
    '<a class="row" href="' +
    esc(url) +
    '"><strong>' +
    esc(title) +
    '</strong><small>' +
    esc(sub) +
    '</small></a>';
  let body = '';
  if (item) {
    body =
      '<a href="' +
      esc(href('folder', item.folder)) +
      '">← Back to folder</a><h1>' +
      esc(item.title) +
      '</h1><dl><dt>Folder path</dt><dd>' +
      esc(item.segments.join(' / ')) +
      '</dd><dt>Parent relationship</dt><dd>' +
      esc(item.unresolved ? 'Unknown parent ' + item.unresolved : 'Known') +
      '</dd><dt>Bookmark URL</dt><dd>' +
      esc(item.url) +
      '</dd><dt>Tags</dt><dd>' +
      esc(item.tags.join(', ') || 'None') +
      '</dd></dl>';
  } else {
    body =
      (f ? '<a href="' + esc(f.parent ? href('folder', f.parent) : '?') + '">← Back</a>' : '') +
      '<h1>' +
      esc(f ? f.name : name) +
      '</h1>';
    if (f) body += '<p>' + esc(f.segments.join(' / ')) + '</p>';
    if (f?.unresolved)
      body += '<p class="warning">Unknown parent reference ' + esc(f.unresolved) + '</p>';
    const folders = inv.folders.filter((x) => x.parent === (f?.id ?? null)),
      links = inv.bookmarks.filter((x) => x.folder === f?.id);
    body += folders
      .map((x) => row(href('folder', x.id), x.name, x.unresolved ? 'Parent needs review' : 'Folder'))
      .join('');
    body += links.map((x) => row(href('item', x.id), x.title, x.url)).join('');
    if (!links.length && !folders.length) body += '<p>Empty folder.</p>';
  }
  return (
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' +
    esc(name) +
    ' · Restore Drill</title><style>body{font:16px system-ui;margin:48px auto;padding:0 25px;max-width:760px;color-scheme:dark;color:#e4ebef;background:#10151b}header{border-bottom:2px solid #23715a;padding-bottom:18px;margin-bottom:32px}a{color:#73dac4}.row,dl{display:block;background:#192129;border:1px solid #35414c;padding:15px;margin-top:8px;text-decoration:none;border-radius:8px}.row small{display:block;color:#a4b3c0;margin-top:4px}dt{font-size:12px;color:#a4b3c0}dd{margin:4px 0 16px;overflow-wrap:anywhere}.warning{color:#f8ce82}</style><header>Restore Drill · ' +
    esc(side) +
    '</header><main>' +
    body +
    '</main></html>'
  );
}

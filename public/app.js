'use strict';
const $ = (s) => document.querySelector(s);
const h = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const names = {
  matched: 'Matched',
  'needs-review': 'Needs review',
  different: 'Different',
  passed: 'Passed',
  failed: 'Failed',
  inconclusive: 'Inconclusive',
  'confirmed-parent-loss': 'Parent loss confirmed'
};
const pill = (s) => '<span class="pill ' + h(s) + '">' + h(names[s] || s) + '</span>';
const act = (id, title, primary = false) =>
  '<button data-act="' + id + '" ' + (primary ? 'class="primary"' : '') + '>' + h(title) + '</button>';
const link = (url, title) => '<a class="button" href="' + h(url) + '">' + h(title) + '</a>';
const tab = (url, title) =>
  '<a class="button" href="' + h(url) + '" target="_blank" rel="noopener">' + h(title) + ' ↗</a>';
const heading = (title, sub, actions = '') =>
  '<div class="intro"><div><h1>' +
  h(title) +
  '</h1><p class="sub">' +
  h(sub) +
  '</p></div><div class="actions">' +
  actions +
  '</div></div>';
const stats = (rows) =>
  '<div class="stats">' +
  rows
    .map(([a, b]) => '<div class="stat"><small>' + h(a) + '</small><strong>' + h(b) + '</strong></div>')
    .join('') +
  '</div>';
const section = (name, body, actions = '') =>
  '<section class="section"><div class="section-head"><h2>' +
  h(name) +
  '</h2><div class="actions">' +
  actions +
  '</div></div>' +
  body +
  '</section>';
const panel = (body) => '<div class="panel">' + body + '</div>';
const empty = (title, sub, actions = '') =>
  '<div class="empty"><span class="archive-icon" aria-hidden="true"></span><h2>' +
  h(title) +
  '</h2><p class="sub">' +
  h(sub) +
  '</p>' +
  actions +
  '</div>';
const date = (s) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const entry = (a, b) =>
  '<div class="entry"><strong>' + h(a) + '</strong><small>' + h(b) + '</small></div>';
const editButton = (kind, id) =>
  '<button data-act="edit" data-id="' + h(id) + '" data-kind="' + kind + '">Edit</button>';
const input = (name, label, attr = '') =>
  '<label for="f-' +
  name +
  '">' +
  h(label) +
  '</label><input id="f-' +
  name +
  '" name="' +
  name +
  '" ' +
  attr +
  '>';
const select = (name, label, options) =>
  '<label for="f-' +
  name +
  '">' +
  h(label) +
  '</label><select name="' +
  name +
  '" id="f-' +
  name +
  '" required>' +
  options.map(([v, t]) => '<option value="' + h(v) + '">' + h(t) + '</option>').join('') +
  '</select>';
let state,
  w,
  d,
  epoch = 0,
  poll,
  submitForm;
async function api(path, data) {
  const res = await fetch(
    '/api/' + path,
    data === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }
  );
  const out = await res.json();
  if (!res.ok) throw Error(out.error || 'Request failed');
  return out;
}
function toast(msg) {
  $('#toast').textContent = msg;
  $('#toast').style.display = 'block';
  setTimeout(() => ($('#toast').style.display = 'none'), 3200);
}
function modal(name, fields, button, fn) {
  $('#modal-title').textContent = name;
  $('#fields').innerHTML = fields;
  $('#submit').textContent = button;
  $('#form-error').textContent = '';
  submitForm = fn;
  $('#modal').showModal();
}
$('#cancel').onclick = $('#close').onclick = () => $('#modal').close();
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  $('#submit').disabled = true;
  const values = Object.fromEntries(new FormData(e.target));
  try {
    await submitForm(values);
    $('#modal').close();
    await render();
  } catch (err) {
    $('#form-error').textContent = err.message;
  } finally {
    $('#submit').disabled = false;
  }
};
function listDrills(list) {
  if (!list.length)
    return empty('No drills yet', 'Run a restore from a workspace to capture its first comparison.');
  return panel(
    '<div class="row head"><div>Workspace</div><div>Result</div><div>Created</div><div></div></div>' +
      list
        .map(
          (x) =>
            '<a class="row link" href="#drill/' +
            x.id +
            '"><strong>' +
            h(x.name) +
            '</strong><div>' +
            pill(x.status) +
            '</div><time>' +
            h(date(x.created)) +
            '</time><span>→</span></a>'
        )
        .join('')
  );
}
function home() {
  const ws = state.workspaces;
  let body = heading(
    'Workspaces',
    'Capture the source, restore its archive, and see exactly what survived.',
    act('import', 'Import archive') + act('new', '+ New workspace', true)
  );
  body += stats([
    ['Workspaces', ws.length],
    ['Completed comparisons', state.drills.length],
    ['Drills needing review', state.drills.filter((x) => x.status !== 'matched').length]
  ]);
  body += section(
    'Workspace library',
    ws.length
      ? panel(
          '<div class="row head"><div>Name</div><div>Contents</div><div>Updated</div><div></div></div>' +
            ws
              .map(
                (x) =>
                  '<a class="row link" href="#workspace/' +
                  x.id +
                  '"><strong>' +
                  h(x.name) +
                  '</strong><span>' +
                  x.folders +
                  ' folders · ' +
                  x.bookmarks +
                  ' links</span><time>' +
                  h(date(x.updated)) +
                  '</time><span>→</span></a>'
              )
              .join('')
        )
      : empty(
          'Create your first workspace',
          'Start with your own folders and bookmarks, or import a portable or Linkwarden JSON archive.',
          act('new', 'Create workspace', true)
        )
  );
  if (state.drills.length)
    body += section(
      'Recent drills',
      listDrills(state.drills.slice(0, 4)),
      '<a href="#history">View all →</a>'
    );
  return body;
}
function workspace() {
  const folders = w.inventory.folders,
    links = w.inventory.bookmarks;
  return (
    '<a class="back" href="#workspaces">← All workspaces</a>' +
    heading(
      w.name,
      'Source workspace · Revision ' + w.revision,
      link('/api/workspaces/' + w.id + '/export', 'Export JSON') + act('run', 'Run restore drill', true)
    ) +
    stats([
      ['Folders', folders.length],
      ['Bookmarks', links.length],
      ['Unknown parents', folders.filter((x) => x.unresolved).length]
    ]) +
    section(
      'Folders',
      folders.length
        ? panel(
            folders
              .map(
                (x) =>
                  '<div class="entry"><strong>' +
                  h(x.segments.join(' / ')) +
                  '</strong>' +
                  (x.unresolved
                    ? '<small>Parent reference ' + h(x.unresolved) + ' needs review.</small>'
                    : '') +
                  editButton('folder', x.id) +
                  (w.archive.folders.find((f) => f.id === x.id)?.unresolved
                    ? '<button data-act="resolve" data-id="' + h(x.id) + '">Confirm parent</button>'
                    : '') +
                  '</div>'
              )
              .join('')
          )
        : empty('No folders yet', 'Add a folder to organize bookmarks and define a source path.'),
      act('folder', '+ Add folder')
    ) +
    section(
      'Bookmarks',
      links.length
        ? panel(
            links
              .map(
                (b) =>
                  '<div class="entry"><strong>' +
                  h(b.title) +
                  '</strong><small>' +
                  h(
                    b.segments.join(' / ') +
                      ' · ' +
                      b.url +
                      (b.tags.length ? ' · ' + b.tags.join(', ') : '')
                  ) +
                  '</small>' +
                  editButton('bookmark', b.id) +
                  '</div>'
              )
              .join('')
          )
        : panel(
            '<div class="pad note">Bookmarks added here will be included in portable exports.</div>'
          ),
      folders.length ? act('bookmark', '+ Add bookmark') : ''
    ) +
    (links.length
      ? section(
          'Exporter rehearsal',
          panel(
            '<div class="pad"><p>Test the published Linkwarden export controller on this workspace. A confirmed failure can be sent to Codex and checked again against a fresh restore.</p></div>'
          ),
          act('rehearse', 'Start rehearsal')
        )
      : '')
  );
}
function rehearsalView(r) {
  if (!r) return empty('Opening rehearsal', 'Waiting for the first saved record…');
  const prefix = '/api/rehearsals/' + r.id + '/';
  return (
    '<a class="back" href="#history">← Drill history</a>' +
    heading(
      'Exporter rehearsal',
      date(r.started) + ' · ' + r.stage,
      link(prefix + 'report', 'Download evidence')
    ) +
    panel(
      '<div class="pad"><h2>' +
        h(r.status.replaceAll('-', ' ')) +
        '</h2><p class="note">' +
        h(r.error || r.stage) +
        '</p></div>'
    ) +
    (r.status === 'awaiting-agent-repair'
      ? section(
          'Continue with your coding agent',
          panel(
            '<div class="pad">' +
              link(prefix + 'handoff-' + r.attempts.length, 'Download repair prompt') +
              '<p class="note">Give this prompt to your coding agent and save its JSON response. Resume with the command below to verify the returned controller.</p><pre>' +
              h(
                'node cli.mjs rehearse ' +
                  r.workspaces[0] +
                  ' --item ' +
                  r.item +
                  (r.holdoutItem
                    ? ' --holdout ' + r.workspaces[1] + ' --holdout-item ' + r.holdoutItem
                    : '') +
                  ' --repair --resume ' +
                  r.id +
                  ' --proposal response.json'
              ) +
              '</pre></div>'
          )
        )
      : '') +
    section(
      'Attempts',
      panel(
        r.attempts.length
          ? r.attempts
              .map(
                (a, i) =>
                  '<div class="entry"><strong>' +
                  h(a.stage) +
                  '</strong><small>Comparison: ' +
                  h(a.comparison) +
                  ' · Kane: ' +
                  h(a.kane || 'Not run') +
                  '</small><p class="note">' +
                  h(
                    a.explanation ||
                      a.parentWitness?.verdict?.summary ||
                      a.destination?.summary ||
                      a.sourceSummary ||
                      ''
                  ) +
                  '</p><div class="actions"><a href="#drill/' +
                  h(a.drill) +
                  '">Open drill report</a>' +
                  (i ? link(prefix + 'candidate-' + i, 'Download candidate') : '') +
                  '</div></div>'
              )
              .join('')
          : '<div class="pad">Awaiting the first completed comparison.</div>'
      )
    ) +
    (r.holdout
      ? section(
          'Independent workspace',
          panel(
            '<div class="pad">' +
              pill(r.holdout.kane || r.holdout.comparison) +
              ' ' +
              link('#drill/' + r.holdout.drill, 'Open holdout drill') +
              '</div>'
          )
        )
      : '') +
    (r.legacyReplay
      ? section(
          'Original archive replay',
          panel(
            '<div class="pad">' +
              pill(r.legacyReplay.status) +
              ' ' +
              link('#drill/' + r.legacyReplay.drill, 'Inspect original archive') +
              '</div>'
          )
        )
      : '') +
    (r.attempts.length
      ? '<div class="actions">' +
        link(prefix + 'original', 'Original controller') +
        link(prefix + 'contract', 'Frozen task') +
        '</div>'
      : '')
  );
}
function browserObservation(o) {
  const checks = [
    ['Source route', o.source],
    ['Restored route', o.destination],
    ['Restored bookmark details', o.parentWitness?.verdict]
  ];
  const rows = checks
    .filter(([, result]) => result)
    .map(
      ([label, result]) =>
        '<div class="entry"><strong>' +
        h(label) +
        '</strong>' +
        pill(result.status) +
        '<p class="note">' +
        h(result.summary || '') +
        '</p></div>'
    )
    .join('');
  return (
    '<div class="pad"><strong>Browser result</strong> ' +
    pill(o.status) +
    '<small> · ' +
    h(date(o.created)) +
    '</small>' +
    (o.error ? '<p class="note">' + h(o.error) + '</p>' : '') +
    '</div>' +
    rows
  );
}
function drill() {
  const r = d.report,
    dd = r.differences;
  const verdicts = d.observations.map(browserObservation).join('');
  const evidence =
    '<div class="pad"><p class="note">Kane opens a selected bookmark in the source and destination. The source snapshot goes offline during the destination check. This run uses your TestMu account and credits.</p>' +
    (d.witnesses.length
      ? '<label for="witness">Bookmark to verify</label><select id="witness">' +
        d.witnesses
          .map(
            (b) =>
              '<option value="' +
              h(b.id) +
              '">' +
              h(b.segments.join(' / ') + ' / ' + b.title) +
              '</option>'
          )
          .join('') +
        '</select><p class="note">' +
        (d.pending ? 'Verification in progress…' : act('verify', 'Verify with Kane', true)) +
        '</p>'
      : '<p class="note">Add a bookmark to a source workspace to verify a browser journey.</p>') +
    '</div>' +
    verdicts;
  const review = r.unknown
    .map((x) =>
      entry(x.segments.join(' / '), 'The archive cannot identify parent reference ' + x.reference + '.')
    )
    .join('');
  const paths = (r.changedPaths || [])
    .slice(0, 30)
    .map(
      (x) =>
        '<div class="entry"><strong>' +
        h(x.title) +
        '</strong><div class="meta"><div><span class="k">Frozen source</span><strong>' +
        h(x.source.join(' / ')) +
        '</strong></div><div><span class="k">Restored copy</span><strong>' +
        h((x.unresolved ? 'Unknown parent / ' : '') + x.restored.join(' / ')) +
        '</strong></div></div></div>'
    )
    .join('');
  function difference(x) {
    if (x.kind === 'folder subtree')
      return entry(
        'Folder contents differ under duplicate names',
        'Expected ' + x.expected + ' · restored ' + x.actual + ' · ' + x.value
      );
    const [unknown, segments, title, url] = x.value;
    return entry(
      (unknown ? 'Unknown parent / ' : '') + segments.join(' / ') + (title ? ' / ' + title : ''),
      x.kind +
        ' · ' +
        x.expected +
        ' in source · ' +
        x.actual +
        ' in restored copy' +
        (url ? ' · ' + url : '')
    );
  }
  return (
    '<a class="back" href="#history">← Drill history</a>' +
    heading(
      d.name,
      'Restore comparison · ' + date(d.created),
      link('/api/drills/' + d.id + '/report', 'Download report')
    ) +
    '<div class="flow">' +
    pill(r.status) +
    '<small>' +
    h(r.origin) +
    ' · Revision ' +
    h(r.sourceRevision) +
    '</small></div>' +
    stats([
      ['Folders · source / restored', r.folders.join(' / ')],
      ['Bookmarks · source / restored', r.bookmarks.join(' / ')],
      ['Differences', dd.length]
    ]) +
    (paths ? section('Changed bookmark paths', panel(paths)) : '') +
    section(
      'Independent libraries',
      panel(
        '<div class="pad actions">' +
          tab(d.sourceUrl, 'Open frozen source') +
          tab(d.destinationUrl, 'Open restored copy') +
          link('/api/drills/' + d.id + '/archive', 'Download tested archive') +
          '</div>'
      )
    ) +
    (review ? section('Unresolved relationships', panel(review)) : '') +
    section(
      'Comparison details',
      dd.length
        ? panel(
            dd.slice(0, 150).map(difference).join('') +
              (dd.length > 150
                ? '<div class="pad note">Download the report for all differences.</div>'
                : '')
          )
        : panel('<div class="pad">All folder paths, bookmark titles, URLs and tag sets match.</div>')
    ) +
    section('Browser verification', panel(evidence)) +
    '<details><summary>Evidence fingerprints</summary>' +
    entry('Portable source · SHA-256', r.sourceHash) +
    entry('Tested archive · SHA-256', r.archiveHash) +
    entry('Restored copy · SHA-256', r.restoredHash) +
    '</details>'
  );
}
async function render() {
  clearTimeout(poll);
  const id = ++epoch;
  const [route = 'workspaces', key] = location.hash.slice(1).split('/');
  try {
    const st = await api('state');
    if (id !== epoch) return;
    state = st;
    let html, crumb;
    if (route === 'workspace' && key) {
      const value = await api('workspaces/' + key);
      if (id !== epoch) return;
      w = value;
      html = workspace();
      crumb = w.name;
    } else if (route === 'drill' && key) {
      const value = await api('drills/' + key);
      if (id !== epoch) return;
      d = value;
      html = drill();
      crumb = 'Restore report';
      if (d.pending) poll = setTimeout(render, 2500);
    } else if (route === 'rehearsal' && key) {
      crumb = 'Exporter rehearsal';
      const record = state.rehearsals.find((x) => x.id === key);
      html = rehearsalView(record);
      if (!record || !record.finished) poll = setTimeout(render, 2200);
    } else if (route === 'history') {
      crumb = 'Drill history';
      html =
        heading(crumb, 'Immutable comparisons and browser observations from completed restores.') +
        listDrills(state.drills);
      if (state.rehearsals.length)
        html += section(
          'Exporter rehearsals',
          panel(
            state.rehearsals
              .map(
                (r) =>
                  '<a class="row link" href="#rehearsal/' +
                  r.id +
                  '"><strong>' +
                  h(state.workspaces.find((x) => x.id === r.workspaces[0])?.name || 'Workspace') +
                  '</strong><span>' +
                  h(r.status) +
                  '</span><time>' +
                  h(date(r.started)) +
                  '</time><span>→</span></a>'
              )
              .join('')
          )
        );
    } else {
      crumb = 'Workspaces';
      html = home();
    }
    $('#crumb').textContent = crumb;
    document.title = crumb + ' · Restore Drill';
    $('#main').innerHTML = html;
    document
      .querySelectorAll('nav a')
      .forEach((el) =>
        el.classList.toggle(
          'on',
          el.dataset.nav ===
            (['history', 'drill', 'rehearsal'].includes(route) ? 'history' : 'workspaces')
        )
      );
  } catch (e) {
    if (id === epoch)
      $('#main').innerHTML = empty(
        'Could not open this view',
        e.message,
        '<a href="#workspaces">Return to workspaces</a>'
      );
  }
}
const fileInput = input('archive', 'JSON archive', 'type="file" accept=".json,application/json"');
async function fileText(file) {
  if (file.size > 16 * 1024 * 1024) throw Error('Archive exceeds 16 MiB');
  return file.text();
}
document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  if (a === 'edit') {
    const kind = el.dataset.kind,
      id = el.dataset.id,
      folder = kind === 'folder';
    const record = (folder ? w.archive.folders : w.archive.bookmarks).find((r) => r.id === id);
    const opts = w.inventory.folders
      .filter((f) => !folder || f.id !== id)
      .map((f) => [f.id, f.segments.join(' / ')]);
    const fields = folder
      ? input('name', 'Folder name', 'required') +
        select('parent', 'Parent folder', [['', 'Workspace root'], ...opts]).replace(' required', '')
      : input('title', 'Title', 'required') +
        input('url', 'URL', 'type="url" required') +
        select('folder', 'Folder', opts) +
        input('tags', 'Tags (comma-separated)');
    modal(
      'Edit ' + kind,
      fields +
        '<p class="note"><button type="button" id="remove-entry">Remove ' +
        kind +
        '</button></p>',
      'Save changes',
      async (v) => {
        await api('workspaces/' + w.id + '/edit', {
          revision: w.revision,
          entry: {
            ...v,
            kind,
            id,
            ...(folder
              ? {}
              : {
                  tags: v.tags
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
                })
          }
        });
      }
    );
    for (const [key, value] of Object.entries(record)) {
      const field = $('#form').elements.namedItem(key);
      if (field) field.value = Array.isArray(value) ? value.join(', ') : (value ?? '');
    }
    $('#remove-entry').onclick = async () => {
      if (
        !confirm('Remove this ' + kind + ' from the working copy? Prior drill snapshots are preserved.')
      )
        return;
      try {
        await api('workspaces/' + w.id + '/remove', { revision: w.revision, entry: { kind, id } });
        $('#modal').close();
        await render();
      } catch (err) {
        $('#form-error').textContent = err.message;
      }
    };
  }
  if (a === 'new' || a === 'import')
    modal(
      a === 'new' ? 'New workspace' : 'Import workspace',
      input('name', 'Workspace name', 'required maxlength="100" autofocus') +
        (a === 'import' ? fileInput : ''),
      'Create workspace',
      async (v) => {
        if (a === 'import' && !v.archive.size) throw Error('Choose an archive file');
        const item = await api('workspaces', {
          name: v.name,
          ...(a === 'import' ? { archive: await fileText(v.archive) } : {})
        });
        location.hash = 'workspace/' + item.id;
      }
    );
  if (a === 'folder' || a === 'bookmark' || a === 'resolve') {
    const options = w.inventory.folders.map((f) => [f.id, f.segments.join(' / ')]);
    if (a === 'folder')
      modal(
        'Add folder',
        input('name', 'Folder name', 'required autofocus') +
          select('parent', 'Location', [['', 'Workspace root'], ...options]).replace(' required', ''),
        'Add folder',
        async (v) => {
          await api('workspaces/' + w.id + '/entries', {
            revision: w.revision,
            entry: { kind: 'folder', ...v }
          });
        }
      );
    if (a === 'bookmark')
      modal(
        'Add bookmark',
        input('title', 'Title', 'required autofocus') +
          input('url', 'URL', 'required type="url"') +
          select('folder', 'Folder', options) +
          input('tags', 'Tags (comma-separated)'),
        'Add bookmark',
        async (v) => {
          await api('workspaces/' + w.id + '/entries', {
            revision: w.revision,
            entry: {
              kind: 'bookmark',
              ...v,
              tags: v.tags
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            }
          });
        }
      );
    if (a === 'resolve')
      modal(
        'Confirm folder parent',
        '<p class="note">Use your independent knowledge to identify the parent. This edits the working copy.</p>' +
          select('parent', 'Confirmed parent', [
            ['__root__', 'Workspace root'],
            ...options.filter(([v]) => v !== el.dataset.id)
          ]),
        'Confirm',
        async (v) => {
          await api('workspaces/' + w.id + '/resolve', {
            revision: w.revision,
            folder: el.dataset.id,
            parent: v.parent === '__root__' ? null : v.parent
          });
        }
      );
  }
  if (a === 'run')
    modal(
      'Run restore drill',
      select('exporter', 'Archive source', [
        ['portable', 'Fresh portable export'],
        ['linkwarden-2.7.1', 'Linkwarden v2.7.1 export controller'],
        ['reference-preserving', 'Reference-preserving bookmark controller'],
        ['file', 'Upload a candidate archive']
      ]) +
        fileInput +
        '<p class="note">The restored copy uses an independent database. The Linkwarden option fetches its official, pinned exporter on first use and runs it on your workspace.</p>',
      'Run comparison',
      async (v) => {
        if (v.exporter === 'file' && !v.archive.size) throw Error('Choose the candidate archive file.');
        if (v.exporter !== 'file' && v.archive.size)
          throw Error('Select “Upload a candidate archive” to use the chosen file.');
        const x = await api('workspaces/' + w.id + '/run', {
          revision: w.revision,
          exporter: v.exporter,
          ...(v.archive.size ? { archive: await fileText(v.archive) } : {})
        });
        location.hash = 'drill/' + x.id;
      }
    );
  if (a === 'rehearse') {
    const options = w.inventory.bookmarks.map((b) => [b.id, b.segments.join(' / ') + ' / ' + b.title]);
    const peers = state.workspaces.filter((x) => x.id !== w.id && x.bookmarks > 0);
    modal(
      'Exporter rehearsal',
      select('item', 'Source bookmark', options) +
        select('mode', 'Verification', [
          ['local', 'Local archive comparison'],
          ['kane', 'Verify with Kane'],
          ['repair', 'Verify, send failure to Codex and rerun']
        ]) +
        select('holdout', 'Independent workspace', [
          ['', 'None'],
          ...peers.map((x) => [x.id, x.name])
        ]).replace(' required', '') +
        '<div id="holdout-item"></div><p class="note">Kane uses TestMu credits. Repair sends the export controller and failed observation to Codex. Candidate changes stay in the local rehearsal folder.</p>',
      'Start rehearsal',
      async (v) => {
        const run = await api('workspaces/' + w.id + '/rehearse', {
          item: v.item,
          localOnly: v.mode === 'local',
          repair: v.mode === 'repair',
          holdout: v.holdout,
          holdoutItem: v.holdoutItem
        });
        location.hash = 'rehearsal/' + run.id;
      }
    );
    $('#f-holdout').onchange = async (e) => {
      const key = e.target.value;
      $('#holdout-item').innerHTML = '';
      if (key) {
        try {
          const peer = await api('workspaces/' + key);
          if ($('#f-holdout')?.value === key)
            $('#holdout-item').innerHTML = select(
              'holdoutItem',
              'Independent bookmark',
              peer.inventory.bookmarks.map((b) => [b.id, b.segments.join(' / ') + ' / ' + b.title])
            );
        } catch (err) {
          $('#form-error').textContent = err.message;
        }
      }
    };
  }
  if (a === 'verify') {
    try {
      el.disabled = true;
      await api('drills/' + d.id + '/verify', { item: $('#witness').value });
      toast('Kane verification started');
      await render();
    } catch (e) {
      el.disabled = false;
      toast(e.message);
    }
  }
});
window.addEventListener('hashchange', render);
render();

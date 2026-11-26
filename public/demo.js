'use strict';

window.restoreDrillDemo = (() => {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
  const steps = [
    ['failure', 'Find the break'],
    ['handoff', 'See the repair'],
    ['retest', 'Verify the fix'],
    ['recovery', 'Decide what to restore']
  ];

  function tree(library, openPath, parent = null) {
    const folders = library.folders.filter((folder) => folder.parent === parent);
    const bookmarks = library.bookmarks.filter((bookmark) => bookmark.folder === parent);
    if (!folders.length && !bookmarks.length) return '<p class="demo-empty">No folders or bookmarks here.</p>';
    return '<ul class="demo-tree">' + folders.map((folder) => {
      const open = openPath.includes(folder.id) ? ' open' : '';
      const warning = folder.unresolved
        ? '<span class="demo-path-warning">Parent unresolved</span>' : '';
      return '<li><details' + open + '><summary><span class="demo-folder" aria-hidden="true"></span>' +
        escape(folder.name) + warning + '</summary>' + tree(library, openPath, folder.id) + '</details></li>';
    }).join('') + bookmarks.map((bookmark) =>
      '<li><details class="demo-bookmark"><summary><span aria-hidden="true">↗</span>' +
      escape(bookmark.title) + '</summary><dl><dt>Stored URL</dt><dd>' + escape(bookmark.url) +
      '</dd><dt>Tags</dt><dd>' + escape(bookmark.tags.join(', ') || 'None') + '</dd></dl></details></li>'
    ).join('') + '</ul>';
  }

  function pathTo(library, bookmark) {
    const path = [];
    for (let id = bookmark?.folder; id;) {
      path.push(id);
      id = library.folders.find((folder) => folder.id === id)?.parent;
    }
    return path;
  }

  function libraryCard({ title, library, verdict, focusPath }) {
    return '<article class="demo-library card-spotlight" data-spotlight="' + escape(verdict.status) +
      '"><div class="demo-library-head"><div><h3>' + title + '</h3><p>' + library.folders.length + ' folders · ' + library.bookmarks.length +
      ' bookmarks</p></div><span class="demo-result ' + escape(verdict.status) + '">' +
      escape(verdict.status) + '</span></div>' + tree(library, focusPath) +
      '<details class="demo-observation"><summary>Recorded Kane observation</summary><p>' +
      escape(verdict.summary) + '</p></details></article>';
  }

  function resultLine(title, check) {
    return '<details class="demo-observation demo-check"><summary><span>' + title +
      '</span><span class="demo-result ' + escape(check.status) + '">' + escape(check.status) +
      '</span></summary><p>' + escape(check.summary) + '</p></details>';
  }

  function assessmentForm() {
    return '<form id="demo-assessment"><div class="demo-file-grid">' +
        '<div><label for="demo-reference">Known-good reference</label><input id="demo-reference" name="reference" type="file" accept=".json,application/json" required></div>' +
        '<div><label for="demo-archive">Backup to check</label><input id="demo-archive" name="archive" type="file" accept=".json,application/json" required></div></div>' +
        '<button type="submit" class="primary">Compare files</button><a href="#workspaces">Open workspaces →</a>' +
        '<div data-assessment-result aria-live="polite"></div></form>';
  }
  function controlPanel() {
    return '<div class="guided-demo operator"><div class="operator-head"><span>Linkwarden / Recovery</span><h1>Check a backup</h1><p>Before switching servers, compare the backup with a trusted copy of your library.</p></div>' +
      '<section class="operator-panel"><div class="section-head"><h2>Compare two exports</h2><button type="button" data-load-example>Load example files</button></div>' +
      '<p>Choose the reference first, then the backup intended for the new server. This check reads both files locally.</p>' + assessmentForm() + '</section>' +
      '<section class="operator-foot"><div><h3>Verification scope</h3><p>Folder structure, bookmark titles, URLs and tags. Documents, attachments and permissions require separate checks.</p></div>' +
      '<div><h3>Investigate a failed restore</h3><p>Inspect the folder that moved, the exporter repair and the recorded Kane browser checks.</p><a href="#demo/failure">Open repair walkthrough →</a></div></section></div>';
  }
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-load-example]');
    if (!button) return;
    const form = document.querySelector('#demo-assessment');
    const output = form.querySelector('[data-assessment-result]');
    button.disabled = true;
    try {
      const files = await Promise.all(['original-workspace.json', 'original-archive.json'].map(async name => {
        const response = await fetch('/api/evidence/unattended-fresh/' + name);
        if (!response.ok) throw Error('Could not load the example files.');
        return new File([await response.blob()], name, { type: 'application/json' });
      }));
      files.forEach((file, i) => {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        form.elements[i ? 'archive' : 'reference'].files = transfer.files;
      });
      output.textContent = 'Example loaded. Compare files to check the original export.';
    } catch (error) { output.textContent = error.message; }
    finally { button.disabled = false; }
  });
  function render(data, step) {
    const receipt = (file) => '/api/evidence/' + encodeURIComponent(data.bundle) + '/' + file;
    const index = Math.max(0, steps.findIndex(([key]) => key === step));
    const brokenBookmark = data.broken.bookmarks.find((bookmark) => bookmark.unresolved);
    const matching = (library) => library.bookmarks.find((bookmark) =>
      bookmark.title === brokenBookmark.title && bookmark.url === brokenBookmark.url
    );
    const source = matching(data.source);
    const task = [...source.segments, source.title].map(escape).join(' <span aria-hidden="true">›</span> ');
    const sourceTitle = escape(source.segments[0]);
    const childTitle = escape(source.segments.at(-1));
    const track = '<nav class="demo-steps" aria-label="Demo steps">' + steps.map(([key, label], i) =>
      '<a href="#demo/' + key + '"' + (index === i ? ' aria-current="step"' : '') +
      '><span class="demo-step-num" aria-hidden="true">' + (i + 1) + '</span>' + label + '</a>'
    ).join('') + '</nav>';
    const actions = '<div class="demo-stage-links">' +
      (index ? '<a class="button" href="#demo/' + steps[index - 1][0] + '">Back</a>' : '') +
      (index < steps.length - 1
        ? '<a class="button demo-next" href="#demo/' + steps[index + 1][0] + '">' + steps[index + 1][1] + ' →</a>'
        : '<a class="button demo-next" href="#workspaces">Try your own library →</a>') + '</div>';
    const headings = [
      ['Same counts. Broken path.', 'Both libraries contain the same number of folders and bookmarks. Open the client folder in each to see what changed.'],
      ['Keep the folder reference.', 'The coding agent received Kane’s failure and the exporter source. The proposed change preserved collection IDs in the backup.'],
      ['Same browser task. This time it passes.', 'Restore Drill made a fresh backup with the proposed repair. Kane followed the original path and then checked a second library.'],
      ['A recovery decision before any write.', 'An old backup can be missing a folder relationship or point to the wrong owner. Check it against an independently verified library before writing to a destination.']
    ];
    const stageHeader = '<div class="demo-stage-heading"><div><h2 id="demo-stage-title" tabindex="-1">' +
      headings[index][0] + '</h2><p>' + headings[index][1] + '</p></div>' + actions + '</div>';
    const taskCard = '<div class="demo-task"><strong>Kane’s browser task</strong><div>' + task +
      '</div><details><summary>Read the recorded test objective</summary><p>' +
      escape(data.objective) + '</p></details></div>';
    const stages = [
      () => '<div class="demo-library-grid">' + libraryCard({
        title: 'Original library', library: data.source, verdict: data.checks.source,
        focusPath: pathTo(data.source, source)
      }) + libraryCard({
        title: 'Broken restore', library: data.broken, verdict: data.checks.broken,
        focusPath: data.broken.folders.filter((folder) => folder.name === source.segments[0]).map((folder) => folder.id)
      }) + '</div>' + taskCard,
      () => '<div class="demo-flow">' +
        '<article><h3>What broke</h3><p>The old exporter removed every record ID. <strong>' +
        childTitle + '</strong> still pointed to parent ID <strong>' + escape(brokenBookmark.unresolved) +
        '</strong>, but no folder in the backup carried that ID.</p></article>' +
        '<article><h3>What Kane reported</h3><p>It opened <strong>' + sourceTitle +
        '</strong> and found it empty. The same bookmark appeared under a folder whose parent needed review.</p></article>' +
        '<article><h3>What changed</h3><p><strong>' + escape(data.model) +
        '</strong> proposed keeping IDs for collections so a fresh backup could link its nested folders.</p></article></div>' +
        '<div class="demo-stage-links"><a class="button" href="' + receipt('agent-handoff.json') +
        '" target="_blank" rel="noopener">Read agent handoff ↗</a><a class="button" href="' +
        receipt('repair-1-candidate.ts') + '" target="_blank" rel="noopener">Read candidate code ↗</a></div>',
      () => '<div class="demo-retest-grid">' + libraryCard({
        title: 'Fresh restore after repair', library: data.fixed, verdict: data.checks.fixed,
        focusPath: pathTo(data.fixed, matching(data.fixed))
      }) + '<div class="demo-library demo-retest"><h3>Recorded browser checks</h3>' +
        resultLine('Original library', data.checks.source) + resultLine('Broken restore', data.checks.broken) +
        resultLine('Fresh restore', data.checks.fixed) + resultLine('Second library', data.checks.holdout) +
        '</div></div>' + taskCard + '<div class="demo-stage-links"><a class="button" href="' +
        receipt('verification.json') + '" target="_blank" rel="noopener">Inspect Kane receipts ↗</a>' +
        '<button type="button" data-act="replay-pack" data-pack="' + escape(data.bundle) +
        '">Replay the repair offline</button></div><div id="replay-' + escape(data.bundle) +
        '" aria-live="polite"></div>' +
        '<details class="demo-native"><summary>See the same problem in Linkwarden</summary>' +
        '<p>In a separate recorded run, stock Linkwarden put Licences at the top level. Restore Drill’s mapped recovery put it back inside its owner’s folder. Kane checked the Collections screen in both copies.</p>' +
        '<div class="demo-library-grid"><figure><img src="/demo-evidence/legacy.png" loading="lazy" alt="Linkwarden shows Licences beside the two owner folders"><figcaption>Stock import · Kane failed</figcaption></figure>' +
        '<figure><img src="/demo-evidence/recovered.png" loading="lazy" alt="Linkwarden shows only the two owner folders at the top level"><figcaption>Mapped recovery · Kane passed</figcaption></figure></div>' +
        '<a href="/api/evidence/upstream/native-repair.json" target="_blank" rel="noopener">Inspect native Linkwarden receipts ↗</a></details>',
      () => '<div class="demo-recovery"><h3>Compare three backup files</h3><p>Recompute the decisions locally. The table separates today’s comparisons from the writes observed in the recorded Linkwarden run.</p>' +
        '<button type="button" class="primary" data-demo-check>Check all three backups</button>' +
        '<div data-demo-output aria-live="polite"></div></div>' +
        '<details class="demo-note"><summary>Check your own backup</summary><p>Export a known-good workspace while the original is available and keep that reference separately. Compare it with a candidate backup here. This check makes no writes to your library.</p>' +
        assessmentForm() + '</details>'
    ];

    return '<div class="guided-demo"><div class="demo-hero"><div><h1>Restore comparison</h1>' +
      '<p>Inspect a Linkwarden backup, see where the folder path broke, and replay the repair.</p></div>' +
      '<div class="demo-origin"><span class="demo-recorded">Recorded browser runs</span><span>' + escape(data.cli) +
      ' · ' + escape(new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(data.recorded))) +
      '</span></div></div>' + track + '<section class="demo-stage" aria-labelledby="demo-stage-title">' +
      stageHeader + stages[index]() + '</section><div class="demo-footer"><a href="#evidence">Browse all evidence →</a>' +
      '<a href="#workspaces">Open workbench →</a></div></div>';
  }

  // React Bits SpotlightCard. The app's existing renderer supplies the card content.
  // Source and license are recorded in THIRD_PARTY_NOTICES.md.
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const card = event.target.closest('.card-spotlight');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', (event.clientX - rect.left) + 'px');
    card.style.setProperty('--mouse-y', (event.clientY - rect.top) + 'px');
  });

  const verdicts = { 'needs-evidence': 'Ask for evidence', blocked: 'Block recovery', ready: 'Ready to restore' };
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-demo-check]');
    if (!button) return;
    const output = document.querySelector('[data-demo-output]');
    button.disabled = true;
    output.textContent = 'Checking backup files…';
    try {
      const response = await fetch('/api/evidence/decisions/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Could not check these backups');
      output.innerHTML = '<div class="demo-decisions">' + data.cases.map((item) => {
        const difference = item.changedPaths[0];
        const path = difference
          ? '<dl><dt>Expected</dt><dd>' + escape(difference.source.join(' › ')) + '</dd><dt>In backup</dt><dd>' +
              escape(difference.restored.join(' › ')) + '</dd></dl>'
          : '';
        return '<article><h4>' + escape(item.label) + '</h4><strong>' + escape(verdicts[item.decision]) +
          '</strong><p>' + escape(item.reason) + '</p>' + path + '<small>' +
          escape(item.recordedWrites) + ' writes in the recorded run</small></article>';
      }).join('') + '</div>';
    } catch (error) {
      output.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  return { render, controlPanel };
})();

import http from 'node:http';
import { fork } from 'node:child_process';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/store.mjs';
import { addEntry, editEntry, readArchive, inventory } from './lib/archive.mjs';
import { collectionPage } from './lib/view.mjs';
import { bookmarkTask, verifyBookmark } from './lib/kane.mjs';
import { officialExporter, executeExporter } from './lib/exporter.mjs';
import { rehearse } from './lib/rehearsal.mjs';
import {
  recordedEvidence,
  evidenceFile,
  optionalRecord,
  replayRecordedRepair
} from './lib/recordings.mjs';
import { proveAmbiguity } from './lib/ambiguity.mjs';
import { assessRecovery } from './lib/recovery-decision.mjs';
import { replayDecisions } from './evidence/decisions/replay.mjs';
import { guidedDemo } from './lib/demo.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const dir = resolve(arg('--data', process.env.RESTORE_DRILL_DATA || '.restore-drill'));
const port = Number(arg('--port', 4317));
await mkdir(dir, { recursive: true });
const store = openStore(dir),
  sourceOffline = new Set(),
  pending = new Set();
const receiver = fork(join(root, 'destination.mjs'), [dir, String(arg('--destination-port', 0))], {
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  windowsHide: true
});
const destination = await new Promise((yes, no) => {
  const timer = setTimeout(() => no(Error('Destination startup timed out')), 10000);
  receiver.once('message', (m) => {
    clearTimeout(timer);
    yes(m.address);
  });
  receiver.once('exit', () => {
    clearTimeout(timer);
    no(Error('Destination stopped during startup'));
  });
});
const assets = {
  '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css',
  '/demo.js': 'demo.js', '/demo.css': 'demo.css'
};
const demoScreenshots = {
  '/demo-evidence/legacy.png': 'legacy-grid.png',
  '/demo-evidence/recovered.png': 'recovered-grid.png'
};
function json(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw Object.assign(Error('File exceeds 16 MiB'), { status: 413 });
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString() || '{}');
}
function archiveDownload(res, value, name) {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': 'attachment; filename="' + name + '"'
  });
  res.end(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
let base;
const activeRehearsals = new Set();
const activeReplays = new Set();
async function rehearsals() {
  const folder = join(dir, 'rehearsals');
  let ids;
  try {
    ids = await readdir(folder);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const list = [];
  for (const id of ids.filter((s) => /^[a-f0-9-]{36}$/.test(s))) {
    try {
      list.push(JSON.parse(await readFile(join(folder, id, 'report.json'), 'utf8')));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return list.sort((a, b) => b.started.localeCompare(a.started));
}
function result(d) {
  const { source, ...rest } = d;
  return {
    ...rest,
    sourceUrl: base + '/source/' + d.id,
    destinationUrl: destination + '/copies/' + d.id,
    witnesses: inventory(source).bookmarks.map((b) => ({
      id: b.id,
      title: b.title,
      segments: b.segments,
      url: b.url
    })),
    pending: pending.has(d.id)
  };
}
const server = http.createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  try {
    const host = req.headers.host;
    if (!host || !['127.0.0.1', 'localhost'].includes(host.split(':')[0]))
      throw Object.assign(Error('Local host required'), { status: 403 });
    const url = new URL(req.url, 'http://' + host),
      p = url.pathname,
      m = req.method;
    if (
      m === 'POST' &&
      ((req.headers.origin && req.headers.origin !== url.origin) ||
        !req.headers['content-type']?.startsWith('application/json'))
    )
      throw Object.assign(Error('Local JSON requests only'), { status: 403 });
    if (m === 'GET' && Object.hasOwn(assets, p)) {
      const type = p === '/' ? 'text/html' : p.endsWith('js') ? 'text/javascript' : 'text/css';
      const asset = await readFile(join(root, 'public', assets[p]));
      res.writeHead(200, { 'content-type': type + '; charset=utf-8' });
      return res.end(asset);
    }
    if (m === 'GET' && Object.hasOwn(demoScreenshots, p)) {
      const screenshot = await readFile(
        join(root, 'evidence', 'upstream', 'native-repair-grids', demoScreenshots[p])
      );
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(screenshot);
    }
    if (m === 'GET' && p === '/api/demo') return json(res, await guidedDemo());
    if (m === 'POST' && p === '/api/recovery/assessment') {
      const { reference, archive } = await body(req);
      if (typeof reference !== 'string' || typeof archive !== 'string')
        throw Object.assign(Error('Choose both a known-good reference and a backup.'), { status: 400 });
      return json(res, assessRecovery(reference, archive));
    }
    if (m === 'GET' && p === '/api/evidence') {
      const challenge = JSON.parse(await readFile(join(root, 'evidence/challenge/result.json'), 'utf8'));
      const [packs, ambiguity, upstream, nativeBrowser, nativeRepair] = await Promise.all([
        recordedEvidence(),
        optionalRecord('ambiguity', 'original-workspace.json'),
        optionalRecord('upstream', 'pair.json'),
        optionalRecord('upstream', 'native-kane.json'),
        optionalRecord('upstream', 'native-repair.json')
      ]);
      return json(res, { packs, challenge, ambiguity, upstream, nativeBrowser, nativeRepair });
    }
    if (m === 'POST' && p === '/api/evidence/decisions/check') {
      await body(req);
      return json(res, await replayDecisions());
    }
    const receipt = /^\/api\/evidence\/([a-z][a-z0-9-]*)\/([a-z0-9.-]+)$/.exec(p);
    if (receipt) {
      const [, bundle, action] = receipt;
      if (m === 'POST' && action === 'replay') {
        await body(req);
        if (activeReplays.has(bundle))
          throw Object.assign(Error('This replay is already running'), { status: 409 });
        activeReplays.add(bundle);
        try {
          return json(res, await replayRecordedRepair(bundle));
        } finally {
          activeReplays.delete(bundle);
        }
      }
      if (m === 'GET') {
        const data = await evidenceFile(bundle, action);
        res.writeHead(200, {
          'content-type': action.endsWith('.ts')
            ? 'text/plain; charset=utf-8'
            : 'application/json; charset=utf-8'
        });
        return res.end(data);
      }
    }
    if (m === 'GET' && p === '/api/state')
      return json(res, {
        workspaces: store.workspaces(),
        drills: store.drills(),
        destination,
        rehearsals: await rehearsals()
      });
    const fileMatch =
      /^\/api\/rehearsals\/([a-f0-9-]{36})\/(report|contract|original|candidate-[12]|handoff-[12])$/.exec(
        p
      );
    if (m === 'GET' && fileMatch) {
      const [, rid, kind] = fileMatch;
      const fname = kind.startsWith('handoff-')
        ? 'repair-' + kind.slice(-1) + '/prompt.txt'
        : kind.startsWith('candidate-')
          ? 'repair-' + kind.slice(-1) + '/candidate.ts'
          : kind === 'original'
            ? 'original.ts'
            : kind + '.json';
      const data = await readFile(join(dir, 'rehearsals', rid, fname), 'utf8');
      res.writeHead(200, {
        'content-type': fname.endsWith('.json') ? 'application/json' : 'text/plain',
        'content-disposition':
          'attachment; filename="' + kind + fname.slice(fname.lastIndexOf('.')) + '"'
      });
      return res.end(data);
    }
    if (m === 'POST' && p === '/api/workspaces') {
      const b = await body(req);
      return json(res, store.create(b.name, b.archive == null ? undefined : b.archive), 201);
    }
    const match = /^\/(api\/workspaces|api\/drills|source)\/([a-f0-9-]+)(?:\/([a-z-]+))?$/.exec(p);
    if (!match) throw Object.assign(Error('Not found'), { status: 404 });
    const [, group, id, action] = match;
    if (group === 'source' && !action && m === 'GET') {
      if (sourceOffline.has(id))
        throw Object.assign(Error('Source offline during restore verification'), { status: 410 });
      const d = store.drill(id);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(collectionPage(d.name, d.source, 'Frozen source', url.searchParams));
    }
    if (group === 'api/workspaces') {
      const w = store.workspace(id);
      if (m === 'GET' && !action) return json(res, { ...w, inventory: inventory(w.archive) });
      if (m === 'GET' && action === 'export')
        return archiveDownload(res, w.archive, 'portable-workspace.json');
      if (m === 'POST') {
        const b = await body(req);
        if (action === 'assess-recovery') {
          const current = store.workspace(id);
          if (b.revision !== current.revision)
            throw Object.assign(Error('Workspace changed. Reload and retry.'), { status: 409 });
          return json(res, assessRecovery(current.archive, b.archive));
        }
        if (action === 'ambiguity') {
          if (b.revision !== w.revision)
            throw Object.assign(Error('Workspace changed. Reload it before checking the archive.'), {
              status: 409
            });
          const proof = await proveAmbiguity(w.archive, dir);
          return json(res, { ...proof, workspace: w.name, revision: w.revision });
        }
        if (action === 'rehearse') {
          bookmarkTask(w.archive, b.item);
          if (activeRehearsals.size)
            throw Object.assign(Error('Wait for the active rehearsal to finish'), { status: 409 });
          if (b.holdout) {
            if (b.holdout === w.id) throw Error('Choose a different holdout workspace');
            bookmarkTask(store.workspace(b.holdout).archive, b.holdoutItem);
          }
          const runId = randomUUID();
          activeRehearsals.add(runId);
          rehearse({
            dir,
            workspace: w.id,
            item: b.item,
            repair: b.repair === true,
            localOnly: b.localOnly === true,
            holdout: b.holdout || null,
            holdoutItem: b.holdoutItem || null,
            runId
          })
            .catch((e) => console.error('Rehearsal:', e.message))
            .finally(() => activeRehearsals.delete(runId));
          return json(res, { id: runId }, 202);
        }
        if (action === 'entries')
          return json(res, store.update(id, b.revision, addEntry(w.archive, b.entry)));
        if (action === 'edit' || action === 'remove')
          return json(
            res,
            store.update(id, b.revision, editEntry(w.archive, b.entry, action === 'remove'))
          );
        if (action === 'resolve') {
          const copy = structuredClone(w.archive),
            folder = copy.folders.find((f) => f.id === b.folder);
          if (!folder?.unresolved) throw Error('Choose a folder with an unknown parent');
          if (!Object.hasOwn(b, 'parent')) throw Error('Select a parent explicitly');
          folder.parent = b.parent;
          delete folder.unresolved;
          return json(res, store.update(id, b.revision, readArchive(copy)));
        }
        if (action === 'run') {
          let archive = b.archive;
          if (b.exporter === 'linkwarden-2.7.1') {
            const controller = await officialExporter(dir);
            archive = await executeExporter(controller.source, w.archive, join(dir, 'controllers'));
          } else if (b.exporter === 'reference-preserving') {
            const controller = await readFile(
              join(root, 'integrations', 'linkwarden', 'bookmark-export.ts'),
              'utf8'
            );
            archive = await executeExporter(controller, w.archive, join(dir, 'controllers'));
          }
          const origins = {
            'linkwarden-2.7.1': 'Linkwarden v2.7.1 controller',
            'reference-preserving': 'Reference-preserving bookmark controller'
          };
          return json(
            res,
            result(
              store.run(
                id,
                archive,
                b.revision,
                Object.hasOwn(origins, b.exporter) ? origins[b.exporter] : undefined
              )
            ),
            201
          );
        }
      }
    }
    if (group === 'api/drills') {
      const d = store.drill(id);
      if (m === 'GET' && !action) return json(res, result(d));
      if (m === 'GET' && action === 'archive')
        return archiveDownload(res, store.payload(id), 'tested-archive.json');
      if (m === 'GET' && action === 'report')
        return archiveDownload(
          res,
          { format: 'restore-drill/report', version: 1, ...result(d) },
          'restore-report.json'
        );
      if (m === 'POST' && action === 'verify') {
        const b = await body(req);
        bookmarkTask(d.source, b.item);
        if (pending.size)
          throw Object.assign(
            Error('A Kane verification is already running. Try again after it finishes.'),
            { status: 409 }
          );
        pending.add(id);
        verifyBookmark({
          drill: d,
          item: b.item,
          dir,
          restored: store.payload(id),
          sourceUrl: base + '/source/' + id,
          destinationUrl: destination + '/copies/' + id,
          sourceGate: (on) => (on ? sourceOffline.add(id) : sourceOffline.delete(id))
        })
          .then((o) => store.addObservation(id, o))
          .catch((e) =>
            store.addObservation(id, {
              status: 'inconclusive',
              created: new Date().toISOString(),
              error: e.message
            })
          )
          .finally(() => {
            pending.delete(id);
            sourceOffline.delete(id);
          });
        return json(res, { started: true }, 202);
      }
    }
    throw Object.assign(Error('Not found'), { status: 404 });
  } catch (e) {
    if (!res.headersSent) json(res, { error: e.message }, e.status || 400);
    else res.end();
  }
});
server.on('error', (e) => {
  console.error(e.message);
  receiver.kill();
  process.exit(1);
});
server.listen(port, '127.0.0.1');
await once(server, 'listening');
base = 'http://127.0.0.1:' + server.address().port;
console.log('Restore Drill   ' + base + '\nDestination    ' + destination + '\nPrivate data   ' + dir);
process.send?.({ base, destination });
function stop() {
  receiver.kill();
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.once('disconnect', stop);

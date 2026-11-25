import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compare, digest, fresh, readArchive, required } from './archive.mjs';

const now = () => new Date().toISOString();
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'source.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;');
  db.prepare('ATTACH DATABASE ? AS restored').run(join(dir, 'restored.sqlite'));
  db.exec(
    'PRAGMA restored.journal_mode=DELETE;' +
      'CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, name TEXT, archive TEXT, revision INTEGER, updated TEXT);' +
      'CREATE TABLE IF NOT EXISTS drills(id TEXT PRIMARY KEY, name TEXT, created TEXT, source TEXT, payload TEXT, report TEXT);' +
      'CREATE TABLE IF NOT EXISTS restored.copies(id TEXT PRIMARY KEY, name TEXT, archive TEXT);' +
      'CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY, drill TEXT, created TEXT, data TEXT);'
  );
  const many = (sql, ...params) => db.prepare(sql).all(...params);
  function workspace(id) {
    const row = db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
    if (!row) throw Object.assign(Error('Workspace not found'), { status: 404 });
    return { ...row, archive: JSON.parse(row.archive) };
  }
  function create(name, raw = fresh()) {
    const id = randomUUID(),
      archive = readArchive(raw);
    db.prepare('INSERT INTO workspaces VALUES(?,?,?,1,?)').run(
      id,
      required(name, 'workspace name', 100),
      JSON.stringify(archive),
      now()
    );
    return workspace(id);
  }
  function update(id, revision, archive) {
    const change = db
      .prepare(
        'UPDATE workspaces SET archive=?, revision=revision+1, updated=? WHERE id=? AND revision=?'
      )
      .run(JSON.stringify(readArchive(archive)), now(), id, revision);
    if (!change.changes)
      throw Object.assign(Error('Workspace changed. Reload before editing.'), { status: 409 });
    return workspace(id);
  }
  function drill(id) {
    const row = db.prepare('SELECT * FROM drills WHERE id=?').get(id);
    if (!row) throw Object.assign(Error('Drill not found'), { status: 404 });
    return {
      id: row.id,
      name: row.name,
      created: row.created,
      report: JSON.parse(row.report),
      source: JSON.parse(row.source),
      observations: many('SELECT data FROM observations WHERE drill=? ORDER BY rowid DESC', id).map(
        (r) => JSON.parse(r.data)
      )
    };
  }
  function run(id, candidate, expectedRevision, origin) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const w = workspace(id);
      if (expectedRevision != null && w.revision !== expectedRevision)
        throw Object.assign(Error('Workspace changed. Refresh and retry.'), { status: 409 });
      const payload =
        candidate == null
          ? JSON.stringify(w.archive)
          : typeof candidate === 'string'
            ? candidate
            : JSON.stringify(candidate);
      const restored = readArchive(payload),
        result = compare(w.archive, restored),
        drillId = randomUUID();
      const report = {
        ...result,
        sourceHash: digest(w.archive),
        archiveHash: digest(payload),
        restoredHash: digest(restored),
        sourceRevision: w.revision,
        origin: origin || (candidate == null ? 'Portable export' : 'Supplied archive')
      };
      db.prepare('INSERT INTO restored.copies VALUES(?,?,?)').run(
        drillId,
        w.name,
        JSON.stringify(restored)
      );
      db.prepare('INSERT INTO drills VALUES(?,?,?,?,?,?)').run(
        drillId,
        w.name,
        now(),
        JSON.stringify(w.archive),
        payload,
        JSON.stringify(report)
      );
      db.exec('COMMIT');
      return drill(drillId);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return {
    workspace,
    create,
    update,
    run,
    drill,
    workspaces: () =>
      many(
        "SELECT id,name,revision,updated,json_array_length(archive,'$.folders') AS folders,json_array_length(archive,'$.bookmarks') AS bookmarks FROM workspaces ORDER BY updated DESC"
      ),
    drills: () =>
      many(
        "SELECT id,name,created,json_extract(report,'$.status') AS status FROM drills ORDER BY created DESC"
      ),
    payload: (id) => {
      const r = db.prepare('SELECT payload FROM drills WHERE id=?').get(id);
      if (!r) throw Error('Unknown drill');
      return r.payload;
    },
    addObservation: (id, data) =>
      db
        .prepare('INSERT INTO observations VALUES(?,?,?,?)')
        .run(randomUUID(), id, now(), JSON.stringify(data)),
    close: () => db.close()
  };
}
export function openDestination(dir) {
  const db = new DatabaseSync(join(dir, 'restored.sqlite'), { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000;');
  return {
    copy(id) {
      const row = db.prepare('SELECT name,archive FROM copies WHERE id=?').get(id);
      if (!row) throw Object.assign(Error('Restored copy not found'), { status: 404 });
      return { name: row.name, archive: JSON.parse(row.archive) };
    },
    close: () => db.close()
  };
}

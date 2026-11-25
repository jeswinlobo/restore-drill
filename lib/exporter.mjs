import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { execute } from './process.mjs';
import { readArchive } from './archive.mjs';

export const upstreamURL =
  'https://raw.githubusercontent.com/linkwarden/linkwarden/v2.7.1/lib/api/controllers/migration/exportData.ts';
const blob = '73141fd0f3e2f25f360c39bb90de4afe665bc89c';
export async function officialExporter(dir) {
  const folder = join(dir, 'upstream'),
    path = join(folder, 'linkwarden-v2.7.1-exportData.ts');
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (source === undefined) {
    try {
      const res = await fetch(upstreamURL, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw Error('HTTP ' + res.status);
      source = await res.text();
    } catch {
      const api = 'https://api.github.com/repos/linkwarden/linkwarden/git/blobs/' + blob;
      const res = await fetch(api, {
        headers: { 'User-Agent': 'Restore-Drill' },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) throw Error('Official Linkwarden source unavailable: HTTP ' + res.status);
      const payload = await res.json();
      if (payload.encoding !== 'base64' || typeof payload.content !== 'string')
        throw Error('Unexpected GitHub source response');
      source = Buffer.from(payload.content, 'base64').toString('utf8');
    }
  }
  source = source.replace(/\r\n/g, '\n');
  const hash = createHash('sha1')
    .update('blob ' + Buffer.byteLength(source) + '\0')
    .update(source)
    .digest('hex');
  if (hash !== blob) throw Error('Official exporter content does not match pinned v2.7.1 source');
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(path, source, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  return { source, path };
}
// Project user-created library rows to the precise Prisma read used by this export controller.
export function projectAccount(archive) {
  const ids = new Map(archive.folders.map((f, i) => [f.id, 19 + i * 7]));
  const grouped = new Map(archive.folders.map((f) => [f.id, []]));
  archive.bookmarks.forEach((b, i) =>
    grouped
      .get(b.folder)
      .push({
        id: 3 + i,
        name: b.title,
        url: b.url,
        collectionId: ids.get(b.folder),
        tags: b.tags.map((name) => ({ name })),
        description: ''
      })
  );
  return {
    id: 1,
    name: 'Workspace owner',
    collectionOrder: [],
    pinnedLinks: [],
    whitelistedUsers: [],
    collections: archive.folders.map((f) => ({
      id: ids.get(f.id),
      parentId: f.parent === null ? null : ids.get(f.parent),
      name: f.name,
      description: '',
      color: '#0ea5e9',
      ownerId: 1,
      links: grouped.get(f.id)
    }))
  };
}
export async function executeExporter(source, archive, privateDir) {
  if (archive.folders.some((f) => f.unresolved))
    throw Error('A rehearsal requires a known source hierarchy');
  return executeProjectedExporter(source, projectAccount(archive), privateDir);
}

export async function executeProjectedExporter(source, account, privateDir) {
  let js = stripTypeScriptTypes(source).replace(
    /^\s*import\s+\{\s*prisma\s*\}\s+from\s+["']@\/lib\/api\/db["'];?\s*$/m,
    ''
  );
  if (!/export\s+default\s+async\s+function\s+\w+/.test(js))
    throw Error('Expected a default async Linkwarden export controller');
  js = js.replace(/export\s+default\s+async\s+function\s+\w+/, 'async function runExport');
  await mkdir(privateDir, { recursive: true });
  const cwd = await mkdtemp(join(resolve(privateDir), 'export-'));
  const worker = join(cwd, 'controller.mjs');
  const wrapper =
    "let text=''; for await(const chunk of process.stdin)text+=chunk; const user=JSON.parse(text); const prisma={user:{findUnique:async()=>structuredClone(user)}};\n" +
    js +
    "\nconst result=await runExport(user.id);if(result.status!==200)throw Error('Export failed');process.stdout.write(JSON.stringify(result.response));\n";
  await writeFile(worker, wrapper);
  const result = await execute(
    process.execPath,
    ['--permission', '--allow-fs-read=' + worker, '--disallow-code-generation-from-strings', worker],
    {
      cwd,
      input: JSON.stringify(account),
      timeout: 20000,
      env: { SystemRoot: process.env.SystemRoot || '', PATH: '' }
    }
  );
  if (result.code !== 0 || result.error)
    throw Error('Exporter execution failed: ' + (result.error || result.stderr.slice(-1000)));
  const archiveText = result.stdout;
  readArchive(archiveText);
  return archiveText;
}

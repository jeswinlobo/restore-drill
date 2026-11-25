import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compare, digest, readArchive } from '../../lib/archive.mjs';
import { capture, importToEmpty, restoreBookmarkArchive } from '../../lib/linkwarden.mjs';
import { createAccount, describe, loopbackOrigin, testWorkspace } from './run-pair.mjs';

// Only these reviewed, hash-pinned files may execute against the rehearsal database.
const candidates = {
  recorded: [
    'evidence/kane/repair-1-candidate.ts',
    'b7627ce97a8d2644c062023d36c8c644661cc049888c8637ec84feb2030c567d'
  ],
  unattended: [
    'evidence/unattended/repair-1-candidate.ts',
    '653e8a23e55b8b11335f9e91e7db8fecca072dd73a0c984612cba4890201db86'
  ]
};
const sourceHash = '73141fd0f3e2f25f360c39bb90de4afe665bc89c';
let prisma;
try {
  const { values } = parseArgs({
    options: {
      checkout: { type: 'string' },
      source: { type: 'string' },
      target: { type: 'string' },
      out: { type: 'string' },
      workspace: { type: 'string' },
      'create-disposable-accounts': { type: 'boolean' },
      candidate: { type: 'string', default: 'recorded' },
      'candidate-source': { type: 'string' }
    }
  });
  if (
    !values['create-disposable-accounts'] ||
    !values.checkout ||
    !values.source ||
    !values.target
  ) {
    throw Error(
      'Use --checkout LINKWARDEN_DIRECTORY --source ORIGIN --target ORIGIN --create-disposable-accounts [--workspace FILE] [--out NEW_FILE]. Set DATABASE_URL to the disposable source database.'
    );
  }
  const source = loopbackOrigin(values.source),
    target = loopbackOrigin(values.target);
  const database = new URL(process.env.DATABASE_URL || 'about:blank');
  if (
    source === target ||
    !['postgresql:', 'postgres:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
  ) {
    throw Error(
      'Use distinct loopback HTTP origins and the loopback PostgreSQL source for these test accounts.'
    );
  }
  const checkout = resolve(values.checkout);
  if (!Object.hasOwn(candidates, values.candidate))
    throw Error('Choose the recorded or unattended candidate.');
  const [controller, expectedHash] = candidates[values.candidate];
  const candidate = values['candidate-source']
    ? resolve(values['candidate-source'])
    : fileURLToPath(new URL('../../' + controller, import.meta.url));
  const bytes = await readFile(candidate);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedHash) throw Error('Recorded Kane candidate hash changed.');
  const stock = await readFile(join(checkout, 'lib/api/controllers/migration/exportData.ts'));
  const sha1 = createHash('sha1')
    .update('blob ' + stock.length + '\0')
    .update(stock)
    .digest('hex');
  if (sourceHash !== sha1)
    throw Error('Expected the unmodified v2.7.1 exporter in the upstream checkout.');
  const load = createRequire(join(checkout, 'package.json'));
  if (load('./package.json').version !== 'v2.7.1') throw Error('Expected a v2.7.1 checkout.');
  load('ts-node').register({
    project: join(checkout, 'tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS' },
    moduleTypes: { '**/repair-1-candidate.ts': 'cjs', '**/candidate.ts': 'cjs' }
  });
  load('tsconfig-paths').register({ baseUrl: checkout, paths: { '@/*': ['./*'] } });
  prisma = load('@/lib/api/db').prisma;
  const exportData = load(candidate).default;
  const fixture = values.workspace
    ? readArchive(await readFile(values.workspace, 'utf8'))
    : testWorkspace(source);
  const [original, native, repaired] = await Promise.all([
    createAccount(source),
    createAccount(target),
    createAccount(target)
  ]);
  const seeded = await restoreBookmarkArchive(original.api, fixture);
  if (seeded.status !== 'matched')
    throw Error('Source capture differs from the supplied workspace.');
  const baseline = await capture(original.api);
  // Verify a randomly chosen session belongs to the exact source database before executing the candidate.
  const dbOwner = await prisma.user.findUnique({
    where: { id: original.ownerId },
    select: { username: true }
  });
  if (!dbOwner || dbOwner.username !== original.username) {
    throw Error('Source HTTP account and source PostgreSQL database do not match.');
  }
  const exported = await exportData(original.ownerId);
  if (exported.status !== 200) throw Error('Candidate export failed.');
  const portable = readArchive(exported.response);
  const wireCheck = compare(baseline, portable);
  if (wireCheck.status !== 'matched') throw Error('Candidate archive differs from source.');
  const nativeCopy = await importToEmpty(native.api, exported.response);
  const nativeCheck = compare(baseline, nativeCopy);
  const writes = [];
  await restoreBookmarkArchive(repaired.api, portable, (value) => writes.push(value));
  const final = await capture(repaired.api);
  const recoveredCheck = compare(baseline, final);
  const report = {
    upstream: 'Linkwarden v2.7.1',
    recorded: new Date().toISOString(),
    controller,
    candidateSha256: sha256,
    sourceExporterGitBlob: sourceHash,
    execution:
      'Unmodified candidate TypeScript, upstream database module and generated Prisma client, real PostgreSQL source',
    original: { folders: baseline.folders.length, bookmarks: describe(baseline) },
    candidateArchive: {
      hash: digest(exported.response),
      comparison: wireCheck.status,
      bookmarks: describe(portable)
    },
    stockImporterWithCandidateArchive: {
      method: 'POST /api/v1/migration',
      comparison: nativeCheck.status,
      bookmarks: describe(nativeCopy)
    },
    mappedRestoreWithCandidateArchive: {
      method: 'Restore Drill writes through the target collections and links APIs',
      comparison: recoveredCheck.status,
      acknowledgedWrites: writes.length,
      bookmarks: describe(final)
    }
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.out) {
    await mkdir(dirname(resolve(values.out)), { recursive: true });
    await writeFile(values.out, json, { flag: 'wx' });
  }
  console.log(json);
  if (nativeCheck.status === 'matched' || recoveredCheck.status !== 'matched') process.exitCode = 1;
} catch (error) {
  // Prisma diagnostics can embed connection details. The operation and type suffice in that case.
  console.error(
    error.name?.startsWith('Prisma')
      ? error.name + ' in the isolated source database'
      : error.message
  );
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect();
}

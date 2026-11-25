import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { compare, digest, fresh, inventory, readArchive } from '../../lib/archive.mjs';
import {
  capture,
  connection,
  importToEmpty,
  restoreBookmarkArchive
} from '../../lib/linkwarden.mjs';

// Each run uses fresh accounts created through the application's registration form API.
// The existing Linkwarden connector, authentication handlers and both servers operate over HTTP.
export function loopbackOrigin(value) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw Error('Supply the loopback origin of a disposable Linkwarden server.');
  }
  return url.origin;
}

export async function createAccount(origin) {
  const username = 'drill_' + randomBytes(8).toString('hex');
  const password = randomBytes(24).toString('base64url');
  const cookies = new Map();
  async function request(path, options = {}) {
    const response = await fetch(origin + '/api/v1/' + path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(180000),
      ...options,
      headers: {
        ...options.headers,
        cookie: [...cookies].map(([key, val]) => key + '=' + val).join('; ')
      }
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';', 1)[0],
        at = pair.indexOf('=');
      if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    if (!response.ok) throw Error('Linkwarden ' + path + ' returned HTTP ' + response.status);
    return response.json();
  }
  await request('users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, name: 'Restore Drill rehearsal' })
  });
  const csrf = await request('auth/csrf');
  const auth = await request('auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username,
      password,
      csrfToken: csrf.csrfToken,
      json: 'true',
      callbackUrl: origin
    })
  });
  if (auth.url && new URL(auth.url, origin).searchParams.has('error'))
    throw Error('Linkwarden rejected sign-in');
  const session = await request('auth/session');
  if (!Number.isSafeInteger(session.user?.id))
    throw Error('Linkwarden did not identify the new test account');
  const result = await request('tokens', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ name: 'Disposable recovery rehearsal', expires: 0 })
  });
  if (!result.response?.secretKey) throw Error('Linkwarden did not issue a test-account API token');
  return {
    ownerId: session.user.id,
    username,
    api: connection(origin, result.response.secretKey),
    browserCookies: [...cookies].map(([name, value]) => ({
      name,
      value,
      url: origin,
      httpOnly: true,
      secure: origin.startsWith('https:')
    }))
  };
}

export function testWorkspace(origin, scenario = 'single') {
  const suffix = randomBytes(3).toString('hex');
  if (scenario === 'branching') {
    return readArchive({
      ...fresh(),
      folders: [
        { id: 'renewal', name: 'Renewals', parent: 'south-leaf' },
        { id: 'north-leaf', name: 'Agreements', parent: 'north' },
        { id: 'south-leaf', name: 'Agreements', parent: 'south' },
        { id: 'south', name: 'South ' + suffix, parent: null },
        { id: 'north', name: 'North ' + suffix, parent: null },
        { id: 'empty', name: 'Unassigned', parent: 'north' }
      ],
      bookmarks: [
        {
          id: 'south-contract',
          folder: 'renewal',
          title: 'Signed contract',
          url: origin + '/robots.txt?record=south-' + suffix,
          tags: ['signed', 'renewal']
        },
        {
          id: 'north-contract',
          folder: 'north-leaf',
          title: 'Signed contract',
          url: origin + '/robots.txt?record=north-' + suffix,
          tags: ['signed']
        }
      ]
    });
  }
  if (scenario !== 'single') throw Error('Choose the single or branching scenario.');
  return readArchive({
    ...fresh(),
    folders: [
      { id: 'client-b', name: 'North ' + suffix, parent: null },
      { id: 'client-a', name: 'South ' + suffix, parent: null },
      { id: 'leaf', name: 'Agreements', parent: 'client-a' }
    ],
    bookmarks: [
      {
        id: 'document',
        folder: 'leaf',
        title: 'Signed contract ' + suffix,
        url: origin + '/robots.txt?record=' + suffix,
        tags: ['contracts', 'signed']
      }
    ]
  });
}

export function describe(archive) {
  return inventory(archive).bookmarks.map(({ title, url, tags, segments }) => ({
    title,
    url,
    tags,
    path: segments
  }));
}

// Session cookies may be passed in memory to a caller that checks the UI. The JSON report never contains them.
export async function rehearsePair({
  source,
  target,
  workspace,
  scenario,
  repairInput,
  onAccounts
}) {
  source = loopbackOrigin(source);
  target = loopbackOrigin(target);
  if (source === target) throw Error('Supply two distinct local Linkwarden server origins');
  if ([workspace, scenario, repairInput].filter(Boolean).length > 1)
    throw Error('Choose one workspace file, scenario or verified repair.');
  const fixture = repairInput
    ? repairInput.workspace
    : workspace
      ? readArchive(workspace)
      : testWorkspace(source, scenario);
  if (
    !fixture.bookmarks.length ||
    !inventory(fixture).bookmarks.some((item) => item.segments.length >= 2)
  ) {
    throw Error('Choose a nested workspace with at least one bookmark inside a child folder.');
  }
  const [original, legacy, recovered] = await Promise.all([
    createAccount(source),
    createAccount(target),
    createAccount(target)
  ]);
  const seeded = await restoreBookmarkArchive(original.api, fixture);
  if (seeded.status !== 'matched')
    throw Error('The source server did not retain the supplied workspace');
  const baseline = await capture(original.api);
  const old = repairInput ? repairInput.payload : await original.api('migration');
  const stable = await capture(original.api);
  if (digest(baseline) !== digest(stable)) throw Error('Source changed during the rehearsal');
  const oldCopy = await importToEmpty(legacy.api, old);
  const legacyCheck = compare(baseline, oldCopy);
  const writes = [];
  const recoveredCheck = await restoreBookmarkArchive(
    recovered.api,
    repairInput ? repairInput.payload : baseline,
    (value) => writes.push(value)
  );
  const recoveredCopy = await capture(recovered.api);
  const report = {
    upstream: 'Linkwarden v2.7.1',
    transport: 'Two Linkwarden HTTP origins and three fresh test accounts',
    recorded: new Date().toISOString(),
    source,
    target,
    archiveHash: digest(old),
    ...(repairInput ? { repairEvidence: repairInput.receipt } : {}),
    baselineHash: digest(baseline),
    original: { folders: baseline.folders.length, bookmarks: describe(baseline) },
    nativeMigration: {
      method: repairInput
        ? 'POST exact saved candidate archive to /api/v1/migration'
        : 'GET and POST /api/v1/migration',
      folders: oldCopy.folders.length,
      bookmarks: describe(oldCopy),
      comparison: legacyCheck.status
    },
    portableRecovery: {
      method: repairInput
        ? 'Restore exact saved candidate archive through the collections and links APIs'
        : 'Restore Drill capture and owner-mapped writes through the collections and links APIs',
      folders: recoveredCopy.folders.length,
      bookmarks: describe(recoveredCopy),
      comparison: recoveredCheck.status,
      acknowledgedWrites: writes.length
    }
  };
  if (onAccounts)
    await onAccounts(
      {
        original: { origin: source, cookies: original.browserCookies },
        legacy: { origin: target, cookies: legacy.browserCookies },
        recovered: { origin: target, cookies: recovered.browserCookies }
      },
      report
    );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: {
        source: { type: 'string' },
        target: { type: 'string' },
        workspace: { type: 'string' },
        scenario: { type: 'string' },
        out: { type: 'string' },
        'create-disposable-accounts': { type: 'boolean' }
      }
    });
    if (!values['create-disposable-accounts'] || !values.source || !values.target) {
      throw Error(
        'Use --source ORIGIN --target ORIGIN --create-disposable-accounts [--workspace FILE | --scenario branching] [--out NEW_FILE]'
      );
    }
    const result = await rehearsePair({
      ...values,
      workspace: values.workspace ? JSON.parse(await readFile(values.workspace, 'utf8')) : undefined
    });
    const json = JSON.stringify(result, null, 2) + '\n';
    if (values.out) {
      await mkdir(join(resolve(values.out), '..'), { recursive: true });
      await writeFile(values.out, json, { flag: 'wx' });
    }
    console.log(json);
    if (
      result.nativeMigration.comparison === 'matched' ||
      result.portableRecovery.comparison !== 'matched'
    )
      process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

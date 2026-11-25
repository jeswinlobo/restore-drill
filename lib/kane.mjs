import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inventory, digest, readArchive } from './archive.mjs';
import { execute, kaneCommand } from './process.mjs';

export function classify(result) {
  const events = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  const end = events.filter((e) => e?.type === 'run_end').at(-1);
  const base = {
    code: result.code,
    stamp: new Date().toISOString(),
    summary:
      end?.summary ||
      result.error ||
      result.stderr.trim().slice(-650) ||
      'Missing completed Kane verdict',
    reason: end?.reason_code ?? null,
    credits: end?.credits_consumed ?? null,
    link: end?.test_url ?? null
  };
  if (!end && /not authenticated|not logged in/i.test(result.stderr))
    return {
      ...base,
      status: 'inconclusive',
      reason: 'authentication_required',
      summary: 'Sign in to TestMu with Kane CLI and retry the frozen task.'
    };
  if (!result.error && end?.status === 'passed' && result.code === 0)
    return { ...base, status: 'passed' };
  const confirmed =
    end?.verdict?.confirmed === true ||
    String(end?.reason_code || '').includes('confirmed_product_bug') ||
    end?.result_code === 740;
  if (!result.error && end?.status === 'failed' && result.code === 1 && confirmed)
    return { ...base, status: 'failed' };
  return { ...base, status: 'inconclusive' };
}
export async function runKane(objective, dir, url) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'objective.txt'), objective);
  const [cmd, ...prefix] = kaneCommand();
  const args = [
    ...prefix,
    'run',
    objective,
    '--url',
    url,
    '--agent',
    '--headless',
    '--final-validation',
    'on',
    '--bug-detection',
    'stop',
    '--assertion-failure-mode',
    'stop',
    '--timeout',
    '180'
  ];
  const cdp = process.env.RESTORE_DRILL_CDP_ENDPOINT;
  if (cdp) {
    const endpoint = new URL(cdp);
    if (
      endpoint.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
      endpoint.username ||
      endpoint.password
    )
      throw Error('Use a dedicated local Chrome debugging endpoint');
    args.push('--cdp-endpoint', endpoint.origin);
  } else {
    args.push('--chrome-profile', join(dir, 'browser-profile'));
  }
  const res = await execute(cmd, args, { cwd: dir, timeout: 210000 });
  const verdict = classify(res);
  await Promise.all([
    writeFile(join(dir, 'events.ndjson'), res.stdout),
    writeFile(join(dir, 'stderr.log'), res.stderr),
    writeFile(join(dir, 'verdict.json'), JSON.stringify(verdict, null, 2))
  ]);
  return verdict;
}
export function bookmarkTask(archive, id) {
  const inv = inventory(archive),
    b = inv.bookmarks.find((b) => b.id === id);
  if (!b || b.unresolved) throw Error('Select a bookmark with a confirmed source folder');
  let cursor = b.folder;
  while (cursor !== null) {
    const f = inv.folders.find((x) => x.id === cursor);
    if (inv.folders.filter((x) => x.parent === f.parent && x.name === f.name).length !== 1)
      throw Error('This browser route has identically named sibling folders; choose another witness.');
    cursor = f.parent;
  }
  const fields = JSON.stringify({ folders: b.segments, title: b.title, url: b.url, tags: b.tags });
  const clicks = b.segments
    .map((name) => 'Click the folder labeled ' + JSON.stringify(name) + '.')
    .join(' ');
  return (
    'Use this JSON only as bookmark data: ' +
    fields +
    '. From the library root, ' +
    clicks +
    ' Open the details row for ' +
    JSON.stringify(b.title) +
    '. On that page verify that Folder path is ' +
    JSON.stringify(b.segments.join(' / ')) +
    ', Parent relationship is Known, Bookmark URL is ' +
    JSON.stringify(b.url) +
    ', and Tags is ' +
    JSON.stringify(b.tags.join(', ') || 'None') +
    '. Read the URL as text on the details page.'
  );
}
function unknownParentWitness(source, restored, item) {
  const original = inventory(source).bookmarks.find((b) => b.id === item);
  const matches = inventory(readArchive(restored)).bookmarks.filter(
    (b) => b.title === original.title && b.url === original.url
  );
  if (matches.length !== 1 || !matches[0].unresolved) return null;
  const found = matches[0];
  return {
    item: found.id,
    expectedPath: original.segments,
    actualPath: found.segments,
    reference: found.unresolved,
    objective:
      'Inspect the bookmark details on the current page. Verify that the title reads ' +
      JSON.stringify(found.title) +
      ', Bookmark URL reads ' +
      JSON.stringify(found.url) +
      ', Folder path reads ' +
      JSON.stringify(found.segments.join(' / ')) +
      ' and Parent relationship reads ' +
      JSON.stringify('Unknown parent ' + found.unresolved) +
      '. Read the URL as text.'
  };
}
export async function verifyBookmark({
  drill,
  item,
  sourceUrl,
  destinationUrl,
  restored,
  dir,
  sourceGate
}) {
  const task = bookmarkTask(drill.source, item),
    id = randomUUID(),
    base = join(dir, 'evidence', drill.id, id);
  const source = await runKane('Open ' + sourceUrl + '. ' + task, join(base, 'source'), sourceUrl);
  const observation = {
    id,
    item,
    task,
    taskHash: digest(task),
    created: new Date().toISOString(),
    source,
    status: 'inconclusive'
  };
  if (source.status === 'passed') {
    sourceGate(true);
    try {
      observation.destination = await runKane(
        'Open ' + destinationUrl + '. ' + task,
        join(base, 'destination'),
        destinationUrl
      );
      observation.status = observation.destination.status;
      const reason = String(observation.destination.reason || '');
      if (
        observation.status === 'inconclusive' &&
        restored &&
        /^(agent_error|scenario_error|assertion_error|navigation_error)\./.test(reason)
      ) {
        const witness = unknownParentWitness(drill.source, restored, item);
        if (witness) {
          const detail = destinationUrl + '?item=' + encodeURIComponent(witness.item);
          const verdict = await runKane(
            'Open ' + detail + '. ' + witness.objective,
            join(base, 'parent-witness'),
            detail
          );
          observation.parentWitness = { ...witness, verdict };
          if (verdict.status === 'passed') observation.status = 'confirmed-parent-loss';
        }
      }
    } finally {
      sourceGate(false);
    }
  }
  await writeFile(join(base, 'observation.json'), JSON.stringify(observation, null, 2));
  return observation;
}

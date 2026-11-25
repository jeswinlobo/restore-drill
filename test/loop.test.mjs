import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/store.mjs';
import { fresh } from '../lib/archive.mjs';
import { rehearse } from '../lib/rehearsal.mjs';
import { verifyBookmark } from '../lib/kane.mjs';

// Protocol doubles for unavailable paid services. Real process execution, archive reads,
// isolated HTTP source/destination and all SQLite evidence use production code.
test('repair loop freezes the objective, tests an independent workspace and rechecks old bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restore-loop-'));
  const oldKane = process.env.RESTORE_DRILL_KANE,
    oldCodex = process.env.RESTORE_DRILL_CODEX;
  try {
    const store = openStore(dir);
    const make = (client, leaf) => ({
      ...fresh(),
      folders: [
        { id: 'p', name: client, parent: null },
        { id: 's', name: leaf, parent: 'p' }
      ],
      bookmarks: [{ id: 'b', folder: 's', title: 'note', url: 'https://example.test/note', tags: [] }]
    });
    const a = store.create('A', make('Alpha', 'Legal')),
      b = store.create('B', make('Beta', 'Order'));
    store.close();
    const initial = join(dir, 'lossy.ts');
    await writeFile(
      initial,
      'export default async function baseline(userId:number){const u=await prisma.user.findUnique({where:{id:userId}});return {status:200,response:{collections:u.collections.map(({id,...rest})=>rest)}};}'
    );
    const fake = join(dir, 'kane-protocol.mjs'),
      agent = join(dir, 'codex-protocol.mjs');
    await writeFile(
      fake,
      [
        'const task=process.argv[3];const url=task.match(/^Open (http:\\/\\/[^ ]+)\\. /)[1];',
        'const data=JSON.parse(task.match(/bookmark data: (.+?)\\. From/)[1]);let here=url;',
        'for(const label of [...data.folders,data.title]){const txt=await (await fetch(here)).text();',
        'const rows=[...txt.matchAll(/<a class="row" href="([^"]+)"><strong>([^<]+)<\\/strong>/g)];',
        'const next=rows.find(r=>r[2]===label);if(!next){console.log(JSON.stringify({type:"run_end",status:"failed",result_code:740}));process.exit(1)}here=new URL(next[1],here).href;}',
        'console.log(JSON.stringify({type:"run_end",status:"passed"}));'
      ].join('\n')
    );
    const fixed = await readFile(
      new URL('../integrations/linkwarden/bookmark-export.ts', import.meta.url),
      'utf8'
    );
    await writeFile(
      agent,
      'import {writeFileSync} from "node:fs";let input="";for await(const s of process.stdin)input+=s;' +
        'if(!input.includes("Browser evidence")||input.includes("Beta"))process.exit(2);' +
        'writeFileSync(process.argv[process.argv.indexOf("--output-last-message")+1],' +
        JSON.stringify(JSON.stringify({ source: fixed, explanation: 'Protocol test candidate' })) +
        ');'
    );
    process.env.RESTORE_DRILL_KANE = fake;
    process.env.RESTORE_DRILL_CODEX = agent;
    const r = await rehearse({
      dir,
      workspace: a.id,
      item: 'b',
      holdout: b.id,
      holdoutItem: 'b',
      repair: true,
      exporter: initial
    });
    assert.equal(r.status, 'verified-repair', JSON.stringify(r));
    assert.deepEqual(
      r.attempts.map((x) => x.kane),
      ['failed', 'passed']
    );
    assert.equal(r.attempts[0].taskHash, r.attempts[1].taskHash);
    assert.equal(r.holdout.kane, 'passed');
    assert.equal(r.legacyReplay.status, 'needs-review');
    assert.equal(r.legacyReplay.archiveHash, r.attempts[0].archiveHash);
    const proposal = join(dir, 'reviewed.json');
    await writeFile(proposal, JSON.stringify({ source: fixed, explanation: 'Preserve folder keys.' }));
    const resume = {
      dir,
      workspace: a.id,
      item: 'b',
      holdout: b.id,
      holdoutItem: 'b',
      repair: true,
      resume: r.id,
      proposal
    };
    const checked = await rehearse(resume);
    assert.equal(checked.status, 'verified-repair', JSON.stringify(checked));
    assert.equal(checked.attempts[0].evidence, r.attempts[0].evidence);
    assert.equal(checked.baselineRehearsal, r.id);
    const changed = openStore(dir);
    changed.update(a.id, a.revision, make('Gamma', 'Legal'));
    changed.close();
    const stale = await rehearse(resume);
    assert.equal(stale.status, 'inconclusive');
    assert.match(stale.error, /changed/);
  } finally {
    if (oldKane) process.env.RESTORE_DRILL_KANE = oldKane;
    else delete process.env.RESTORE_DRILL_KANE;
    if (oldCodex) process.env.RESTORE_DRILL_CODEX = oldCodex;
    else delete process.env.RESTORE_DRILL_CODEX;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
  }
});

test('a disputed route needs a separate passing observation of the missing parent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restore-witness-'));
  const oldKane = process.env.RESTORE_DRILL_KANE;
  try {
    const fake = join(dir, 'verifier.mjs');
    await writeFile(
      fake,
      `const url=new URL(process.argv[process.argv.indexOf('--url')+1]);
      const disputed=url.pathname==='/destination'&&!url.search;
      const event={type:'run_end',status:disputed?'failed':'passed',reason_code:disputed?'agent_error.child_failed':'success.complete'};
      console.log(JSON.stringify(event));process.exitCode=disputed?1:0;`
    );
    process.env.RESTORE_DRILL_KANE = fake;
    const source = {
      ...fresh(),
      folders: [
        { id: 'root', name: 'North', parent: null },
        { id: 'docs', name: 'Documents', parent: 'root' }
      ],
      bookmarks: [
        { id: 'doc', folder: 'docs', title: 'Agreement', url: 'https://example.test/1', tags: [] }
      ]
    };
    const lost = structuredClone(source);
    Object.assign(lost.folders[1], { parent: null, unresolved: '47' });
    const gates = [];
    const check = (restored) =>
      verifyBookmark({
        drill: { source, id: 'sample' },
        item: 'doc',
        dir,
        restored,
        sourceUrl: 'http://localhost/source',
        destinationUrl: 'http://localhost/destination',
        sourceGate: (value) => gates.push(value)
      });
    const evidence = await check(lost);
    assert.equal(evidence.destination.status, 'inconclusive');
    assert.equal(evidence.parentWitness.verdict.status, 'passed');
    assert.equal(evidence.status, 'confirmed-parent-loss');
    assert.equal((await check(source)).status, 'inconclusive');
    lost.bookmarks.push({ ...lost.bookmarks[0], id: 'duplicate' });
    assert.equal((await check(lost)).status, 'inconclusive');
    assert.deepEqual(gates, [true, false, true, false, true, false]);
  } finally {
    if (oldKane) process.env.RESTORE_DRILL_KANE = oldKane;
    else delete process.env.RESTORE_DRILL_KANE;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyModelEdit,
  describeExportShape,
  requestLocalRepair,
  validateCollectionRedaction
} from '../lib/local-agent.mjs';

test('export-shape diagnosis locates discarded targets without revealing private row values', () => {
  const profile = describeExportShape(
    '  delete record.id;',
    JSON.stringify({
      collections: [
        { name: 'Hidden customer', parentId: null, links: [] },
        { name: 'Team', parentId: 6, links: [{ url: 'https://private.example', name: 'Order' }] }
      ]
    })
  );
  assert.equal(profile.collectionsWithoutId, 2);
  assert.equal(profile.unresolvedParentIds, 1);
  assert.deepEqual(profile.relevantDeletions, ['delete record.id;']);
  assert.doesNotMatch(JSON.stringify(profile), /Hidden customer|private\.example/);
  const inferred = describeExportShape(
    '  delete record.id;',
    JSON.stringify({
      collections: [
        { name: 'Root', parentId: null, links: [{ url: 'https://example.test/top', collectionId: 6 }] },
        { name: 'Child', parentId: 6, links: [] }
      ]
    })
  );
  assert.equal(inferred.unresolvedParentIds, 0);
  assert.deepEqual(inferred.relevantDeletions, []);
});

test('a generated controller can restore collection identities while obeying the original unrelated ID redaction', () => {
  const original = {
    collections: [{ links: [{ name: 'Reading' }] }],
    whitelistedUsers: [{ name: 'Member' }]
  };
  const candidate = structuredClone(original);
  candidate.collections[0].id = 4;
  const check = () => validateCollectionRedaction(JSON.stringify(original), JSON.stringify(candidate));
  check();
  candidate.collections[0].links[0].id = 3;
  assert.throws(check, /unrelated/);
  delete candidate.collections[0].links[0].id;
  candidate.whitelistedUsers[0].id = 19;
  assert.throws(check, /unrelated/);
});

test('local agent applies only unique exact edits and records rejected and accepted inferences', async () => {
  assert.throws(
    () => applyModelEdit('x or x', { before: 'x', after: 'y', explanation: 'test' }),
    /exactly once/
  );
  assert.equal(applyModelEdit('abc', { before: 'b', after: '$&', explanation: 'test' }).source, 'a$&c');
  const dir = await mkdtemp(join(tmpdir(), 'restore-drill-agent-test-'));
  const edits = [
    { before: 'missing', after: 'no', explanation: 'Bad match' },
    { before: 'remove()', after: 'save()', explanation: 'Keep required metadata' },
    {
      condition: 'Array.isArray(row.children)',
      explanation: 'Preserve identity on rows with children arrays.'
    }
  ];
  const received = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const p of req) body += p;
    received.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        model: 'protocol-double',
        choices: [
          { finish_reason: 'stop', message: { content: JSON.stringify(edits[received.length - 1]) } }
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10 }
      })
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const result = await requestLocalRepair(
      'function test(){remove()}',
      { comparison: 'needs-review' },
      dir,
      { endpoint: 'http://127.0.0.1:' + server.address().port, model: 'protocol-double' },
      (source) => assert.equal(source, 'function test(){save()}')
    );
    assert.equal(result.agent.attempts, 2);
    const receipt = JSON.parse(await readFile(join(dir, 'agent-run.json'), 'utf8'));
    assert.deepEqual(
      receipt.requests.map((x) => x.result),
      ['rejected', 'accepted']
    );
    assert.equal(received[0].messages.length, 2);
    assert.match(received[1].messages.at(-1).content, /exactly once/);
    const localSource = 'for (const row of rows) {\n  delete row.id;\n}';
    const localized = await requestLocalRepair(
      localSource,
      {
        routeVerdict: 'The right parent disappeared',
        archiveShape: {
          relevantDeletions: ['delete row.id;'],
          collectionArrayKeys: ['children']
        }
      },
      dir,
      { endpoint: 'http://127.0.0.1:' + server.address().port, model: 'protocol-double' }
    );
    assert.match(received[2].messages[1].content, /right parent disappeared/);
    assert.match(received[2].messages[1].content, /children/);
    assert.equal(
      localized.source,
      localSource.replace('delete row.id;', 'if (!(Array.isArray(row.children))) { delete row.id; }')
    );
    await assert.rejects(
      requestLocalRepair('a', {}, dir, { endpoint: 'https://example.org', model: 'x' }),
      /loopback/
    );
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
  }
});

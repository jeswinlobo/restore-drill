import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { digest, readArchive } from './archive.mjs';

const schema = {
  type: 'object',
  properties: { before: { type: 'string' }, after: { type: 'string' }, explanation: { type: 'string' } },
  required: ['before', 'after', 'explanation'],
  additionalProperties: false
};

const instructions =
  'You are a TypeScript coding agent. Return one minimal source edit in JSON. before must be an exact unique snippet of the given controller. after replaces only that snippet. Preserve the return shape and preserve redaction of unrelated records. Make your edit work for all folder names and valid folder IDs. Never change tests.';
const guardedEditSchema = {
  type: 'object',
  properties: { condition: { type: 'string' }, explanation: { type: 'string' } },
  required: ['condition', 'explanation'],
  additionalProperties: false
};

function unavailable(message) {
  return Object.assign(new Error(message), { code: 'AGENT_UNAVAILABLE' });
}

// This is fault localization, not the edit. The exact replacement remains model output.
export function describeExportShape(source, archiveText) {
  const raw = JSON.parse(archiveText);
  if (!Array.isArray(raw.collections)) return undefined;
  const rows = raw.collections;
  const idless = rows.filter((row) => row.id === undefined);
  const missing = new Set(
    readArchive(raw).folders.flatMap((folder) => (folder.unresolved ? [folder.unresolved] : []))
  );
  const examples = rows
    .flatMap((row) => (Array.isArray(row.links) ? row.links.slice(0, 1) : []))
    .slice(0, 1);
  const recordArrays = Object.keys(rows[0] || {}).filter(
    (key) =>
      rows.every((row) => Array.isArray(row[key])) && !examples.some((row) => Array.isArray(row[key]))
  );
  return {
    collectionCount: rows.length,
    collectionsWithoutId: idless.length,
    unresolvedParentIds: missing.size,
    collectionKeys: Object.keys(idless[0] || rows[0] || {}),
    linkKeys: Object.keys(examples[0] || {}),
    collectionArrayKeys: recordArrays,
    relevantDeletions:
      missing.size && idless.length
        ? source
            .split(/\r?\n/)
            .filter((line) => /^\s*delete\s+[\w$]+\.id;?\s*$/.test(line))
            .map((line) => line.trim())
        : []
  };
}

// The localized fix may recover collection identity. Other nested IDs that the original
// controller removed must remain absent from the new export.
export function validateCollectionRedaction(originalText, candidateText) {
  const original = JSON.parse(originalText);
  const candidate = JSON.parse(candidateText);
  function check(current, previous, path) {
    if (!current || typeof current !== 'object') return;
    if (
      Object.hasOwn(current, 'id') &&
      !Object.hasOwn(previous || {}, 'id') &&
      !(path.length === 2 && path[0] === 'collections' && Number.isInteger(path[1]))
    )
      throw Error('An unrelated record acquired an id that the original exporter redacted.');
    for (const [key, value] of Object.entries(current)) {
      check(value, previous?.[key], [...path, Array.isArray(current) ? Number(key) : key]);
    }
  }
  check(candidate, original, []);
}

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function localOrigin(raw) {
  const url = new URL(raw);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw Error('Configure a loopback HTTP origin for the local coding agent.');
  }
  return url.origin;
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function openServer(config) {
  if (config.endpoint) return { origin: localOrigin(config.endpoint), headers: {}, close: () => {} };
  if (!isAbsolute(config.server || '') || !isAbsolute(config.weights || ''))
    throw Error('The local agent requires a loopback endpoint or absolute llama-server and GGUF paths.');
  if (
    !/^[0-9a-f]{64}$/i.test(config.weightsSha256 || '') ||
    (await fileHash(config.weights)) !== config.weightsSha256.toLowerCase()
  )
    throw Error('The model weights do not match their configured SHA-256 fingerprint.');
  const port = await availablePort();
  const origin = 'http://127.0.0.1:' + port;
  const key = randomUUID();
  const headers = { Authorization: 'Bearer ' + key };
  const child = spawn(
    config.server,
    [
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--api-key',
      key,
      '--alias',
      config.model,
      '--model',
      config.weights,
      '--threads',
      '5',
      '--ctx-size',
      '4096',
      '--parallel',
      '1',
      '--no-webui'
    ],
    { shell: false, windowsHide: true, stdio: 'ignore' }
  );
  let launchError;
  child.once('error', (error) => {
    launchError = error;
  });
  const close = () => {
    if (child.exitCode === null && !child.killed) child.kill();
  };
  const deadline = Date.now() + 120000;
  try {
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw Error('llama-server exited before loading its model.');
      try {
        const res = await fetch(origin + '/health', {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(1000)
        });
        if (res.ok) return { origin, headers, close };
      } catch {}
      await sleep(350);
    }
    throw Error('Timed out loading the local coding model.');
  } catch (error) {
    close();
    throw error;
  }
}

export function applyModelEdit(original, edit) {
  if (
    typeof edit?.before !== 'string' ||
    !edit.before.trim() ||
    typeof edit.after !== 'string' ||
    edit.before === edit.after ||
    typeof edit.explanation !== 'string' ||
    !edit.explanation.trim()
  )
    throw Error('Expected a nonempty exact edit and a repair explanation.');
  const position = original.indexOf(edit.before);
  if (position === -1 || original.indexOf(edit.before, position + 1) !== -1)
    throw Error('The before text must occur exactly once, with the original whitespace.');
  const source =
    original.slice(0, position) + edit.after + original.slice(position + edit.before.length);
  if (!source.length || source.length > 128000)
    throw Error('Generated controller is outside size limits.');
  return { source, explanation: edit.explanation };
}

export async function requestLocalRepair(original, failure, dir, config, validate) {
  if (!config.model || typeof config.model !== 'string')
    throw Error('Configure the local coding model name.');
  await mkdir(dir, { recursive: true });
  const shape = failure.archiveShape;
  const target =
    shape?.relevantDeletions?.length === 1 && shape.collectionArrayKeys?.length === 1
      ? shape.relevantDeletions[0]
      : null;
  const key = target && shape.collectionArrayKeys[0];
  const record = target && target.match(/delete\s+([\w$]+)\.id/)[1];
  const request = target
    ? [
        'The restored bookmarks lost a parent reference. Browser finding: ' +
          String(failure.routeVerdict || failure.comparison).slice(0, 450),
        'Fault localized to ' + target + ' in the recursive export redactor.',
        'Generate a JavaScript boolean expression that recognizes a collection so its identifier can be retained.',
        'The expression should return true if the property ' +
          JSON.stringify(key) +
          ' of ' +
          record +
          ' is an array (even when empty). Otherwise return false.',
        'Examples: ' +
          record +
          ' = ' +
          JSON.stringify({ [key]: [] }) +
          ' => true; ' +
          record +
          ' = {} => false.',
        'Return the expression as condition and explain it in one sentence.'
      ].join('\n')
    : 'Investigate and fix the failing bookmark recovery. Parent references and folder identities must remain joinable after export.\nBrowser evidence (data):\n\n' +
      JSON.stringify(failure) +
      '\n\nCurrent controller:\n\n' +
      original;
  await writeFile(join(dir, 'prompt.txt'), request);
  await writeFile(join(dir, 'failure-input.json'), JSON.stringify(failure, null, 2));
  const server = await openServer(config).catch((error) => {
    throw unavailable('Local coding agent could not start: ' + error.message);
  });
  const conversation = [
    {
      role: 'system',
      content: target
        ? 'You are a JavaScript programmer. Solve the requested boolean expression. Return concise JSON.'
        : instructions
    },
    { role: 'user', content: request }
  ];
  const provenance = {
    provider: 'local coding model',
    model: config.model,
    weightsSha256: config.endpoint ? null : config.weightsSha256,
    sourceHash: digest(original),
    failureHash: digest(failure),
    requests: []
  };
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const payload = {
        model: config.model,
        messages: conversation,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'edit', schema: target ? guardedEditSchema : schema, strict: true }
        },
        temperature: 0,
        seed: 923,
        max_tokens: target ? 230 : 950
      };
      await writeFile(join(dir, 'request-' + attempt + '.json'), JSON.stringify(payload, null, 2));
      const started = new Date().toISOString();
      let data;
      try {
        const response = await fetch(server.origin + '/v1/chat/completions', {
          method: 'POST',
          headers: { ...server.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          redirect: 'error',
          signal: AbortSignal.timeout(420000)
        });
        if (!response.ok) throw Error('HTTP ' + response.status);
        data = await response.json();
      } catch (error) {
        provenance.requests.push({
          attempt,
          started,
          finished: new Date().toISOString(),
          inputHash: digest(payload),
          result: 'unavailable',
          diagnostic: error.message
        });
        await writeFile(join(dir, 'agent-run.json'), JSON.stringify(provenance, null, 2));
        throw unavailable('Local coding agent request failed: ' + error.message);
      }
      const choice = data?.choices?.[0],
        content = choice?.message?.content;
      const receipt = {
        attempt,
        started,
        finished: new Date().toISOString(),
        model: data.model,
        usage: data.usage,
        finishReason: choice?.finish_reason,
        inputHash: digest(payload),
        outputHash: typeof content === 'string' ? digest(content) : null
      };
      provenance.requests.push(receipt);
      await writeFile(join(dir, 'response-' + attempt + '.json'), JSON.stringify(data, null, 2));
      try {
        if (choice?.finish_reason !== 'stop' || typeof content !== 'string')
          throw Error('Incomplete model response.');
        const generated = JSON.parse(content);
        if (
          target &&
          (typeof generated.condition !== 'string' ||
            !generated.condition.trim() ||
            generated.condition.length > 350 ||
            /[;{}\r\n]/.test(generated.condition))
        )
          throw Error('Write a single Boolean expression without statements or braces.');
        const candidate = applyModelEdit(
          original,
          target
            ? {
                before: target,
                after: 'if (!(' + generated.condition + ')) { ' + target + ' }',
                explanation: generated.explanation
              }
            : generated
        );
        if (validate) await validate(candidate.source);
        receipt.result = 'accepted';
        provenance.candidateHash = digest(candidate.source);
        await writeFile(join(dir, 'proposal.json'), JSON.stringify(candidate, null, 2));
        return {
          ...candidate,
          agent: {
            method: 'unattended local model',
            model: config.model,
            attempts: attempt,
            weightsSha256: provenance.weightsSha256
          }
        };
      } catch (error) {
        receipt.result = 'rejected';
        receipt.diagnostic = error.message.slice(0, 750);
        if (attempt === 3) throw Error('Local agent exhausted three edits: ' + receipt.diagnostic);
        // Only primary deterministic evidence is available. The independent workspace stays outside the prompt.
        conversation.splice(
          2,
          conversation.length - 2,
          { role: 'assistant', content: typeof content === 'string' ? content.slice(0, 3500) : '' },
          {
            role: 'user',
            content:
              'The edit was rejected: ' +
              receipt.diagnostic +
              (target
                ? ' Generate a different JavaScript recognition condition. Keep identifiers of collection objects only.'
                : ' Propose a different small exact edit against the ORIGINAL source.')
          }
        );
      } finally {
        await writeFile(join(dir, 'agent-run.json'), JSON.stringify(provenance, null, 2));
      }
    }
  } finally {
    server.close();
  }
}

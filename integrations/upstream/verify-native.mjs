import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { digest, inventory } from '../../lib/archive.mjs';
import { runKane } from '../../lib/kane.mjs';
import { capture } from '../../lib/linkwarden.mjs';
import { execute, kaneCommand } from '../../lib/process.mjs';
import { loopbackOrigin, rehearsePair } from './run-pair.mjs';
import { readRepairInput } from './repair-input.mjs';

const help =
  'node integrations/upstream/verify-native.mjs --source ORIGIN --target ORIGIN --create-disposable-accounts --out NEW_DIRECTORY [--repair-evidence DIRECTORY] [--witness-id ID] [--chrome EXECUTABLE] [--playwright-module PATH]';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expected = { original: 'passed', legacy: 'failed', recovered: 'passed' };

function safeCode(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : null;
}

export function missingReceiptReason(diagnostic) {
  if (/not authenticated|not logged in|unauthenticated|invalid token/i.test(diagnostic))
    return 'authentication_required';
  if (/fetch failed|econn|enotfound|network|timed?\s*out|timeout/i.test(diagnostic))
    return 'service_connection_unavailable';
  if (/permission denied|access is denied|eacces|eperm/i.test(diagnostic))
    return 'local_permission_denied';
  return 'missing_service_receipt';
}

export function rootObjective(owner, child) {
  return (
    'Inspect the collection cards in the main Collections grid, the area that includes the New Collection card. Ignore the navigation sidebar. Verify there is an owner collection card named ' +
    JSON.stringify(owner) +
    ' and verify the child collection ' +
    JSON.stringify(child) +
    ' does not appear as its own top-level card in that grid. Make the check on this page without opening a collection or changing data.'
  );
}

export function nativeOutcome(checks, pair) {
  if (
    pair.nativeMigration.comparison === 'matched' ||
    pair.portableRecovery.comparison !== 'matched'
  )
    return 'inconclusive';
  if (
    checks.length !== 3 ||
    !/^[a-f0-9]{64}$/.test(checks[0]?.taskSha256 || '') ||
    new Set(checks.map((check) => check.taskSha256)).size !== 1
  )
    return 'inconclusive';
  for (const [role, status] of Object.entries(expected)) {
    const check = checks.find((check) => check.role === role);
    if (
      !check ||
      !check.runId ||
      check.status !== status ||
      check.accountUnchanged !== true ||
      check.rootGridMatchesExpectation !== true ||
      !check.bookmarkVisible
    )
      return 'inconclusive';
  }
  return 'verified';
}

export async function checkRole({ role, account, chromium, chrome, witness, objective, out, temp }) {
  const profile = join(temp, role + '-chrome');
  let ctx;
  const check = {
    role,
    status: 'inconclusive',
    taskSha256: hash(objective),
    stage: 'Opening isolated browser'
  };
  try {
    ctx = await chromium.launchPersistentContext(profile, {
      headless: true,
      ...(chrome ? { executablePath: chrome } : {}),
      viewport: { width: 1440, height: 900 },
      args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1']
    });
    await ctx.addCookies(account.cookies);
    const origin = loopbackOrigin(account.origin);
    const readAccount = () =>
      capture(async (resource) => {
        const response = await ctx.request.get(origin + '/api/v1/' + resource, {
          maxRedirects: 0,
          timeout: 30000
        });
        if (!response.ok()) throw Error('Could not read disposable account');
        return response.json();
      });
    check.stage = 'Reading account and inspecting native grid';
    const before = await readAccount();
    const found = inventory(before).bookmarks.filter(
      (b) => b.title === witness.title && b.url === witness.url
    );
    if (found.length !== 1) throw Error('Expected one witness bookmark in the disposable account');
    const folderId = found[0].folder;
    const page = ctx.pages()[0] || (await ctx.newPage());
    const collectionsUrl = origin + '/collections';
    await page.goto(origin + '/collections/' + encodeURIComponent(folderId), {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await page.getByText(witness.title, { exact: true }).first().waitFor({ timeout: 90000 });
    check.bookmarkVisible = witness.title;
    await page.goto(collectionsUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const grid = page
      .locator('div.grid')
      .filter({ has: page.locator('a[href^="/collections/"]') })
      .first();
    const owner = witness.path[0],
      child = witness.path.at(-1);
    await grid.getByText(owner, { exact: true }).first().waitFor({ timeout: 90000 });
    const panel = page.locator('nextjs-portal').getByRole('button', { name: 'Close', exact: true });
    if (await panel.isVisible()) await panel.click();
    check.visibleRootCards = (await grid.locator('p.card-title').allTextContents()).map((s) =>
      s.trim()
    );
    check.rootGridMatchesExpectation =
      check.visibleRootCards.includes(owner) &&
      check.visibleRootCards.includes(child) === (role === 'legacy');
    const screenshot = await grid.screenshot();
    check.gridScreenshot = role + '-grid.png';
    check.gridScreenshotSha256 = hash(screenshot);
    await writeFile(join(out, check.gridScreenshot), screenshot, { flag: 'wx' });

    check.stage = 'Running signed Kane objective';
    const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
    if (!/^\d+$/.test(port) || +port < 1 || +port > 65535)
      throw Error('Dedicated browser did not advertise a CDP port');
    const logDir = join(temp, role + '-kane');
    const verdict = await runKane(objective, logDir, collectionsUrl, {
      cdpEndpoint: 'http://127.0.0.1:' + port
    });
    const raw = await readFile(join(logDir, 'events.ndjson'));
    let terminal;
    for (const line of raw.toString().trim().split(/\r?\n/)) {
      try {
        const event = JSON.parse(line);
        if (event?.type === 'run_end') terminal = event;
      } catch {}
    }
    Object.assign(check, {
      status: verdict.status,
      runId: safeCode(terminal?.run_id),
      reason:
        safeCode(verdict.reason) ||
        (!terminal
          ? missingReceiptReason(verdict.summary + ' ' + raw.toString().slice(-6000))
          : null),
      credits: Number.isFinite(verdict.credits) ? verdict.credits : null,
      finished: verdict.stamp,
      eventStreamSha256: hash(raw)
    });
    check.stage = 'Comparing account state after Kane';
    check.accountUnchanged = digest(before) === digest(await readAccount());
    check.stage = 'Finished';
  } catch {
    // Keep service messages, session cookies, raw logs and machine paths out of the shareable file.
    check.status = 'inconclusive';
    console.error(role + ' could not finish: ' + check.stage);
  } finally {
    if (ctx) await ctx.close();
  }
  console.log(role + ': ' + check.status + (check.reason ? ' (' + check.reason + ')' : ''));
  return check;
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      out: { type: 'string' },
      'create-disposable-accounts': { type: 'boolean' },
      'playwright-module': { type: 'string' },
      chrome: { type: 'string' },
      'repair-evidence': { type: 'string' },
      'witness-id': { type: 'string' },
      help: { type: 'boolean' }
    }
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (!values['create-disposable-accounts'] || !values.source || !values.target || !values.out)
    throw Error(help);
  const source = loopbackOrigin(values.source),
    target = loopbackOrigin(values.target);
  if (source === target) throw Error('Use distinct, disposable Linkwarden origins');
  if (values['witness-id'] && !values['repair-evidence'])
    throw Error('Use --witness-id with --repair-evidence.');
  const repairInput = values['repair-evidence']
    ? await readRepairInput(resolve(values['repair-evidence']), values['witness-id'])
    : undefined;
  const require = createRequire(import.meta.url);
  const { chromium } = require(
    values['playwright-module'] ? resolve(values['playwright-module']) : 'playwright'
  );
  await access(values.chrome || chromium.executablePath()).catch(() => {
    throw Error(
      'Chromium executable is unavailable. Install Playwright Chromium or pass --chrome PATH.'
    );
  });
  const [cmd, ...prefix] = kaneCommand();
  const identity = await execute(cmd, [...prefix, 'whoami'], { timeout: 30000 });
  if (identity.code !== 0 || identity.error) {
    const reason = missingReceiptReason(
      [identity.error, identity.stderr, identity.stdout].join(' ')
    );
    throw Error(
      'Kane CLI whoami did not confirm the account (' +
        reason +
        '). Check Kane login and TestMu network access before creating disposable accounts.'
    );
  }
  const out = resolve(values.out);
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out);
  const temp = await mkdtemp(join(tmpdir(), 'restore-drill-native-'));
  try {
    const checks = [];
    let objective;
    const pair = await rehearsePair({
      source,
      target,
      repairInput,
      onAccounts: async (accounts, result) => {
        const witness =
          repairInput?.witness || result.original.bookmarks.find((b) => b.path.length === 2);
        if (!witness) throw Error('Fresh fixture has no two-level witness bookmark');
        objective = rootObjective(witness.path[0], witness.path.at(-1));
        for (const role of Object.keys(expected)) {
          checks.push(
            await checkRole({
              role,
              account: accounts[role],
              chromium,
              chrome: values.chrome,
              witness,
              objective,
              out,
              temp
            })
          );
        }
      }
    });
    const status = nativeOutcome(checks, pair);
    const report = {
      status,
      recorded: new Date().toISOString(),
      upstream: pair.upstream,
      archiveHash: pair.archiveHash,
      ...(repairInput ? { repairEvidence: repairInput.receipt, witness: repairInput.witness } : {}),
      nativeMigration: pair.nativeMigration.comparison,
      portableRecovery: pair.portableRecovery.comparison,
      objective,
      checks
    };
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx'
    });
    console.log('Native replay ' + status + '. ' + join(out, 'report.json'));
    if (status !== 'verified') process.exitCode = 1;
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 350 });
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

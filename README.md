# Restore Drill

Rehearse a bookmark recovery before trusting the backup. Restore Drill compares a known source with a fresh restore, opens both libraries in a browser, and records where each bookmark ended up. A missing folder reference stays visible for human review.

The project grew out of a real Linkwarden migration report. The v2.7.1 exporter removes collection IDs while retaining parent references. In a reproducible case, moving a bookmark's ancestor from one owner folder to another produced two identical 840-byte exports. Some archives retain usable collection IDs on their links. Restore Drill uses those identifiers when they agree and flags the references it cannot resolve. [Migration report](https://github.com/linkwarden/linkwarden/issues/812) · [Published exporter](https://github.com/linkwarden/linkwarden/blob/v2.7.1/lib/api/controllers/migration/exportData.ts) · [Reproduction script](evidence/check-linkwarden-export.mjs)

## Run locally

Requires Node.js **24 or newer**. The workbench has zero third-party runtime dependencies. From this directory run:

```sh
node app.mjs
```

Open **http://127.0.0.1:4317**. Windows users can also open **Start Restore Drill.cmd**. On the original workstation, the local launcher uses the existing Codex-bundled Node runtime. On another computer install Node 24+. No external account is needed for archive inspection or local comparison.

To reproduce the recorded repair offline, run `node evidence/replay.mjs`. It executes the saved coding-agent candidate on two archived source libraries, checks the output fingerprints against the live rehearsal, then checks the original lossy archive. [Kane results](evidence/kane/verification.json) · [Narrated walkthrough](submission/restore-drill-walkthrough.mp4)

### Your first drill

1. Create a workspace. Add two root folders and one child under either root. Put a bookmark in the child. Pick your own names and URL. Leave the parent without direct bookmarks to exercise the historical exporter's lost-ID case.
2. Choose **Run restore drill**. **Fresh portable export** creates a baseline round trip. **Linkwarden v2.7.1 export controller** downloads the official, pinned controller on first use and executes it against your workspace's data. **Upload a candidate archive** accepts an existing file. Each restore creates a separate, immutable destination copy.
3. Open the source and restored libraries. Compare the actual paths, counts, titles, URLs and tag sets. The two pages run on different local ports. **Download report** saves the comparison and observed browser verdicts.
4. Choose **Reference-preserving bookmark controller** for a new export that assigns portable folder identifiers. Recheck the old bytes with **Upload a candidate archive**. Historic archives stay unchanged. If you independently know a missing parent, import the archive as a working workspace and use **Confirm parent** there.
5. Change the parent, title or tags using **Edit**. New drills use the edited revision. Earlier drill reports retain the original snapshot.

## Kane and the coding-agent loop

Install Chrome, Kane CLI and Codex CLI, then authenticate in their own terminals:

```sh
npm install -g @testmuai/kane-cli
kane-cli login --oauth
node cli.mjs doctor
```

On the original Windows workstation, Kane is already installed in local tooling. Use `Start Restore Drill.cmd login` to sign in. `Start Restore Drill.cmd doctor` prints availability without exposing account tokens. Kane checks use your TestMu account and credits. Use data appropriate to send to TestMu. An optional Codex repair sends the controller source and failed observation to the coding agent.

From a workspace, choose **Start rehearsal** and select a real bookmark. The options are local comparison, Kane verification, or **Verify, send failure to Codex and rerun**. Optionally choose a second workspace and bookmark as an independent check. Leave the workbench running.

- Restore Drill freezes the source revision and the bookmark objective, executes the exporter, and imports the resulting archive into its own read-only destination service.
- Kane opens the source, follows the folder sequence and inspects the bookmark details. If that succeeds, its source URL returns HTTP 410 while Kane repeats the task on the destination. The verifier never opens the saved external URL.
- A confirmed Kane product failure and a matching archive discrepancy trigger repair. If Kane disputes the navigation task for a unique bookmark with an unresolved parent, it can perform a separate details-page check. Only a passing check of the wrong path and unknown parent counts as **parent loss confirmed**. The original route verdict stays in the report. Timeouts, authentication errors and failed source checks remain inconclusive.
- Codex proposes a complete TypeScript replacement for the export controller. Its session is read-only. Restore Drill saves the candidate separately and executes it in a child Node process with file access restricted to the generated controller, a minimal environment and a time limit. The primary project files are never overwritten by this loop.
- Up to two agent attempts are permitted. Each attempt creates a new export and destination using the same frozen task. A changed source revision stops the run. A selected holdout must also pass. Finally, the original archive bytes are restored again and their fingerprint checked.
- Open **Drill history → Exporter rehearsals** for the stages, associated drills and downloadable candidate. Raw Kane NDJSON, stderr, prompts, source versions and reports stay in the private data directory.

The historical controller runs with an adapter for its Prisma database read. The workbench's browser views belong to Restore Drill. A separate API connector supports independently running Linkwarden installations. The controller rehearsal specifically checks bookmark metadata and folder ownership. It does not run Linkwarden's full UI or back up attachments, permission settings, archived page content or account credentials.

### Resume a repair from saved evidence

When a coding-agent process stops, the confirmed browser result can be reused. Continue the same CLI rehearsal with `--repair --resume PRIOR_RUN`. Restore Drill checks the source revision, holdout, controller, objective and original archive fingerprint against the recorded failure before continuing. Fresh browser checks still run on the candidate.

For a repair reviewed in a coding-agent chat, use the saved `repair-1/prompt.txt` as input. Save the response as JSON with two strings named `source` and `explanation`. Append `--proposal PATH_TO_RESPONSE.json` to the resume command. The report records this delivery method. This path also works when a managed desktop restricts nested Codex processes.

Kane usually starts its own Chrome instance. If an environment already provides a dedicated local Chrome debugging endpoint, set `RESTORE_DRILL_CDP_ENDPOINT` to its loopback HTTP origin. Use a disposable Chrome profile for the rehearsal.

## Use an existing Linkwarden installation

Use two instances you control. Supply bearer tokens through `LINKWARDEN_SOURCE_TOKEN` and `LINKWARDEN_TARGET_TOKEN`. Non-loopback URLs require HTTPS. A capture pages through the collections and links twice and checks for changes. An optional `--owner-id` filters the known baseline to collections owned by the specified account.

```sh
node cli.mjs capture http://localhost:3000 source.json
node cli.mjs import source.json --name "My Linkwarden library"
node cli.mjs inspect backup.json
node cli.mjs compare source.json backup.json
```

To exercise Linkwarden's own migration endpoint against an **empty disposable target account**:

```sh
node cli.mjs live --source http://localhost:3000 --target http://localhost:3001 --write-to-empty-target
```

To restore a portable archive through Linkwarden's collection and link APIs, preserving known relationships:

```sh
node cli.mjs restore-into source.json --target http://localhost:3001 --write-to-empty-target
```

The second command creates parents before children, maps new target IDs, writes a journal of acknowledged creations, and captures the target again for comparison. Unknown parentage stops it before the first write. Both commands refuse a populated account. If a remote service fails partway, the partial target can be inspected; use another empty target for the next run. These adapters target the v2.7.1 REST response shapes. The included tests exercise the connector protocol. An external two-instance deployment has not been verified on the development machine.

## CLI and data

```sh
node cli.mjs help
node cli.mjs workspaces
node cli.mjs workspace WORKSPACE_ID
node cli.mjs rehearse WORKSPACE_ID --item BOOKMARK_ID --repair --holdout OTHER_WORKSPACE_ID --holdout-item OTHER_BOOKMARK_ID
node cli.mjs rehearse WORKSPACE_ID --item BOOKMARK_ID --local-only --exporter integrations/linkwarden/bookmark-export.ts
node --test "test/*.test.mjs"
```

Use `--data PATH` on the CLI or server to select a different private store. A rehearsal runs only a trusted local controller or the pinned upstream source. `RESTORE_DRILL_KANE` and `RESTORE_DRILL_CODEX` can point to local executables or JavaScript CLI entry points. The official download is verified against Git's v2.7.1 blob ID before execution and cached for offline reuse.

| Location | Contents |
| --- | --- |
| `.restore-drill/source.sqlite` | Editable libraries, frozen source snapshots, candidate archive bytes, comparisons and browser observation summaries |
| `.restore-drill/restored.sqlite` | Destination copies, read through a separate process with a read-only SQLite connection |
| `.restore-drill/evidence/<drill>/<observation>/` | Frozen objective and raw source/destination Kane outputs |
| `.restore-drill/rehearsals/<run>/` | Controller revisions, agent handoff, holdout outcome and original-archive replay |
| `.restore-drill/live/` | Local records of external Linkwarden migrations and restores |

The workspace and destination writes for a comparison share one SQLite transaction. Updated workspaces use optimistic revision checks. Comparisons preserve duplicate counts and check subtree contents even when sibling names repeat. A browser witness requires a path that can be unambiguously navigated by its folder names. The format accepts HTTP(S) bookmarks, up to 50,000 folders and bookmarks each, a maximum nesting depth of 128, and uploads up to 16 MiB. Private data, credentials and machine-specific paths are gitignored.

## Evidence and submission

On 25 November 2026, signed-in Kane CLI 0.10.9 passed the source path and classified the historical restore as a confirmed product bug. The Codex desktop session received that finding and supplied a changed exporter. Kane passed both the original and restored paths for the repaired workspace, then passed both paths on an independent workspace. Replaying the original bytes still produced an unresolved parent. The machine's nested CLI process encountered a Windows permission error, so the recorded run used the reviewed-agent response option. [Six browser verdicts](evidence/kane/verification.json) · [Agent handoff](evidence/kane/agent-handoff.json) · [Candidate controller](evidence/kane/repair-1-candidate.ts)

The repository also includes an independent Chrome navigation check and screenshots. The automated test suite uses protocol doubles for the paid services. The six live verdicts above were recorded separately from those tests. [Chrome checks](evidence/chromium) · [Walkthrough, captions and submission notes](submission/README.md) · [Event brief](https://www.kaneclihack.sh/) · [Kane agent interface](https://www.testmuai.com/kane-cli/agents/)

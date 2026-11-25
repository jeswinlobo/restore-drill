# Reproduce the native Linkwarden browser check

This command compares the original owner, stock-migration recipient and mapped-restore recipient in Linkwarden’s own Collections page. Each gets the same Kane instruction to inspect the main grid for the parent card and check whether its child appears as a separate top-level card. The root-versus-child observation is visible without reading database tables. [Published browser evidence](../../evidence/upstream/native-kane.json)

## Prepare the browser and servers

Use Node.js 24+, a signed-in Kane CLI and two disposable Linkwarden v2.7.1 origins on loopback. The servers must support username/password registration. Use the pinned release and separate PostgreSQL databases described in the [upstream setup guide](README.md). Leave both servers running throughout this check. The verifier creates one new source owner and two new target owners, then seeds an independently named synthetic workspace.

Install Playwright in a private local directory. This example uses the version from the recorded environment. These commands leave the project’s package manifest alone.

```sh
npm install --prefix .restore-drill/native-browser --no-package-lock playwright@1.62.1
node .restore-drill/native-browser/node_modules/playwright/cli.js install chromium
```

An existing Chrome installation also works. Pass its executable with `--chrome PATH` to skip the Chromium download. When Playwright is already installed for this project, the `--playwright-module` option can be omitted.

## Verify the exact bytes from a completed workbench repair

After a workbench repair and its independent holdout pass, export that rehearsal's evidence package. This reads its saved source snapshot, candidate bytes and signed browser receipts. Substitute your workbench data folder and rehearsal ID.

```sh
node cli.mjs export-rehearsal RUN_ID .restore-drill/my-verified-repair --data PATH_TO_WORKBENCH_DATA
```

Pass the new package to the native verifier. The included `evidence/unattended` package can also be used to reproduce the recorded repair.

```sh
node integrations/upstream/verify-native.mjs --source http://127.0.0.1:45581 --target http://127.0.0.1:45582 --create-disposable-accounts --repair-evidence .restore-drill/my-verified-repair --playwright-module .restore-drill/native-browser/node_modules/playwright --out .restore-drill/linked-native-run-01
```

Before creating accounts, the verifier checks the repair and holdout verdicts, the candidate archive and controller SHA-256, the frozen browser objective, and the source against both saved archives. New workbench packages also carry the frozen source hash. The verifier reads the controller as bytes for hashing. It seeds the original account with the saved source and sends the exact candidate archive text to the stock importer. The mapped restore consumes the same text, then reads the destination back over the application API. Both stored and transmitted archive hashes use the original UTF-8 bytes, including whitespace.

For a multi-bookmark library the verifier prefers the original witness. It can use another nested route when the original's names would be ambiguous in the root grid. Use `--witness-id ID` to require a particular source bookmark. The selected root and leaf names must each identify a single collection and its title/URL must identify one bookmark. The output includes the selected witness, the archive hash and byte count, the frozen source and objective hashes, and the verification receipt hash. Screenshots and the signed browser objective contain the selected collection and bookmark names.

To provision both servers for a browser check, Docker users can run one command after installing the browser and signing into Kane.

```sh
node integrations/upstream/docker-pair.mjs --native --repair-evidence evidence/unattended --playwright-module .restore-drill/native-browser/node_modules/playwright --out .restore-drill/docker-native-run-01
```

## Run

Substitute the two actual ports. Choose a new directory for every run. The PowerShell and shell command is identical on one line.

```sh
node integrations/upstream/verify-native.mjs --source http://127.0.0.1:45581 --target http://127.0.0.1:45582 --create-disposable-accounts --playwright-module .restore-drill/native-browser/node_modules/playwright --out .restore-drill/native-run-01
```

The verifier checks the browser executable and runs `kane-cli whoami` before creating accounts. The three signed Kane runs use the account’s credits. They execute sequentially in independent Chromium profiles. For each role, Playwright opens the actual child collection to confirm its bookmark is present, captures the cards in the main grid and hands that browser to Kane over a dedicated loopback debugging port. After Kane finishes, the verifier rereads folder IDs, names, parent links and bookmark fields through Linkwarden’s API and checks them against that account’s pre-run state.

A successful command exits with code zero. Open `report.json` in the chosen directory and the three corresponding grid screenshots. The report includes the frozen objective, its fingerprint, Kane’s role-specific verdict, its service reason and run identifier, credits, and hashes of the native screenshots and event streams. Account cookies, Chrome profiles and raw event logs use temporary local storage and are cleaned up. Test accounts persist in the supplied disposable servers.

| Role | Visible child in root grid | Expected Kane verdict |
| --- | --- | --- |
| Original source | Absent | Passed |
| Stock-migration destination | Present | Confirmed failure |
| Mapped-restore destination | Absent | Passed |

The CLI returns an inconclusive report and exits nonzero if a service verdict is missing or disputed, the native cards disagree with the expected layout, any account changes, or the portable restore comparison fails. Each invocation attempts each role once. A new invocation uses three newly registered owners and incurs new Kane usage. An HTTP transfer or dependency error before any observation can exit before a report is produced.

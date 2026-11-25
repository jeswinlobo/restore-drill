# Native Linkwarden importer experiment

Linkwarden v2.7.1 reassigned collection IDs while importing a backup and discarded the parent references. This test supplied valid relationship data to the stock migration endpoint, then sent the same archive to a patched build in a fresh account. The patch maps archive IDs to destination IDs before attaching children.

| Frozen library | Stock native migration | Patched native migration |
| --- | --- | --- |
| [Original](first.json) | The expected child appeared at the root. [API and Kane observation](observed-stock-first/report.json) | Three folders and one bookmark matched. [API and Kane verdict](patched-first/report.json) |
| [Holdout](holdout.json) | The deepest child appeared at the root. [API and Kane observation](observed-stock-holdout/report.json) | Six folders and two bookmarks matched, including duplicate names, matching titles with distinct URLs and an empty nested folder. [API and Kane verdict](patched-holdout/report.json) |

The frozen files include expected paths and browser objectives. The first stock attempts to assert the intended hierarchy returned inconclusive browser verdicts. Fresh stock accounts then confirmed the visible extra cards with a positive observation. The patched runs used the original objectives. Each trial submitted the archive once to the native migration endpoint and read back all relationships, titles, URLs and tags. [Original stock verdict](stock-first/report.json) · [Holdout stock verdict](stock-holdout/report.json) · [SHA-256 manifest](manifest.json)

The blind Codex CLI attempt hit an app-server access error. The blind local Qwen attempt selected a collection-card component and proposed an edit that did not match its source. The local patch used in the two successful trials was authored with access to the experiment. It has been tested locally against v2.7.1. [Blind prompt and result](agent-codex) · [Local model requests and responses](agent-local) · [Tested patch](../../integrations/upstream/linkwarden-v2.7.1-native-import.patch)

The erased-parent case used Restore Drill's preflight with the independent source available. It asked for missing evidence and withheld the restore. The request counter remained at zero and the disposable account stayed empty. [Control receipt](control.json)

## Reproduce

Verify the archived receipts offline from the Restore Drill root with Node 24.

```sh
node evidence/native-import/replay.mjs
```

For a new native run, start a disposable stock Linkwarden v2.7.1 instance on loopback with credential registration enabled. Start a second instance from the same release after applying the [patch](../../integrations/upstream/linkwarden-v2.7.1-native-import.patch) with `git apply` and rebuilding Linkwarden. Install Playwright, Chrome and Kane CLI and sign in to Kane. Run commands from the Restore Drill root. Set `--playwright-module` to an absolute installation path if Playwright is outside the default Node module lookup.

```sh
node integrations/upstream/trial-native-import.mjs --fixture evidence/native-import/first.json --target http://127.0.0.1:3001 --expect flat --observe-stock --create-disposable-account --out new-stock-first
node integrations/upstream/trial-native-import.mjs --fixture evidence/native-import/first.json --target http://127.0.0.1:3002 --expect repaired --create-disposable-account --out new-patched-first
```

Repeat with `holdout.json` and new output directories. Omit `--observe-stock` to run the original negative stock assertion. Kane may return an inconclusive verdict when the fixture is already flat. The runner retains this result and exits unsuccessfully. The API readback still shows the observed hierarchy.

# Export a verified repair

A rehearsal that finishes with `verified-repair` after a separate holdout check can become an evidence bundle. Use the run’s `id` printed by `node cli.mjs rehearse` and a new output directory. Point `--data` at the same local store used for the rehearsal.

```sh
node cli.mjs export-rehearsal RUN_ID ./runs/my-verified-repair --data .restore-drill
```

The command reads a snapshot of the local source database. It rebuilds both bookmark tasks, checks their hashes, compares each stored archive to its frozen workspace, checks the exact controller and proposal hashes, and checks the raw terminal events against their recorded browser verdicts. It also checks that replaying the original bytes retained the original failure. Local-model repairs include hashes of the accepted request and response when recorded. This command uses the saved observations. It runs offline and executes no candidate code or browser tasks.

`verification.json` indexes the source and holdout workspaces, the original and repaired archive bytes, the candidate TypeScript and the browser receipt fingerprints. `agent-handoff.json` contains delivery information and repair hashes. The command excludes model prompts, raw event streams, session cookies, service dashboard links and billing data.

**Before sharing**, review both workspaces, every archive and the candidate source. Their exact contents preserve names, paths, tags, URLs, URL parameters and any comments your project supplied. Exporting refuses recognizable credentials or service share links, but arbitrary user text can still be private. A synthetic rehearsal is the simplest option for public judging.

To run new native browser checks on the exported candidate archive, pass the new directory to `--repair-evidence`. [Native verification guide](../integrations/upstream/native-browser.md)

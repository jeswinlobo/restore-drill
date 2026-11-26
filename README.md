# Restore Drill

**[▶ Watch Kane CLI test a server migration (2:41, narrated and captioned)](https://cdn.jsdelivr.net/gh/jeswinlobo/restore-drill@main/submission/restore-drill-demo.mp4)** · [Video file on GitHub](submission/restore-drill-demo.mp4)

Watch the original bookmark check pass, the same check fail after import, and Kane find the supplier agreement again after the exporter fix.

Check a backup before switching servers. Restore Drill compares an application export with a known-good reference and shows which records changed. Its first supported application is **Linkwarden**. It checks folder structure and bookmark titles, URLs and tags. Attachments, permissions and archived pages require separate verification.

<a id="run-locally"></a>

## Run your first check

Use Node.js 24 or newer. No package installation or TestMu account is needed for the local comparison.

```sh
git clone https://github.com/jeswinlobo/restore-drill.git
cd restore-drill
node app.mjs
```

Open **http://127.0.0.1:4317**, select **Load example files**, then **Compare files**. The example restores every bookmark but loses the parent of the Renewals folder. Expand the comparison to inspect the changed path and archive fingerprint.

## Check your migration

1. Save an independently verified reference while the old library is available. The [capture instructions](OPERATIONS.md#use-an-existing-linkwarden-installation) cover live Linkwarden accounts.
2. In **Backup check**, select that reference and the candidate export. The control panel compares both files on your workstation without writing to Linkwarden.
3. Review the result. **Ready to restore** means the supported fields match the reference. **Restore blocked** means they disagree. **Independent evidence needed** means a folder relationship cannot be resolved.
4. For an actual restore, use an empty target account and follow the [verified restore instructions](OPERATIONS.md#which-backup-would-you-restore). They include readback and handling a partial write.

## What has been verified

Two independent **Linkwarden v2.7.1** installations reproduced the reported folder migration bug. **v2.17.0** was the latest published release checked on November 26, 2026. The project evidence establishes the result for v2.7.1. The newer release has not been tested here. [User report](https://github.com/linkwarden/linkwarden/issues/812) · [Linkwarden releases](https://github.com/linkwarden/linkwarden/releases/latest)

Open **Guided demo** to inspect the original and broken libraries, the coding agent’s change, and Kane CLI’s recorded browser checks on the repaired export and a second library. **Replay the repair offline** recomputes archive evidence locally. A fresh Kane browser run requires Chrome, Kane CLI and a signed-in TestMu account.

[Operations and technical evidence](OPERATIONS.md) · [Native Linkwarden results](evidence/native-import/README.md) · [Demo plan](submission/guided-demo.md)

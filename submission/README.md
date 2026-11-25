# Restore Drill submission

## About the project

When a customer folder disappears in a migration, a count of imported bookmarks can still look perfect. Restore Drill answers a question for the person responsible for the backup. Can the owner open the same document by following the same folders?

I built Restore Drill with Codex to answer that question before someone relies on a backup. It accepts bookmark archives and captures live Linkwarden libraries. Kane opens a real browser, follows the owner's route, and checks the bookmark details. In one source library, two different owners produced the same 539-byte historical archive. Recovering the owner from that file alone is impossible.

Kane caught a lost parent. A local Qwen coding model received the finding and generated a guard for a deletion in the exporter. Restore Drill applied the edit and sent fresh restores back to Kane. The repaired path passed on two libraries. A plausible repair that guessed the first owner passed the original library and failed the independent one. On two real Linkwarden installations, Kane also caught the stock importer's flattened hierarchy and passed Restore Drill's mapped recovery on the native Collections page.

## Materials

Open **Evidence → Check all three backups** to replay the missing owner, wrong owner, and recoverable archive. The app recomputes the decisions from disk. The recorded Linkwarden account received zero, zero and four writes respectively. [Live API evidence](../evidence/decisions/native.json) · [Offline command](../evidence/decisions/replay.mjs)

Kane also opened the workbench in Chrome, ran this replay and checked all three rows. The final chapter of the video shows the result. [Kane browser verdict](../evidence/decisions/browser.json)

The successful agent-generated change repaired the exporter. In a separate experiment, the local model received the native importer, archive and incident evidence. Its structured response diagnosed missing parent handling but returned the original importer implementation. The project uses its verified API recovery path for that case. [Importer experiment](../evidence/decisions/importer-attempt.json)

- [Submission walkthrough](restore-drill-evidence-walkthrough.mp4) and [English captions](restore-drill-evidence-captions.vtt)
- [Unattended repair](../evidence/unattended/verification.json), [model request and output](../evidence/unattended/agent-handoff.json) and [offline reproduction](../evidence/replay.mjs)
- [Six fresh Kane checks from a single run with two new libraries](../evidence/unattended-fresh/verification.json)
- [Native Linkwarden browser verdicts](../evidence/upstream/native-kane.json), [wrong-repair rejection](../evidence/negative-control/verification.json) and [production restore with duplicate names](../evidence/upstream/production-branching.json)
- [The exact 563 model-repaired bytes imported by two production accounts and checked by Kane](../evidence/upstream/native-repair.json)
- [Original reviewed Codex walkthrough](restore-drill-walkthrough.mp4) and [its six authenticated verdicts](../evidence/kane/verification.json)
- [Local Chrome comparisons](../evidence/chromium/observed.json) and [repair and independent-workspace results](../evidence/chromium/repair-check.json)
- Run `node cli.mjs ambiguity evidence/kane/original-workspace.json` for the two 539-byte archives in the walkthrough. [Recorded result](../evidence/ambiguity/original-workspace.json)
- [Run the application and connect Kane](../README.md)

## What judges can check

| Judging dimension | Evidence |
| --- | --- |
| Ships | A real API restore creates parents before children and reads the target back. A two-instance production run recovered six folders and two bookmarks. |
| Verified | Kane flagged the extra top-level folder on Linkwarden's own screen. It also caught a wrong repair that preserved item counts. |
| Closed loop | The local coding model received Kane's observation and generated an edit. The original bookmark task and a held-out library passed fresh browser checks. |
| Craft | Open Evidence and reproduce a repair offline. Work with your own data to test ambiguity, inspect missing parents or confirm a relationship from independent evidence. |

## Draft for LinkedIn

Our test backup imported all three folders and its bookmark. It still failed the person who needed it. The agreement used to live inside a client's Licences folder. After the restore, the bookmark had its title, URL and tags, but its client folder was missing from the path.

I built Restore Drill for the KaneCLI Online Hackathon to catch this kind of loss. You can bring your own archive, rehearse a restore, and compare the route with the source. A new exporter preserves the relationship. For older files that lack the evidence, the app shows which parent needs human confirmation.

Kane CLI caught the missing parent in Chrome. A local coding model used its finding to repair the exporter, and Kane checked the result on two libraries. Then I ran the test on two Linkwarden installations. Even a corrected archive lost the parent in the stock importer. Writing parents before children and reading back the destination finally restored the owner's path.

## Draft for X

Two different folder trees. Two byte-identical bookmark exports. Which client owned the agreement? The old JSON alone can't tell you. For the KaneCLI hackathon I built Restore Drill to exercise the actual recovery path in a browser and show exactly which relationships survived.

## Publishing

When ready to go public, attach the comparison image or walkthrough to each post. Enter the public GitHub repository URL, YouTube walkthrough URL, both distinct post URLs and the project description in the form. The live application URL is optional. Judges can use the recording as a fallback. Arrange access to a dedicated TestMu test account privately if needed for the paid verifier. [Submission requirements](https://www.kaneclihack.sh/)

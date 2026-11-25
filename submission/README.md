# Restore Drill submission

## About the project

When a customer folder disappears in a migration, a count of imported bookmarks can still look perfect. Restore Drill answers a question for the person responsible for the backup. Can the owner open the same document by following the same folders?

I built Restore Drill with Codex. It runs the published Linkwarden v2.7.1 export controller against an editable bookmark workspace and restores the resulting JSON into a separate local database. Kane CLI uses a real browser to follow the owner's route. A confirmed failure can go back to Codex, which proposes a change to the exporter. Restore Drill checks the proposed change with the same bookmark objective and a second workspace. Earlier archive files stay available for comparison.

In the recorded run Kane reached the agreement on the source, caught the missing parent after restore, and passed the Codex repair on two different libraries. Retesting the old archive preserved the original failure. The coding agent received the confirmed finding through a reviewed handoff in Codex desktop.

## Materials

- [Narrated walkthrough](restore-drill-walkthrough.mp4) and [English captions](restore-drill-captions.vtt)
- [Six authenticated Kane verdicts](../evidence/kane/verification.json), [agent handoff](../evidence/kane/agent-handoff.json) and [offline reproduction](../evidence/replay.mjs)
- [Local Chrome comparisons](../evidence/chromium/observed.json) and [repair and independent-workspace results](../evidence/chromium/repair-check.json)
- [Reproduce the two identical archives](../evidence/check-linkwarden-export.mjs)
- [Run the application and connect Kane](../README.md)

## What judges can check

| Judging dimension | Evidence |
| --- | --- |
| Ships | Import a bookmark archive, restore it into a separate database and open both libraries. |
| Verified | Kane reached the bookmark on the source and classified the lost parent on the restored copy as a product bug. |
| Closed loop | The saved Kane finding reached Codex desktop. The returned controller was executed and Kane passed its fresh restore using the original objective. |
| Craft | The owner can inspect the missing parent, compare archive fingerprints and explicitly confirm a relationship when independent evidence is available. |

## Draft for LinkedIn

Our test backup imported all three folders and its bookmark. It still failed the person who needed it. The agreement used to live inside a client's Licences folder. After the restore, the bookmark had its title, URL and tags, but its client folder was missing from the path.

I built Restore Drill for the KaneCLI Online Hackathon to catch this kind of loss. You can bring your own archive, rehearse a restore, and compare the route with the source. A new exporter preserves the relationship. For older files that lack the evidence, the app shows which parent needs human confirmation.

Kane CLI caught the missing parent in Chrome. I gave that finding to Codex, and Kane passed the resulting repair twice, including on a different customer's folder tree.

## Draft for X

Two different folder trees. Two byte-identical bookmark exports. Which client owned the agreement? The old JSON alone can't tell you. For the KaneCLI hackathon I built Restore Drill to exercise the actual recovery path in a browser and show exactly which relationships survived.

## Publishing

When ready to go public, attach the comparison image or walkthrough to each post. Enter the public GitHub repository URL, YouTube walkthrough URL, both distinct post URLs and the project description in the form. The live application URL is optional. Judges can use the recording as a fallback. Arrange access to a dedicated TestMu test account privately if needed for the paid verifier. [Submission requirements](https://www.kaneclihack.sh/)

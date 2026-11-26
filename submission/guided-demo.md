# Restore Drill guided demo plan

Restore Drill helps a Linkwarden operator decide whether a bookmark export is safe to restore. The demo starts with two libraries that contain identical numbers of folders and bookmarks. In one library, a nested folder moved to the top level, so an employee can no longer reach the agreement by following the original folder path.

## User and scope

The user is the administrator of a team’s Linkwarden library who needs to move servers or rehearse disaster recovery. A whole-database backup can preserve database IDs and relationships when the operator controls the complete database. An application export is a different starting point. Its relationships need to survive import, and item counts alone cannot establish that they did.

Restore Drill checks bookmark paths, URLs, titles, and tags. An independently verified reference lets the operator make a recovery decision even after the old server is offline. The project flags missing evidence rather than guessing a folder owner. Attachments, permissions, and the contents of bookmarked documents are outside this demo’s scope.

## Working demo

| Step | What the operator sees | What substantiates it |
| --- | --- | --- |
| Find the break | The original tree and broken restore have the same item counts. **Cedar ffda → Renewals → Supplier agreement** works on the original. Renewals sits at the top level on the broken copy. | The trees come from the recorded archive data. Kane’s original browser observations are available beside them. |
| See the repair | The old exporter removed the ID that identified the parent folder. Restore Drill sent the failed browser check and exporter source to a coding agent. The proposed change kept the references needed to rebuild nested folders. | The agent handoff and candidate exporter are available as separate records. |
| Verify the fix | A fresh export restores the original path. Kane finds the bookmark, then checks a second library. The app can rerun the archive comparison offline. | Recorded browser verdicts for the original, broken, repaired, and independent libraries. A separate Linkwarden run shows the native Collections screen before and after mapped recovery. |
| Decide what to restore | Three backups yield three decisions: ask for evidence, block recovery, or ready to restore. An operator can also compare their own two JSON files locally. | The three sample decisions are recomputed on demand. The displayed write counts come from a separate recorded Linkwarden run. The custom file check does not write to either library. |

The site is the interactive demo. The recording and voiceover will be produced separately. The UI uses an adapted React Bits Spotlight Card on the comparison panels, with pointer effects disabled when reduced motion is requested.

## Verification and release

- The guided view opens from the home page and supports all four steps by keyboard and pointer at desktop and mobile widths.
- The evidence distinguishes recorded Kane observations from fresh local computations. The repaired run uses the original browser task. A second library checks that the repair generalizes.
- The offline replays run without TestMu sign-in. A fresh Kane run uses an authenticated TestMu account and synthetic fixtures.
- The custom comparison must reject a changed folder owner, accept a matching backup, and leave workspace state unchanged.
- Run the automated suite, complete the browser walkthrough, check the evidence links, and verify that the final commit is on GitHub `main`.

## Separate recording plan

Target **2 minutes 55 seconds**. Start at the working demo’s first step. Label recorded checks accurately and show the live offline comparison near the end.

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:30 | The original and restored trees with matching counts. | “A team moving its bookmark library needs to know whether it can still find the supplier agreement. Both copies have three folders and two bookmarks, so the counts look fine.” |
| 0:30–0:55 | Open Cedar in both copies and show the misplaced Renewals folder and Kane’s failure. | “The old exporter discarded the parent folder’s ID. Restore Drill catches that loss before cutover. Kane uses Chrome to try the same clicks an employee would make.” |
| 0:55–1:25 | Open the repair step and point to the agent handoff. | “The browser failure went to a coding agent. It proposed keeping collection IDs so a fresh export could preserve the nesting.” |
| 1:25–1:55 | Show the repaired tree, then the second-library result. | “Kane repeated the same task, found the bookmark, and confirmed the repair on a second library. The offline replay regenerates the two repaired archives.” |
| 1:55–2:40 | Run the three backup decisions. | “Unknown owner, stop for evidence. Wrong owner, block. Matching owner, ready. The recorded test only wrote to Linkwarden in the verified case.” |
| 2:40–2:55 | Hold on the results. | “The restore counts tell you what came back. Restore Drill and Kane show whether the team can find it.” |

The event lists [about three to five minutes](https://www.kaneclihack.sh/#rules) for the submission video. This cut targets just under three minutes.

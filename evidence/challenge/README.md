# Can a plausible wrong repair pass?

Run from the repository root with Node 24 or later.

```sh
node evidence/challenge.mjs --replay evidence/challenge/result.json
node evidence/challenge.mjs
node evidence/challenge.mjs --candidate integrations/controls/first-root-fallback.ts --seed 103
```

The first command reproduces a recorded comparison and verifies every controller, input and output digest. The second samples a new seed after reading the candidate. The third deliberately proposes the negative control as the repair and returns exit code 1 when the verifier rejects it. A successful candidate returns 0 and an execution or replay error returns 2. Use `--report path.json` to save a run and `--json` for machine-readable results.

The negative control assigns archive-local folder keys and tries to identify parents using bookmark records. When an empty parent has no bookmark to identify it, it chooses the first root. The original workspace happens to put its child under that root. The independent workspace puts its child under the other root. The control preserves the total folder and bookmark counts in both.

The two fixed inputs are the actual source libraries from the recorded Kane rehearsal. Five additional libraries vary names, IDs and row order with the seed. They include children before parents, multiple empty ancestors, populated parents and equal display paths beneath duplicate folder names. Structural comparison also checks how the contents are distributed among those identically named folders.

The report records local controller execution, archive parsing and comparisons. It samples a finite set of structures. The published seed and inputs make the check reproducible; a fresh seed challenges name- and ID-specific repairs. Browser evidence from the original rehearsal is stored separately in [the Kane record](../kane/verification.json).

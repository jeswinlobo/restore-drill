# A restore drill on real Linkwarden servers

The recorded run used two Linkwarden v2.7.1 web applications on Windows and two PostgreSQL 16.16 clusters. Each cluster applied all 42 upstream Prisma migrations. Three newly registered owners supplied the source, a stock-migration destination and a portable-recovery destination. Registration, login, token creation, seeding, export, import and verification used the application's HTTP routes.

| Operation | Bookmark location | Result |
| --- | --- | --- |
| Original owner | South 2cc646 / Agreements | 3 folders, 1 bookmark |
| Native export and native import | Agreements | Folder moved to the root |
| Restore Drill capture and mapped restore | South 2cc646 / Agreements | Original path and metadata matched |

The two destination accounts both retained the bookmark title, URL and two tags. The portable importer created the parent collections first and bound each child and bookmark to the target server's returned ID. [Recorded HTTP result](../../evidence/upstream/pair.json)

To carry a newly completed workbench repair into these applications, export its evidence package and pass it to the native browser verifier with `--repair-evidence`. Both import paths consume the candidate bytes from that receipt. Kane inspects the source and both results in Linkwarden's own browser interface. [Native browser instructions](native-browser.md)

A second pair running an optimized production build exercised six folders, an empty collection, two collections named Agreements under different client folders, and two bookmarks with the same title. The stock migration moved both bookmarks. The mapped restore recovered both distinct paths, including the three-level South / Agreements / Renewals branch. Run this extra case with `--scenario branching`. [Production HTTP result](../../evidence/upstream/production-branching.json)

A second run loaded the exact saved Kane repair into the upstream TypeScript runtime, which provided its generated Prisma client and source PostgreSQL database. The resulting archive matched the source. Sending this corrected archive to the stock migration endpoint still moved the bookmark to the root. Sending the same archive through Restore Drill's mapped restore preserved the nested path. The unmodified v2.7.1 importer assigns no parent when creating collections. [Recorded controller result](../../evidence/upstream/candidate.json) · [Kane candidate](../../evidence/kane/repair-1-candidate.ts) · [Upstream importer](https://github.com/linkwarden/linkwarden/blob/f9443457457e19f6969f836642fbf0f72112c43c/lib/api/controllers/migration/importFromLinkwarden.ts)

The separately generated unattended repair passed the same database and destination checks on another fresh owner. Its archive preserves collection database IDs and the stock export's broader account attributes. The recorded candidate instead allocates archive-local folder IDs and selects a narrower set of properties. Both reports contain the measured bookmark fields and a hash of the export. [Unattended controller result](../../evidence/upstream/unattended-candidate.json)

## Run a fresh pair

With Node.js 24+, Docker and Docker Compose v2 with `--wait`, run this from the project root.

```sh
node integrations/upstream/docker-pair.mjs --out runs/full-app-pair.json
```

The command pulls the pinned official Linkwarden release image, creates two PostgreSQL servers with separate volumes and chooses two local HTTP ports. The rehearsal uses new random account names and synthetic bookmark data for every run. The command prints the results and removes the containers and volumes belonging to its randomly named Compose project. A first run needs internet access to pull the images. The public evidence files were generated with native Windows processes and the same release source. Docker Compose was unavailable on the recording machine.

For existing disposable v2.7.1 servers with registration and username/password authentication enabled, use their loopback URLs. The command creates separate test accounts and leaves those accounts on the servers for inspection. A custom nested portable workspace can be supplied with `--workspace PATH`.

```sh
node integrations/upstream/run-pair.mjs --source http://127.0.0.1:45571 --target http://127.0.0.1:45572 --create-disposable-accounts --out runs/pair.json
```

## Exercise the saved code repair on a real source database

Use an unpacked or LF checkout of the exact upstream release, with dependencies installed using its Yarn lockfile and a generated Prisma 4.16.2 client. Set `DATABASE_URL` in the environment to the source application's loopback PostgreSQL database. This command makes three more disposable owners. It verifies that the source owner's generated username and numeric ID match the same row in the selected database before running the candidate.

```sh
node integrations/upstream/run-candidate.mjs --checkout PATH_TO_LINKWARDEN --source http://127.0.0.1:45571 --target http://127.0.0.1:45572 --create-disposable-accounts --out runs/candidate.json
```

Add `--candidate unattended` and choose a new output file to verify the separately generated unattended repair.

The script checks the candidate SHA-256 and the original exporter Git blob, then loads the candidate with upstream's `ts-node`, path aliases and database module. Source records come from PostgreSQL. Both destinations use normal authenticated HTTP calls. The main HTTP and candidate runs used upstream Next.js 13.4.12 in development mode and Node 18.20.8 for the web servers. The branching case ran against two `next start` processes after an upstream `next build`, with fresh accounts in the same two independent PostgreSQL clusters. The comparison covers folder relationships and bookmark titles, URLs and tags. File preservation workers, site screenshots, attachments, permissions and full-account disaster recovery are outside the measured scope.

Upstream Linkwarden v2.7.1 is licensed under AGPL-3.0. The Compose configuration references its published image by digest. The application sources, dependencies, credentials and database files are installed separately from this project. [Pinned application tree](https://github.com/linkwarden/linkwarden/tree/f9443457457e19f6969f836642fbf0f72112c43c) · [Upstream exporter](https://github.com/linkwarden/linkwarden/blob/f9443457457e19f6969f836642fbf0f72112c43c/lib/api/controllers/migration/exportData.ts) · [Upstream license](https://github.com/linkwarden/linkwarden/blob/f9443457457e19f6969f836642fbf0f72112c43c/LICENSE.md)

The unattended candidate modifies the upstream export controller's ID-redaction step. Its recorded TypeScript source carries the upstream licensing terms, with the change and date recorded in the associated agent handoff. [License copy](Linkwarden-LICENSE.md)

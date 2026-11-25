// Node.js 24+. Run: node check-linkwarden-export.mjs
// Optionally pass a local copy of the v2.7.1 exportData.ts as the first argument.
// This runs the published exporter with an in-memory database read.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const sourceUrl = "https://raw.githubusercontent.com/linkwarden/linkwarden/v2.7.1/lib/api/controllers/migration/exportData.ts";
const expectedGitBlob = "73141fd0f3e2f25f360c39bb90de4afe665bc89c";

async function loadExporter() {
  let source;
  if (process.argv[2]) {
    source = await readFile(process.argv[2], "utf8");
  } else {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Could not read exporter: HTTP ${response.status}`);
    source = await response.text();
  }
  source = source.replace(/\r\n/g, "\n");
  const blob = createHash("sha1")
    .update(`blob ${Buffer.byteLength(source)}\0`)
    .update(source)
    .digest("hex");
  assert.equal(blob, expectedGitBlob, "Unexpected exporter revision");
  const js = stripTypeScriptTypes(source)
    .replace('import { prisma } from "@/lib/api/db";', "")
    .replace("export default ", "");
  return new Function("prisma", js + "\nreturn exportData;");
}

const getExporter = await loadExporter();

function fixture(alphaId, betaId) {
  const childId = 30;
  const when = "2024-10-01T12:00:00.000Z";
  const agreement = { id: 45, name: "Signed agreement", collectionId: childId,
    url: "https://example.test/agreement", tags: [], createdAt: when, updatedAt: when };
  function folder(id, name, parentId, links = []) {
    return { id, name, parentId, links, ownerId: 1, description: "", color: "#0ea5e9",
      isPublic: false, createdAt: when, updatedAt: when };
  }
  return {
    id: 1, name: "Maya", username: "maya", password: "fixture-only",
    collectionOrder: [], pinnedLinks: [], whitelistedUsers: [],
    collections: [folder(alphaId, "Alpha", null), folder(betaId, "Beta", null),
      folder(childId, "Contracts", 17, [agreement])],
  };
}

function agreementPath(account) {
  const child = account.collections.find(folder => folder.links.length > 0);
  const parent = account.collections.find(folder => folder.id === child.parentId);
  return [parent.name, child.name, child.links[0].name].join(" / ");
}

async function exportJson(account) {
  const prisma = { user: { findUnique: async () => structuredClone(account) } };
  const result = await getExporter(prisma)(account.id);
  assert.equal(result.status, 200);
  return JSON.stringify(result.response);
}

const alpha = fixture(17, 22);
const beta = fixture(12, 17);
const [first, second] = await Promise.all([exportJson(alpha), exportJson(beta)]);
assert.notEqual(agreementPath(alpha), agreementPath(beta));
assert.equal(first, second, "Expected the two archive payloads to be byte-for-byte identical");
const different = structuredClone(beta);
different.collections[2].links[0].name = "Revised agreement";
assert.notEqual(first, await exportJson(different), "A changed bookmark title should change the export");
const digest = createHash("sha256").update(first).digest("hex");
console.log(JSON.stringify({
  exporter: sourceUrl,
  sourceWorkspaceA: agreementPath(alpha),
  sourceWorkspaceB: agreementPath(beta),
  exportsIdentical: true,
  exportedJsonBytesEach: Buffer.byteLength(first),
  sha256OfBoth: digest,
  changedTitleProducedDifferentArchive: true,
  scope: "Source-level check using two synthetic database results with empty collectionOrder. No live application, browser or Kane run.",
}, null, 2));

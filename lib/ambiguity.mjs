import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare, digest, readArchive } from './archive.mjs';
import { executeProjectedExporter, officialExporter, projectAccount, upstreamURL } from './exporter.mjs';

const scope =
  'Two modeled database states derived from the supplied bookmark workspace, with an empty collectionOrder. The pinned Linkwarden v2.7.1 export controller reads each through the same Prisma adapter.';
const scanLimit = 32_768;
const noWitness = (reason) => ({
  status: 'no-witness',
  reason,
  scope: 'This search covers differently named root folders with no direct bookmarks.'
});

function rootPath(row, byId) {
  const names = [];
  let folder = row;
  while (folder.parentId !== null) {
    names.push(folder.name);
    folder = byId.get(folder.parentId);
  }
  return { root: folder, relative: names.reverse() };
}

// This exported preparation step also lets an investigator examine the two
// modeled inputs directly. It never edits the user's workspace.
export function prepareAmbiguityInputs(input) {
  const source = readArchive(input);
  if (source.folders.some((f) => f.unresolved))
    return noWitness('Independently confirm the source hierarchy before testing alternative ownership.');

  const stateA = projectAccount(source);
  const byId = new Map(stateA.collections.map((row) => [row.id, row]));
  const roots = stateA.collections.filter((row) => row.parentId === null && row.links.length === 0);
  if (new Set(roots.map((row) => row.name)).size < 2)
    return noWitness('This witness needs two differently named root folders with no direct bookmarks.');

  const contentsByRoot = new Map(roots.map((root) => [root.id, new Map()]));
  for (const [rowIndex, row] of stateA.collections.entries()) {
    if (!row.links.length) continue;
    const { root, relative } = rootPath(row, byId);
    const contents = contentsByRoot.get(root.id);
    if (!contents) continue;
    for (const [linkIndex, link] of row.links.entries()) {
      const signature = JSON.stringify([
        relative,
        link.name,
        link.url,
        link.tags.map((tag) => tag.name)
      ]);
      const previous = contents.get(signature);
      if (previous) previous.count++;
      else contents.set(signature, { rowIndex, linkIndex, count: 1 });
    }
  }
  let probes = 0;
  for (const root of roots) {
    const own = contentsByRoot.get(root.id);
    if (!own.size) continue;
    for (const other of roots) {
      if (++probes > scanLimit)
        return noWitness('The bounded search ended before a distinguishable bookmark was found.');
      if (other.name === root.name) continue;
      const alternate = contentsByRoot.get(other.id);
      for (const [signature, witness] of own) {
        if (++probes > scanLimit)
          return noWitness('The bounded search ended before a distinguishable bookmark was found.');
        if (witness.count === (alternate.get(signature)?.count ?? 0)) continue;
        const stateB = structuredClone(stateA);
        const rootsB = new Map(stateB.collections.map((row) => [row.id, row]));
        rootsB.get(root.id).id = other.id;
        rootsB.get(other.id).id = root.id;
        const folderA = stateA.collections[witness.rowIndex];
        const folderB = stateB.collections[witness.rowIndex];
        const link = folderA.links[witness.linkIndex];
        const pathA = rootPath(folderA, byId);
        const pathB = rootPath(folderB, new Map(stateB.collections.map((row) => [row.id, row])));
        return {
          status: 'prepared',
          stateA,
          stateB,
          pathA: [pathA.root.name, ...pathA.relative],
          pathB: [pathB.root.name, ...pathB.relative],
          bookmark: { title: link.name, url: link.url, tags: link.tags.map((tag) => tag.name) }
        };
      }
    }
  }
  return noWitness('The eligible roots have no distinguishable descendant bookmark for this witness.');
}

export async function proveAmbiguity(archive, dataDir) {
  const inputs = prepareAmbiguityInputs(archive);
  if (inputs.status === 'no-witness') return inputs;
  const { stateA, stateB, pathA, pathB, bookmark } = inputs;
  const knownA = readArchive({ collections: stateA.collections });
  const knownB = readArchive({ collections: stateB.collections });
  if (compare(knownA, knownB).status !== 'different')
    throw Error('The alternative states have equivalent contents.');
  const [{ source: historical }, portable] = await Promise.all([
    officialExporter(dataDir),
    readFile(new URL('../integrations/linkwarden/bookmark-export.ts', import.meta.url), 'utf8')
  ]);
  const scratch = await mkdtemp(join(tmpdir(), 'restore-drill-witness-'));
  try {
    const exports = await Promise.allSettled([
      executeProjectedExporter(historical, stateA, scratch),
      executeProjectedExporter(historical, stateB, scratch),
      executeProjectedExporter(portable, stateA, scratch),
      executeProjectedExporter(portable, stateB, scratch)
    ]);
    const failure = exports.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    const [oldA, oldB, newA, newB] = exports.map((result) => result.value);
    if (oldA !== oldB) throw Error('The historical archive bytes differ. No ambiguity was proved.');
    const comparisons = [
      compare(knownA, readArchive(newA)).status,
      compare(knownB, readArchive(newB)).status
    ];
    if (newA === newB || comparisons.some((status) => status !== 'matched'))
      throw Error('The reference-preserving exporter did not distinguish and preserve both states.');
    return {
      status: 'proved',
      bookmark,
      pathA,
      pathB,
      legacy: {
        identical: true,
        bytes: Buffer.byteLength(oldA),
        sha256: digest(oldA),
        controller: upstreamURL
      },
      portable: { hashA: digest(newA), hashB: digest(newB), comparisons },
      inputs: { hashA: digest(stateA), hashB: digest(stateB) },
      scope
    };
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

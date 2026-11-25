import { readFile } from 'node:fs/promises';
import { compare, digest, fresh, readArchive } from './archive.mjs';
import { executeExporter } from './exporter.mjs';

// Names, source IDs and row order vary with the seed. Labels such as "east"
// describe roles in this generator; the exporter receives ordinary Prisma rows.
function generatedLibrary(seed, scenario, rows, records, childrenFirst = false) {
  const token = (kind, value) => digest([seed, scenario, kind, value]).slice(0, 12);
  const folderId = (key) => token('folder', key);
  const folders = rows.map(([key, label, parent]) => ({
    id: folderId(key),
    name: label + ' ' + token('label', label).slice(0, 4),
    parent: parent == null ? null : folderId(parent)
  }));
  folders.sort((a, b) => {
    if (childrenFirst && (a.parent === null) !== (b.parent === null)) return a.parent === null ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
  const bookmarks = records.map(([key, parent]) => ({
    id: token('bookmark', key),
    folder: folderId(parent),
    title: 'Reference ' + token('title', key).slice(0, 8),
    url: 'https://example.test/doc/' + token('url', key),
    tags: ['rehearsal', token('tag', key)]
  }));
  return {
    name: scenario,
    origin: 'generated',
    source: readArchive({ ...fresh(), folders, bookmarks })
  };
}

export async function challengeCases(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error('Use an unsigned 32-bit seed.');
  const recorded = async (name, filename) => ({
    name,
    origin: 'recorded',
    source: readArchive(await readFile(new URL('../evidence/kane/' + filename, import.meta.url), 'utf8'))
  });
  const fork = [
    ['east', 'East', null],
    ['west', 'West', null],
    ['e', 'Notes', 'east'],
    ['w', 'Notes', 'west']
  ];
  const leaves = [
    ['invoice', 'e'],
    ['quote', 'w']
  ];
  return [
    await recorded('Original workspace', 'original-workspace.json'),
    await recorded('Independent workspace', 'holdout-workspace.json'),
    generatedLibrary(
      seed,
      'Single root',
      [
        ['root', 'Library', null],
        ['one', 'Invoices', 'root'],
        ['two', 'Orders', 'root']
      ],
      [
        ['invoice', 'one'],
        ['order', 'two']
      ]
    ),
    generatedLibrary(seed, 'Children before two empty parents', fork, leaves, true),
    generatedLibrary(seed, 'Parents identifiable through their bookmarks', fork, [
      ...leaves,
      ['east-index', 'east'],
      ['west-index', 'west']
    ]),
    generatedLibrary(
      seed,
      'Nested empty ancestors',
      [
        ['root', 'Company', null],
        ['mid', 'Client', 'root'],
        ['leaf', 'Case', 'mid'],
        ['extra', 'Notes', 'mid']
      ],
      [
        ['order', 'leaf'],
        ['receipt', 'extra']
      ]
    ),
    // Two roots and two children have identical names. Flattened bookmark paths,
    // including their counts, stay identical even if both children move to one root.
    generatedLibrary(
      seed,
      'Identically named branches',
      [
        ['east', 'Team', null],
        ['west', 'Team', null],
        ['e', 'Notes', 'east'],
        ['w', 'Notes', 'west']
      ],
      leaves,
      true
    )
  ];
}

export async function evaluateController(sourceText, cases, scratch) {
  const outcomes = [];
  for (const { name, origin, source } of cases) {
    const bytes = await executeExporter(sourceText, source, scratch);
    const comparison = compare(source, readArchive(bytes));
    outcomes.push({
      name,
      origin,
      inputHash: digest(source),
      archiveHash: digest(bytes),
      status: comparison.status,
      folders: comparison.folders,
      bookmarks: comparison.bookmarks,
      differences: comparison.differences.length,
      differenceKinds: [...new Set(comparison.differences.map((row) => row.kind))],
      changedPaths: comparison.changedPaths
    });
  }
  const matched = outcomes.filter((outcome) => outcome.status === 'matched').length;
  return {
    controllerHash: digest(sourceText),
    matched,
    total: outcomes.length,
    accepted: matched === outcomes.length,
    outcomes
  };
}

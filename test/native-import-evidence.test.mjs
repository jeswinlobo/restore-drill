import assert from 'node:assert/strict';
import test from 'node:test';
import { replayNativeImport } from '../evidence/native-import/replay.mjs';

test('native import evidence reproduces both path comparisons and the erased-parent control', async () => {
  const result = await replayNativeImport();
  assert.deepEqual(result, {
    scenarios: [
      { name: 'first', folders: 3, bookmarks: 1 },
      { name: 'holdout', folders: 6, bookmarks: 2 }
    ],
    erasedParent: { targetRequests: 0, writes: 0 }
  });
});

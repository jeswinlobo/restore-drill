import assert from 'node:assert/strict';
import test from 'node:test';
import { guidedDemo } from '../lib/demo.mjs';

test('the guided browser evidence distinguishes the broken path from same-count restored data', async () => {
  const { source, broken, fixed, checks } = await guidedDemo();
  assert.equal(source.folders.length, broken.folders.length);
  assert.equal(source.bookmarks.length, broken.bookmarks.length);
  const misplaced = broken.bookmarks.find((bookmark) => bookmark.unresolved);
  const matching = (library) => library.bookmarks.find((bookmark) => bookmark.url === misplaced.url);
  const expected = matching(source);
  const recovered = matching(fixed);
  assert.notDeepEqual(misplaced.segments, expected.segments);
  assert.deepEqual(recovered.segments, expected.segments);
  assert.equal(recovered.unresolved, null);
  assert.equal(checks.broken.serviceReason, 'assertion_error.confirmed_product_bug');
  assert.equal(checks.source.status, 'passed');
  assert.equal(checks.fixed.status, 'passed');
  assert.equal(checks.holdout.status, 'passed');
});

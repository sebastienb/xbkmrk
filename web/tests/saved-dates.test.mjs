import test from 'node:test';
import assert from 'node:assert/strict';
import { savedDateRange, parseSavedDateRange, savedDateClauses } from '../src/lib/saved-dates.ts';
process.env.TZ = 'America/New_York';
const now = new Date('2026-10-26T15:00:00Z');
const expected = (savedFrom, savedBefore) => ({ savedFrom, savedBefore });

test('presets use saved calendar dates and Monday weeks', () => {
  assert.deepEqual(savedDateRange('', '', '', now), {});
  assert.deepEqual(savedDateRange('today', '', '', now), expected('2026-10-26T04:00:00.000Z', '2026-10-27T04:00:00.000Z'));
  assert.deepEqual(savedDateRange('yesterday', '', '', now), expected('2026-10-25T04:00:00.000Z', '2026-10-26T04:00:00.000Z'));
  assert.deepEqual(savedDateRange('this_week', '', '', now), expected('2026-10-26T04:00:00.000Z', '2026-11-02T05:00:00.000Z'));
  assert.deepEqual(savedDateRange('last_week', '', '', now), expected('2026-10-19T04:00:00.000Z', '2026-10-26T04:00:00.000Z'));
});
test('inclusive custom end handles 23-hour and 25-hour days', () => {
  assert.deepEqual(savedDateRange('custom', '2026-03-08', '2026-03-08'), expected('2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'));
  assert.deepEqual(savedDateRange('custom', '2026-11-01', '2026-11-01'), expected('2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'));
  assert.throws(() => savedDateRange('custom', '2026-02-30', '2026-03-01'));
  assert.throws(() => savedDateRange('custom', '2026-10-26', '2026-10-25'));
  assert.throws(() => savedDateRange('custom', '', '2026-10-25'));
});
test('week boundaries cross years without excluding Sunday', () => {
  assert.deepEqual(savedDateRange('this_week', '', '', new Date('2027-01-03T15:00:00Z')), expected('2026-12-28T05:00:00.000Z', '2027-01-04T05:00:00.000Z'));
});
test('API accepts UTC bounds and rejects invalid or reversed ranges', () => {
  assert.deepEqual(parseSavedDateRange(new URLSearchParams()), {savedFrom: undefined, savedBefore: undefined});
  assert.equal(parseSavedDateRange(new URLSearchParams({saved_from: '2026-10-26T04:00:00Z'})).savedFrom, '2026-10-26T04:00:00.000Z');
  for (const saved_from of ['', 'today', '2026-02-30T00:00:00Z', '2026-10-26T00:00:00', "'; drop table bookmarks; --"]) {
    assert.throws(() => parseSavedDateRange(new URLSearchParams({saved_from})));
  }
  assert.throws(() => parseSavedDateRange(new URLSearchParams({saved_from: '2026-10-26T00:00:00Z', saved_before: '2026-10-25T00:00:00Z'})));
});
test('shared count, list and search predicates parameterize inclusive/exclusive bounds', () => {
  const range = savedDateRange('today', '', '', now);
  const params = ['existing filter'];
  assert.deepEqual(savedDateClauses(range, params), ['b.saved_at >= $2::timestamptz', 'b.saved_at < $3::timestamptz']);
  assert.deepEqual(params, ['existing filter', range.savedFrom, range.savedBefore]);
  assert.deepEqual(savedDateClauses({}, []), []);
});

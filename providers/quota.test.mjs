import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './quota.mjs';

test('supports legacy response, remaining percentage, unknown reset', () => {
  const [bucket] = normalize({ rateLimits: { primary: { usedPercent: 72, windowDurationMins: 300, resetsAt: null } } });
  assert.equal(bucket.windows[0].remaining, 28);
  assert.equal(bucket.windows[0].resetsAt, null);
});
test('preserves multiple buckets and omits unavailable windows', () => {
  const buckets = normalize({ rateLimits: { primary: { usedPercent: 1 } }, rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 105 }, secondary: null },
    other: { primary: { usedPercent: -3 }, secondary: { usedPercent: null } },
  } });
  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets.map(b => b.windows.map(w => w.remaining)), [[0], [100]]);
});
test('missing quotas stay unknown, never imply 100 percent remaining', () => {
  assert.deepEqual(normalize({}), []);
  assert.deepEqual(normalize({ rateLimits: { primary: {} } })[0].windows, []);
});

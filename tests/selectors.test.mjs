import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactQuota } from '../src/selectors.ts';
const model = (id, remaining) => ({ id, name: id, windows: [{ key: 'model', minutes: null, remaining, resetsAt: null }] });
const state = buckets => ({ running: true, error: null, snapshot: { updatedAt: new Date().toISOString(), buckets } });
test('Antigravity chooses version numerically, prioritizes Argon in equal release, and never maximizes quota', () => {
  const value = compactQuota('antigravity', state([model('gemini-3.5', 99), model('gemini-4-argon-high', 12), model('gemini-4-argon-low', 31), model('gemini-4-pro', 90)]));
  assert.equal(value.remaining, 12);
  assert.equal(compactQuota('antigravity', state([model('gemini-4.9', 98), model('gemini-4.10', 2)])).remaining, 2);
});
test('Codex and Claude compact never fall back from five hours to weekly', () => {
  const weekly = { id: 'quota', name: 'Quota', windows: [{ key: 'weekly', minutes: 10080, remaining: 80 }] };
  for (const provider of ['codex', 'claude']) assert.equal(compactQuota(provider, state([weekly])), null);
});
test('unknown versions, missing auth, stale data and closed tools never paint a fake gauge', () => {
  const active = state([model('gemini-4-argon', 0)]);
  assert.equal(compactQuota('antigravity', active).remaining, 0);
  assert.equal(compactQuota('antigravity', { ...active, running: false }), null);
  assert.equal(compactQuota('antigravity', { ...active, error: { code: 'NETWORK_ERROR' } }), null);
  assert.equal(compactQuota('antigravity', state([model('gemini-new', 90)])), null);
  active.snapshot.updatedAt = '2000-01-01T00:00:00Z'; assert.equal(compactQuota('antigravity', active), null);
});

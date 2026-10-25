import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coordinator, sanitizeSnapshot } from '../providers/coordinator.mjs';
const discovery = pids => ({ codex: { known: true, pids }, antigravity: { known: true, pids: [] }, claude: { known: true, pids: [] } });
const result = { ok: true, updatedAt: new Date().toISOString(), accessToken: 'never-forward', buckets: [{ id: 'one', name: 'Codex', windows: [{ key: '5h', minutes: 300, remaining: 0, resetsAt: null, secret: 'never-forward' }] }] };
const settle = () => new Promise(resolve => setImmediate(resolve));
test('snapshot allowlist drops auth, raw identity and malformed numbers', () => {
  const safe = sanitizeSnapshot(result);
  assert.equal(safe.buckets[0].windows[0].remaining, 0);
  assert.doesNotMatch(JSON.stringify(safe), /never-forward|accessToken/);
  assert.equal(sanitizeSnapshot({ ...result, buckets: [{ windows: [{ remaining: NaN }] }] }).ok, false);
});
test('closed providers never trigger credential readers', async () => {
  const coordinator = new Coordinator({ query: () => assert.fail(), publish: () => {} });
  coordinator.observe(discovery([])); await coordinator.refresh('codex');
  assert.equal(coordinator.states.codex.running, false);
});
test('temporary proxy PID changes cannot discard active Codex measurement', async () => {
  let resolve; let calls = 0;
  const coordinator = new Coordinator({ query: () => { calls++; return new Promise(done => resolve = done); }, publish: () => {} });
  coordinator.observe(discovery([1])); coordinator.observe(discovery([1, 2]));
  resolve(result); await settle();
  assert.equal(calls, 1); assert.equal(coordinator.states.codex.snapshot.ok, true);
});
test('closed or replaced original sessions invalidate in-flight quota', async () => {
  let resolve;
  const coordinator = new Coordinator({ query: () => new Promise(done => resolve = done), publish: () => {} });
  coordinator.observe(discovery([1])); coordinator.observe(discovery([]));
  assert.equal(coordinator.states.codex.loading, false);
  resolve(result); await settle();
  assert.equal(coordinator.states.codex.snapshot, null); assert.equal(coordinator.states.codex.running, false);
});
test('temporary errors retain timestamp and closed processes clear data', async () => {
  let now = 0; let response = result;
  const coordinator = new Coordinator({ query: async () => response, publish: () => {}, now: () => now });
  coordinator.observe(discovery([1])); await settle();
  response = { ok: false, code: 'NETWORK_ERROR', error: 'Connection lost' }; now = 200000;
  coordinator.observe(discovery([1])); await settle();
  assert.equal(coordinator.states.codex.snapshot.updatedAt, result.updatedAt);
  assert.equal(coordinator.states.codex.error.code, 'NETWORK_ERROR');
  coordinator.observe(discovery([])); assert.equal(coordinator.states.codex.snapshot, null);
});

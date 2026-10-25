import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaude, getClaudeSnapshot, readClaudeAuth } from './claude.mjs';
const running = async () => [{ id: 42 }];
test('Claude converts usage to remaining, preserving zero and model windows', () => {
  const buckets = normalizeClaude({ five_hour: { utilization: 100 }, seven_day: { utilization: 0 }, seven_day_sonnet: { utilization: 25 }, seven_day_opus: null });
  assert.deepEqual(buckets[0].windows.map(w => w.remaining), [0, 100]);
  assert.equal(buckets[1].name, 'Sonnet');
  assert.equal(buckets[1].windows[0].remaining, 75);
  assert.deepEqual(normalizeClaude({ five_hour: { utilization: '20' }, seven_day: { utilization: -1 } }), []);
});
test('closed Claude never reads credentials or calls API', async () => {
  const result = await getClaudeSnapshot({ detect: async () => [], load: () => assert.fail(), request: () => assert.fail() });
  assert.equal(result.code, 'NOT_RUNNING');
});
test('existing Claude OAuth is used without leaking token or identity', async () => {
  const result = await getClaudeSnapshot({ detect: running, load: async () => ({ accessToken: 'secret-test' }), request: async token => {
    assert.equal(token, 'secret-test');
    return { five_hour: { utilization: 23 }, email: 'private@example.test' };
  } });
  assert.equal(result.ok, true);
  assert.equal(result.buckets[0].windows[0].remaining, 77);
  assert.doesNotMatch(JSON.stringify(result), /secret-test|private@example/);
});
test('Claude discards quota if original session closes', async () => {
  let calls = 0;
  const result = await getClaudeSnapshot({ detect: async () => ++calls === 1 ? [{ id: 1 }] : [{ id: 2 }], load: async () => ({ accessToken: 'test' }), request: async () => ({ five_hour: { utilization: 0 } }) });
  assert.equal(result.code, 'NOT_RUNNING');
});
test('Claude auth rejects symlinks and waits for CLI to refresh expired tokens', async () => {
  const env = { USERPROFILE: 'C:\\test' };
  await assert.rejects(readClaudeAuth({ env, inspect: async () => ({ isFile: () => true, isSymbolicLink: () => true }), read: () => assert.fail() }), e => e.code === 'AUTH_INVALID');
  await assert.rejects(readClaudeAuth({ env, inspect: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 100 }), read: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'test', expiresAt: 1 } }) }), e => e.code === 'AUTH_EXPIRED');
});
test('Claude errors never return upstream response text', async () => {
  const result = await getClaudeSnapshot({ detect: running, load: async () => { throw new Error('secret-test'); } });
  assert.equal(result.code, 'API_ERROR');
  assert.doesNotMatch(JSON.stringify(result), /secret-test/);
});

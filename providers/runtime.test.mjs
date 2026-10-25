import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getQuotaSnapshot, sessionTarget } from './runtime.mjs';

const daemon = { id: 123, path: 'C:\\Users\\alice\\.codex\\packages\\app-server-daemon\\releases\\0.164.0\\bin\\codex.exe' };

test('does not query or start a server when Codex is closed', async () => {
  let called = false;
  const result = await getQuotaSnapshot({ detect: async () => [], query: async () => { called = true; } });
  assert.equal(result.code, 'NOT_RUNNING');
  assert.equal(called, false);
});
test('uses the running daemon executable and its existing home', () => {
  const target = sessionTarget([daemon], { USERPROFILE: 'C:\\OtherUser' });
  assert.equal(target.executable, daemon.path);
  assert.equal(target.home, 'C:\\Users\\alice\\.codex');
  assert.equal(target.proxy, true);
});
test('preserves explicitly inherited CODEX_HOME', () => {
  const target = sessionTarget([daemon], { CODEX_HOME: 'D:\\CodexProfile' });
  assert.equal(target.home, 'D:\\CodexProfile');
});
test('standalone CLI uses existing native executable and user profile', () => {
  const cli = { id: 42, path: 'C:\\npm\\vendor\\windows\\bin\\codex.exe' };
  const target = sessionTarget([cli], { USERPROFILE: 'C:\\Users\\alice' });
  assert.equal(target.executable, cli.path);
  assert.equal(target.proxy, false);
  assert.match(target.home, /alice[\\/]\.codex$/);
});
test('queries an active session and returns quota metadata', async () => {
  const result = await getQuotaSnapshot({ detect: async () => [daemon], query: async target => {
    assert.equal(target.proxy, true);
    return { ok: true, buckets: [{ name: 'codex', windows: [] }] };
  } });
  assert.equal(result.ok, true);
  assert.equal(result.connection, 'existing-server');
});
test('discards quota if the original Codex exits during a request', async () => {
  let checks = 0;
  const result = await getQuotaSnapshot({ detect: async () => ++checks === 1 ? [daemon] : [{ ...daemon, id: 999 }], query: async () => ({ ok: true, buckets: [] }) });
  assert.equal(result.code, 'NOT_RUNNING');
  assert.equal(result.buckets, undefined);
});
test('process detection failures do not claim Codex is closed', async () => {
  const result = await getQuotaSnapshot({ detect: async () => { throw new Error('denied'); }, query: () => assert.fail() });
  assert.equal(result.code, 'PROCESS_CHECK_FAILED');
});
test('local connection permissions are distinct from missing authentication', async () => {
  const result = await getQuotaSnapshot({ detect: async () => [daemon], query: async () => { throw new Error('os error 10013'); } });
  assert.equal(result.code, 'CONNECTION_BLOCKED');
});
test('session errors never expose raw diagnostics or request a new login', async () => {
  const result = await getQuotaSnapshot({ detect: async () => [daemon], query: async () => { throw new Error('private upstream diagnostic'); } });
  assert.equal(result.code, 'SESSION_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /private upstream|login|credential/i);
});

test('unreachable control socket falls back to the same CLI auth without login', async () => {
  const transports = [];
  const result = await getQuotaSnapshot({ detect: async () => [daemon], query: async target => {
    transports.push(target.proxy);
    if (target.proxy) throw new Error('failed to connect to socket');
    return { ok: true, buckets: [] };
  } });
  assert.deepEqual(transports, [true, false]);
  assert.equal(result.connection, 'existing-cli-auth');
});
test('does not bypass a denied socket by falling back to another transport', async () => {
  let attempts = 0;
  const result = await getQuotaSnapshot({ detect: async () => [daemon], query: async () => { attempts++; throw new Error('os error 10013'); } });
  assert.equal(attempts, 1);
  assert.equal(result.code, 'CONNECTION_BLOCKED');
});
test('does not start a fallback reader after Codex has closed', async () => {
  let checks = 0, requests = 0;
  const result = await getQuotaSnapshot({ detect: async () => ++checks === 1 ? [daemon] : [], query: async () => { requests++; throw new Error('failed to connect'); } });
  assert.equal(requests, 1);
  assert.equal(result.code, 'NOT_RUNNING');
});

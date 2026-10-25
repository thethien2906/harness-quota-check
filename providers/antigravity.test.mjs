import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { normalizeAntigravity, ownedPorts, localRpc, getLocalAntigravitySnapshot as getAntigravitySnapshot } from './antigravity.mjs';

const summary = { response: { groups: [{ displayName: 'Gemini Models', buckets: [
  { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.25, resetTime: '2026-10-25T08:00:00Z' },
  { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0 },
] }] } };
const ide = { id: 22, port: 50002, host: '127.0.0.1', csrf: 'local-test-session', kind: 'ide' };
const cli = { id: 11, port: 50001, host: '127.0.0.1', csrf: '', kind: 'cli' };
const discovery = candidates => async () => ({ running: true, candidates });

test('summary preserves separate five-hour and weekly remaining quotas, including zero', () => {
  const [bucket] = normalizeAntigravity(summary);
  assert.deepEqual(bucket.windows.map(w => [w.minutes, w.remaining]), [[300, 25], [10080, 0]]);
  assert.equal(bucket.windows[0].resetsAt, Date.parse('2026-10-25T08:00:00Z') / 1000);
  assert.equal(bucket.windows[1].resetsAt, null);
});
test('missing, malformed and out-of-range fractions never imply full quota', () => {
  assert.deepEqual(normalizeAntigravity({ groups: [{ buckets: [{}, { remainingFraction: '1' }, { remainingFraction: null }, { remainingFraction: 2 }] }] }), []);
});
test('older model quota does not invent a five-hour or weekly window', () => {
  const [bucket] = normalizeAntigravity({ userStatus: { userTier: { name: 'Pro' }, cascadeModelConfigData: { clientModelConfigs: [
    { label: 'Gemini Pro', quotaInfo: { remainingFraction: 0.72, resetTime: 'invalid' } },
  ] } } });
  assert.equal(bucket.plan, 'Pro');
  assert.equal(bucket.windows[0].remaining, 72);
  assert.equal(bucket.windows[0].minutes, null);
  assert.equal(bucket.windows[0].resetsAt, null);
});
test('discovery only probes listener ports owned by identified Antigravity processes', () => {
  const ports = ownedPorts(' TCP 127.0.0.1:50002 0.0.0.0:0 LISTENING 22\n TCP 127.0.0.1:50003 0.0.0.0:0 LISTENING 99\n TCP 10.0.0.2:50004 0.0.0.0:0 LISTENING 22\n TCP 127.0.0.1:50005 1.2.3.4:443 ESTABLISHED 22\n TCP [::1]:50002 [::]:0 LISTENING 22', [ide]);
  assert.deepEqual(ports.map(p => p.port), [50002]);
});
test('closed Antigravity never triggers a request, login, or process launch', async () => {
  const result = await getAntigravitySnapshot({ discover: async () => ({ running: false }), query: () => assert.fail('must not query') });
  assert.equal(result.code, 'NOT_RUNNING');
});
test('local discovery permissions remain distinct from a closed application', async () => {
  const result = await getAntigravitySnapshot({ discover: async () => ({ running: true, code: 'DISCOVERY_BLOCKED' }), query: () => assert.fail() });
  assert.equal(result.code, 'DISCOVERY_BLOCKED');
});
test('uses the legacy status RPC when summary RPC is not supported', async () => {
  const calls = [];
  const result = await getAntigravitySnapshot({ discover: discovery([ide]), query: async (_, method) => {
    calls.push(method);
    if (method === 'RetrieveUserQuotaSummary') throw Object.assign(new Error(), { code: 'RPC_UNAVAILABLE' });
    return { userStatus: { cascadeModelConfigData: { clientModelConfigs: [{ label: 'Claude', quotaInfo: { remainingFraction: 0.5 } }] } } };
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['RetrieveUserQuotaSummary', 'GetUserStatus']);
  assert.equal(result.buckets[0].name, 'IDE · Claude');
});
test('a CLI that withholds its local CSRF cannot hide working IDE quota', async () => {
  const result = await getAntigravitySnapshot({ discover: discovery([cli, ide]), query: async (candidate, method) => {
    if (method === 'GetLocalSession') return { csrf: null };
    if (candidate.kind === 'cli') throw Object.assign(new Error(), { code: 'LOCAL_AUTH_UNAVAILABLE' });
    return summary;
  } });
  assert.equal(result.ok, true);
  assert.equal(result.issues[0].code, 'LOCAL_AUTH_UNAVAILABLE');
  assert.equal(result.buckets[0].name, 'IDE · Gemini Models');
  assert.doesNotMatch(JSON.stringify(result), /local-test-session/);
});
test('CLI and IDE quota are labeled separately rather than combined across sessions', async () => {
  const result = await getAntigravitySnapshot({ discover: discovery([{ ...cli, csrf: 'cli-local-test' }, ide]), query: async () => summary });
  assert.equal(result.buckets.length, 2);
  assert.match(result.buckets[0].name, /^CLI/);
  assert.match(result.buckets[1].name, /^IDE/);
});
test('drops results if the Antigravity session closes during a request', async () => {
  let count = 0;
  const result = await getAntigravitySnapshot({ discover: async () => ++count === 1 ? { running: true, candidates: [ide] } : { running: false }, query: async () => summary });
  assert.equal(result.code, 'NOT_RUNNING');
  assert.equal(result.buckets, undefined);
});
test('cannot send local CSRF to a remote host', async () => {
  await assert.rejects(localRpc({ ...ide, host: 'example.com' }, 'GetUserStatus'), error => error.code === 'INVALID_ENDPOINT');
});
test('local RPC uses the exact Connect JSON request and never follows redirects', async () => {
  let redirected = false;
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect-target') { redirected = true; response.end('{}'); return; }
    assert.equal(request.headers['x-codeium-csrf-token'], 'local-test-session');
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/exa.language_server_pb.LanguageServerService/GetUserStatus');
    assert.equal(request.headers['connect-protocol-version'], '1');
    response.writeHead(302, { Location: '/redirect-target' }); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(localRpc({ ...ide, port: server.address().port }, 'GetUserStatus'), error => error.code === 'PROTOCOL_ERROR');
    assert.equal(redirected, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

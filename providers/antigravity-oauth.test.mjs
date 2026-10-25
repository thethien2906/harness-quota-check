import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedAuth, loadSavedAuth, normalizeCloudModels, mergeQuotaBuckets, fetchAccountQuota, googleJson } from './antigravity-oauth.mjs';
import { getAntigravitySnapshot, getLocalAntigravitySnapshot, normalizeAntigravity } from './antigravity.mjs';
import { removeOwnedBridge } from './cleanup-antigravity-bridge.mjs';
import { join } from 'node:path';

const auth = { source: 'jcode', accessToken: 'private-test-access', refreshToken: 'private-test-refresh', expiresAt: Date.now() + 3600000, email: 'alice@example.test' };
const summary = { groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.63 }] }] };
const candidate = { id: 44, port: 55555, host: '127.0.0.1', kind: 'cli', csrf: '' };
const error = code => Object.assign(new Error('private-token-must-not-escape'), { code });

test('parses both jcode epoch expiry and native Go OAuth expiry', () => {
  const first = parseSavedAuth({ access_token: 'test', expires_at: 1792900000000 }, 'jcode');
  assert.equal(first.expiresAt, 1792900000000);
  const second = parseSavedAuth({ token: { access_token: 'test', expiry: '2026-10-25T12:00:00Z' } }, 'agy-keyring');
  assert.equal(second.expiresAt, Date.parse('2026-10-25T12:00:00Z'));
});
test('prefers native CLI auth over jcode without opening any other file', async () => {
  const result = await loadSavedAuth({ readNative: async () => '{"access_token":"native"}', read: () => assert.fail(), inspect: () => assert.fail() });
  assert.equal(result.source, 'agy-keyring');
});
test('falls back to the one known jcode auth file and rejects symlinks', async () => {
  const result = await loadSavedAuth({ env: { USERPROFILE: 'C:\\Users\\test' }, readNative: async () => '', inspect: async path => {
    assert.equal(path, join('C:\\Users\\test', '.jcode', 'antigravity_oauth.json'));
    return { isFile: () => true, isSymbolicLink: () => false, size: 100 };
  }, read: async () => '{"access_token":"jcode"}' });
  assert.equal(result.source, 'jcode');
  await assert.rejects(loadSavedAuth({ env: { USERPROFILE: 'test' }, readNative: async () => '', inspect: async () => ({ isFile: () => true, isSymbolicLink: () => true }), read: () => assert.fail() }), error => error.code === 'AUTH_NOT_FOUND');
});
test('OAuth summary is read-only, uses the existing token and never exposes it', async () => {
  const result = await fetchAccountQuota({ load: async () => ({ ...auth }), normalizeSummary: normalizeAntigravity, request: async (url, options) => {
    assert.equal(options.accessToken, auth.accessToken);
    if (!url.endsWith('/v1internal:retrieveUserQuotaSummary')) return {};
    return summary;
  } });
  assert.equal(result.ok, true);
  assert.equal(result.buckets[0].windows[0].remaining, 63);
  assert.equal(result.accountLabel, 'a***@example.test');
  assert.doesNotMatch(JSON.stringify(result), /private-test-|alice@example/);
});
test('refreshes an expired access token in memory, without a login or credential write', async () => {
  const calls = [];
  const result = await fetchAccountQuota({ load: async () => ({ ...auth, expiresAt: 1 }), normalizeSummary: normalizeAntigravity, credentials: async () => ({ clientId: 'test-client-id', clientSecret: 'test-client-secret' }), request: async (url, options) => {
    calls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.form.grant_type, 'refresh_token');
      assert.equal(options.form.refresh_token, auth.refreshToken);
      assert.equal(options.form.client_id, 'test-client-id');
      assert.equal(options.form.client_secret, 'test-client-secret');
      return { access_token: 'new-private-access' };
    }
    assert.equal(options.accessToken, 'new-private-access');
    return summary;
  } });
  assert.equal(result.ok, true);
  assert.equal(calls.filter(url => url === 'https://oauth2.googleapis.com/token').length, 1);
  assert.ok(calls.some(url => url.endsWith('fetchAvailableModels')));
  assert.doesNotMatch(JSON.stringify(result), /private-access|private-refresh/);
});
test('jcode model API fallback preserves measured quota and does not invent time windows', async () => {
  const result = await fetchAccountQuota({ load: async () => ({ ...auth }), normalizeSummary: normalizeAntigravity, request: async url => {
    if (url.endsWith('retrieveUserQuotaSummary')) throw error('API_REQUEST_FAILED');
    return { models: { pro: { displayName: 'Gemini Pro', quotaInfo: { remainingFraction: 0.28, resetTime: '2026-10-26T00:00:00Z' } } } };
  } });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'oauth-models');
  assert.equal(result.buckets[0].windows[0].minutes, null);
  assert.equal(Math.round(result.buckets[0].windows[0].remaining), 28);
});
test('all-100 percent catalog data remains unverified instead of claiming fresh full quota', async () => {
  const result = await fetchAccountQuota({ load: async () => ({ ...auth }), request: async () => ({ models: { pro: { displayName: 'Pro', quotaInfo: { remainingFraction: 1 } } } }) });
  assert.equal(result.code, 'QUOTA_UNVERIFIED');
});
test('rejects missing or invalid fractions and internal catalog models', () => {
  assert.deepEqual(normalizeCloudModels({ models: { a: { displayName: 'A' }, b: { displayName: 'B', quotaInfo: { remainingFraction: '1' } }, c: { displayName: 'C', isInternal: true, quotaInfo: { remainingFraction: 0.5 } } } }), []);
});
test('auth and network errors return fixed codes and never raw exceptions', async () => {
  const result = await fetchAccountQuota({ load: async () => { throw error('AUTH_ACCESS_DENIED'); }, request: () => assert.fail() });
  assert.equal(result.code, 'AUTH_ACCESS_DENIED');
  assert.doesNotMatch(JSON.stringify(result), /private-token/);
});
test('OAuth transport cannot send tokens to an arbitrary URL or OAuth authorization page', async () => {
  for (const url of ['https://evil.example/v1internal:fetchAvailableModels', 'http://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', 'https://accounts.google.com/o/oauth2/auth']) {
    await assert.rejects(googleJson(url, { accessToken: auth.accessToken }), error => error.code === 'INVALID_ENDPOINT');
  }
});
test('a closed application never reads OAuth credentials', async () => {
  const result = await getAntigravitySnapshot({ discover: async () => ({ running: false }), fetchAccount: () => assert.fail() });
  assert.equal(result.code, 'NOT_RUNNING');
});
test('active application uses account API without statusline or local CSRF setup', async () => {
  const result = await getAntigravitySnapshot({ discover: async () => ({ running: true, candidates: [candidate] }), query: () => assert.fail(), fetchAccount: async () => ({ ok: true, source: 'oauth-summary', buckets: [{ name: 'Gemini', windows: [] }] }) });
  assert.equal(result.ok, true);
  assert.equal(result.buckets[0].name, 'API · Gemini');
});
test('duplicate IDE language servers collapse only when account identity matches', async () => {
  const servers = [{ ...candidate, id: 1, kind: 'ide', csrf: 'test' }, { ...candidate, id: 2, kind: 'ide', csrf: 'test' }];
  const result = await getLocalAntigravitySnapshot({ discover: async () => ({ running: true, candidates: servers }), query: async (_, method) => method === 'GetUserStatus' ? { userStatus: { email: 'same-account@example.test' } } : summary });
  assert.equal(result.buckets.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /same-account@example/);
});
test('cleanup removes only our exact old bridge command and preserves user settings', () => {
  const node = 'C:\\node.exe';
  const root = 'C:\\quota-peek';
  const own = { model: 'current', statusLine: { command: `call "${node}" "${join(root, 'antigravity-statusline.mjs')}"` } };
  assert.deepEqual(removeOwnedBridge(own, node, root), { model: 'current' });
  const user = { statusLine: { command: 'my-own-statusline' } };
  assert.equal(removeOwnedBridge(user, node, root), user);
});

test('fills missing Gemini windows without replacing production quota or duplicating model pools', () => {
  const third = { id: 'third', name: 'Claude and GPT models', windows: [{ key: '3p-weekly', remaining: 0.5 }] };
  const alternate = { id: 'other', name: 'Claude / GPT', windows: [{ key: '3p-weekly', remaining: 100 }, { key: '3p-5h', remaining: 100 }] };
  const gemini = { id: 'gemini', name: 'Gemini Models', windows: [{ key: 'gemini-weekly', remaining: 37 }] };
  const result = mergeQuotaBuckets([third], [alternate, gemini]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].windows.map(w => w.remaining), [0.5, 100]);
  assert.equal(result[1].windows[0].remaining, 37);
});
test('partial channel response is complemented with the same-account summary from the other channel', async () => {
  const result = await fetchAccountQuota({ load: async () => ({ ...auth }), normalizeSummary: normalizeAntigravity, request: async url => {
    if (url.startsWith('https://cloudcode-pa.googleapis.com')) return { groups: [{ displayName: 'Claude / GPT', buckets: [{ bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.005 }] }] };
    return summary;
  } });
  assert.equal(result.ok, true);
  assert.equal(result.buckets.length, 2);
  assert.equal(result.buckets[0].windows[0].remaining, 0.5);
});
test('missing saved project is resolved with loadCodeAssist before retrying catalog', async () => {
  let catalogs = 0;
  const result = await fetchAccountQuota({ load: async () => ({ ...auth, project: 'old-project' }), normalizeSummary: normalizeAntigravity, request: async (url, options) => {
    if (url.endsWith('retrieveUserQuotaSummary')) throw error('API_REQUEST_FAILED');
    if (url.endsWith('loadCodeAssist')) return { cloudaicompanionProject: { id: 'new-project' } };
    if (++catalogs === 1) throw error('API_REQUEST_FAILED');
    assert.equal(options.body.project, 'new-project');
    return { models: { pro: { displayName: 'Pro', quotaInfo: { remainingFraction: 0.4 } } } };
  } });
  assert.equal(result.ok, true);
  assert.equal(catalogs, 3);
});

test('summary diagnostics distinguish absent Gemini from discarded buckets without retaining raw fields', async () => {
  const result = await fetchAccountQuota({ load: async () => ({ ...auth }), normalizeSummary: normalizeAntigravity, request: async () => ({
    privateField: 'do-not-save', groups: [
      { displayName: 'Gemini', buckets: [{ window: 'weekly', resetTime: '2026-10-26T00:00:00Z', privateField: 'do-not-save' }] },
      { displayName: 'Claude and GPT models', buckets: [{ bucketId: '3p-5h', window: '5h', remainingFraction: 0.5 }] },
    ],
  }) });
  assert.equal(result.ok, true);
  assert.equal(result.summaryDiagnostics[0].groups[0].buckets[0].fraction, 'missing');
  assert.equal(result.summaryDiagnostics[0].groups[1].buckets[0].fraction, 'valid');
  assert.doesNotMatch(JSON.stringify(result.summaryDiagnostics), /do-not-save|private-test|example.test/);
});

test('catalog is requested first on every refresh even when summary supplies quota', async () => {
  const calls = [];
  const result = await fetchAccountQuota({ load: async () => ({ ...auth }), normalizeSummary: normalizeAntigravity, request: async url => {
    calls.push(url);
    if (url.endsWith('fetchAvailableModels')) return { models: { gemini: { displayName: 'Gemini Pro', quotaInfo: { remainingFraction: 0.28 } } } };
    return summary;
  } });
  assert.ok(calls[0].endsWith('fetchAvailableModels'));
  assert.equal(result.source, 'oauth-models+summary');
  assert.equal(result.buckets[0].name, 'Gemini Pro');
  assert.equal(Math.round(result.buckets[0].windows[0].remaining), 28);
  assert.equal(result.buckets[0].windows[0].minutes, null);
  assert.equal(result.buckets[1].windows[0].minutes, 10080);
});

test('discovers daily-only models dynamically and deduplicates by ID rather than display name', async () => {
  const result = await fetchAccountQuota({ load: async () => ({ ...auth }), normalizeSummary: normalizeAntigravity, request: async url => {
    if (!url.endsWith('fetchAvailableModels')) return summary;
    const models = { older: { displayName: 'Gemini', quotaInfo: { remainingFraction: 0.3 } } };
    if (url.includes('daily-cloudcode')) {
      models.newGeneration = { displayName: 'Gemini', quotaInfo: { remainingFraction: 0.7 } };
      models.withoutLabel = { quotaInfo: { remainingFraction: 0.4 } };
    }
    return { models };
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.buckets.filter(bucket => bucket.windows[0].key === 'model').map(bucket => bucket.id), ['older', 'newGeneration', 'withoutLabel']);
  assert.equal(result.buckets[2].name, 'withoutLabel');
});

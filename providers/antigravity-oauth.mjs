import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const hosts = new Set(['oauth2.googleapis.com', 'www.googleapis.com', 'cloudcode-pa.googleapis.com', 'daily-cloudcode-pa.googleapis.com']);
// Daily can omit the Gemini pool. Prefer production's summary, then fill only
// missing groups/windows from daily with the very same account token.
const summaryBases = ['https://cloudcode-pa.googleapis.com', 'https://daily-cloudcode-pa.googleapis.com'];
const identity = {
  'User-Agent': 'antigravity/1.18.3 windows/amd64',
  'x-goog-api-client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'client-metadata': '{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
};
const fail = code => Object.assign(new Error(code), { code });

// Installed-app OAuth identifiers, as used by jcode and Antigravity. Neither
// value grants access without the user's existing OAuth token, and neither is
// committed. Resolution order: build/runtime environment, the credential baked
// into a build (antigravity-oauth.json), then an untracked development file
// (antigravity-oauth.local.json) that is never copied into packaged resources.
const bundledCredentials = join(root, 'antigravity-oauth.json');
const localCredentials = join(root, 'antigravity-oauth.local.json');
let resolvedCredentials;
export async function resolveClientCredentials({ env = process.env, read = readFile } = {}) {
  const id = env.QUOTA_PEEK_ANTIGRAVITY_CLIENT_ID, secret = env.QUOTA_PEEK_ANTIGRAVITY_CLIENT_SECRET;
  if (id && secret) return { clientId: id, clientSecret: secret };
  for (const path of [bundledCredentials, localCredentials]) {
    try {
      const saved = JSON.parse((await read(path, 'utf8')).replace(/^\uFEFF/, ''));
      if (saved?.clientId && saved?.clientSecret) return { clientId: saved.clientId, clientSecret: saved.clientSecret };
    } catch { }
  }
  return null;
}
async function clientCredentials() {
  if (resolvedCredentials) return resolvedCredentials;
  const found = await resolveClientCredentials();
  if (!found) throw fail('AUTH_NOT_CONFIGURED');
  return (resolvedCredentials = found);
}

export function parseSavedAuth(raw, source) {
  let data = typeof raw === 'string' ? JSON.parse(raw.replace(/^\uFEFF/, '')) : raw;
  if (typeof data === 'string') data = JSON.parse(data);
  for (const key of ['token', 'tokens', 'oauth_token', 'oauthToken']) {
    if (data?.[key]) { data = typeof data[key] === 'string' ? JSON.parse(data[key]) : data[key]; break; }
  }
  const accessToken = data?.access_token ?? data?.accessToken;
  const refreshToken = data?.refresh_token ?? data?.refreshToken;
  if (!(typeof accessToken === 'string' && accessToken) && !(typeof refreshToken === 'string' && refreshToken)) throw fail('AUTH_INVALID_FORMAT');
  const expiry = data.expires_at ?? data.expiresAt ?? data.expiry_date ?? data.expiry;
  const expiresAt = typeof expiry === 'number' ? (expiry < 1e12 ? expiry * 1000 : expiry) : Date.parse(expiry);
  return { source, accessToken: accessToken || null, refreshToken: refreshToken || null, expiresAt,
    email: typeof data.email === 'string' ? data.email : null,
    project: typeof data.project_id === 'string' ? data.project_id : null };
}

export async function loadSavedAuth({ env = process.env, readNative, read = readFile, inspect = lstat } = {}) {
  const failures = [];
  try {
    const load = readNative || (async () => {
      const shell = join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const result = await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'read-antigravity-auth.ps1')], { windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024 });
      return result.stdout;
    });
    const raw = await load();
    if (raw?.trim()) return parseSavedAuth(raw, 'agy-keyring');
  } catch { failures.push('AUTH_ACCESS_DENIED'); }
  if (env.USERPROFILE) {
    const path = join(env.USERPROFILE, '.jcode', 'antigravity_oauth.json');
    try {
      const info = await inspect(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw fail('AUTH_INVALID_FORMAT');
      return parseSavedAuth(await read(path, 'utf8'), 'jcode');
    } catch (error) {
      if (['EACCES', 'EPERM'].includes(error.code)) failures.push('AUTH_ACCESS_DENIED');
    }
  }
  throw fail(failures.includes('AUTH_ACCESS_DENIED') ? 'AUTH_ACCESS_DENIED' : 'AUTH_NOT_FOUND');
}

export function googleJson(address, { accessToken, form, body = {}, signal, timeoutMs = 6000, method = 'POST' } = {}) {
  const url = new URL(address);
  const allowedPath = /^\/v1internal:(fetchAvailableModels|retrieveUserQuotaSummary|retrieveUserQuota|loadCodeAssist)$/.test(url.pathname)
    || (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token')
    || (url.hostname === 'www.googleapis.com' && url.pathname === '/oauth2/v1/userinfo');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.has(url.hostname) || !allowedPath) return Promise.reject(fail('INVALID_ENDPOINT'));
  const payload = method === 'GET' ? '' : form ? new URLSearchParams(form).toString() : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, signal, headers: { ...identity,
      'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      'Content-Length': Buffer.byteLength(payload), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    }, response => {
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { reject(fail('API_INVALID_RESPONSE')); response.destroy(); request.destroy(); }
        else chunks.push(chunk);
      });
      response.on('error', () => reject(fail('NETWORK_ERROR')));
      response.on('end', () => {
        // Never propagate an upstream response or native error: either could
        // contain identifying data. Only fixed codes leave this module.
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const code = response.statusCode === 403 && Buffer.concat(chunks).includes(Buffer.from('SUBSCRIPTION_REQUIRED')) ? 'PLAN_UNAVAILABLE'
            : [401, 403].includes(response.statusCode) || (response.statusCode === 400 && url.hostname === 'oauth2.googleapis.com') ? 'AUTH_REJECTED'
              : response.statusCode === 429 ? 'API_RATE_LIMITED' : 'API_REQUEST_FAILED';
          reject(fail(code)); return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(fail('API_INVALID_RESPONSE')); }
      });
    });
    const timer = setTimeout(() => request.destroy(fail('API_TIMEOUT')), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', error => reject(fail(error.code === 'API_TIMEOUT' || signal?.aborted ? 'API_TIMEOUT' : ['EACCES', 'EPERM'].includes(error.code) ? 'NETWORK_BLOCKED' : 'NETWORK_ERROR')));
    request.end(payload);
  });
}

function maskedEmail(email) {
  if (!email || !/^[^@]+@[^@]+$/.test(email)) return null;
  const [name, domain] = email.split('@');
  return name.slice(0, 1) + '***@' + domain;
}

export function normalizeCloudModels(data) {
  if (!data?.models || typeof data.models !== 'object') return [];
  return Object.entries(data.models).flatMap(([id, model]) => {
    const q = model?.quotaInfo;
    if (model.isInternal || typeof q?.remainingFraction !== 'number' || !Number.isFinite(q.remainingFraction) || q.remainingFraction < 0 || q.remainingFraction > 1) return [];
    const reset = Date.parse(q.resetTime);
    const name = String(model.displayName?.trim() || id).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 120);
    return [{ id, name, plan: null, windows: [{ key: 'model', label: 'Model quota', minutes: null, remaining: q.remainingFraction * 100, resetsAt: Number.isFinite(reset) ? Math.floor(reset / 1000) : null }] }];
  });
}

export function mergeQuotaBuckets(primary, secondary) {
  const groups = new Map();
  const seen = new Set();
  for (const bucket of [...primary, ...secondary]) {
    const groupKey = bucket.windows.some(window => /^gemini-(5h|weekly)$/.test(window.key)) ? 'gemini'
      : bucket.windows.some(window => /^3p-(5h|weekly)$/.test(window.key)) ? 'third-party' : bucket.name.trim().toLowerCase();
    if (!groups.has(groupKey)) groups.set(groupKey, { ...bucket, windows: [] });
    for (const window of bucket.windows) {
      const key = /^(gemini|3p)-/.test(window.key) ? window.key : `${groupKey}:${window.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.get(groupKey).windows.push(window);
    }
  }
  return [...groups.values()].filter(bucket => bucket.windows.length).map((bucket, index) => ({ ...bucket, id: `api-group-${index}` }));
}

export async function fetchAccountQuota({ load = loadSavedAuth, request = googleJson, normalizeSummary = () => [], credentials = clientCredentials, timeoutMs = 16000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const summaryDiagnostics = [];
  const inspectSummary = (base, data) => {
    const groups = data?.response?.groups ?? data?.groups;
    summaryDiagnostics.push({ channel: base === summaryBases[0] ? 'production' : 'daily',
      groups: Array.isArray(groups) ? groups.slice(0, 20).map(group => ({
        family: /gemini/i.test(group.displayName || '') ? 'gemini' : /claude|gpt/i.test(group.displayName || '') ? 'third-party' : 'other',
        buckets: (Array.isArray(group.buckets) ? group.buckets : []).slice(0, 20).map(bucket => ({
          window: ['weekly', '5h'].includes(bucket.window) ? bucket.window : 'other',
          fraction: !Object.hasOwn(bucket, 'remainingFraction') ? 'missing'
            : typeof bucket.remainingFraction === 'number' && Number.isFinite(bucket.remainingFraction) && bucket.remainingFraction >= 0 && bucket.remainingFraction <= 1 ? 'valid' : 'invalid',
          resetPresent: typeof bucket.resetTime === 'string',
        })),
      })) : [],
    });
    return normalizeSummary(data);
  };
  let auth;
  try {
    auth = await load();
    let token = auth.accessToken;
    let refreshed = false;
    const refresh = async () => {
      if (!auth.refreshToken) throw fail('AUTH_EXPIRED');
      const { clientId, clientSecret } = await credentials();
      const response = await request('https://oauth2.googleapis.com/token', { form: { grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: clientId, client_secret: clientSecret }, signal });
      if (typeof response.access_token !== 'string' || !response.access_token) throw fail('AUTH_INVALID_RESPONSE');
      token = response.access_token; refreshed = true;
      // Access tokens stay in memory. Never overwrite agy's or jcode's auth file.
    };
    if (!token || (Number.isFinite(auth.expiresAt) && auth.expiresAt <= Date.now() + 60000)) await refresh();
    let lastError = fail('API_REQUEST_FAILED');
    for (const base of summaryBases) {
      try {
        const call = async (path, body = {}) => {
          try { return await request(base + path, { accessToken: token, body, signal }); }
          catch (error) {
            if (error.code !== 'AUTH_REJECTED' || refreshed || !auth.refreshToken) throw error;
            await refresh(); return request(base + path, { accessToken: token, body, signal });
          }
        };
        // jcode's catalog is the default quota source on every refresh.
        // Summary windows enrich it, rather than controlling whether it runs.
        let catalogBuckets = [];
        let catalogStatus = 'unavailable';
        let catalogProject = auth.project;
        try {
          let models;
          try { models = await call('/v1internal:fetchAvailableModels', auth.project ? { project: auth.project } : {}); }
          catch (error) {
            if (['AUTH_REJECTED', 'NETWORK_BLOCKED', 'API_TIMEOUT'].includes(error.code)) throw error;
          }
          catalogBuckets = normalizeCloudModels(models);
          if (!catalogBuckets.length) {
            const config = await call('/v1internal:loadCodeAssist', { metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } });
            const project = config.cloudaicompanionProject;
            const id = typeof project === 'string' ? project : project?.id;
            catalogProject = typeof id === 'string' && id ? id : null;
            models = await call('/v1internal:fetchAvailableModels', typeof id === 'string' && id ? { project: id } : {});
            catalogBuckets = normalizeCloudModels(models);
          }
          // Channels can advertise different generations of models. A valid
          // production catalog must not prevent discovery of daily-only models.
          for (const other of summaryBases.filter(item => item !== base)) {
            try {
              const extra = normalizeCloudModels(await request(other + '/v1internal:fetchAvailableModels', { accessToken: token, body: catalogProject ? { project: catalogProject } : {}, signal }));
              const existing = new Set(catalogBuckets.map(bucket => bucket.id));
              catalogBuckets.push(...extra.filter(bucket => !existing.has(bucket.id)));
            } catch { /* Keep the catalog already measured. */ }
          }
          catalogStatus = catalogBuckets.length ? 'measured' : 'empty';
          if (catalogBuckets.length && catalogBuckets.every(bucket => bucket.windows.every(window => window.remaining === 100))) {
            catalogBuckets = [];
            catalogStatus = 'unverified';
          }
        } catch { /* Summary remains usable if the catalog is unavailable. */ }
        let buckets = [];
        let source = 'oauth-models';
        try { buckets = inspectSummary(base, await call('/v1internal:retrieveUserQuotaSummary')); source = 'oauth-summary'; }
        catch (error) { if (['AUTH_REJECTED', 'NETWORK_BLOCKED', 'API_TIMEOUT'].includes(error.code)) throw error; }
        if (buckets.length) {
          for (const other of summaryBases.filter(item => item !== base)) {
            try {
              const extra = inspectSummary(other, await request(other + '/v1internal:retrieveUserQuotaSummary', { accessToken: token, body: {}, signal }));
              buckets = mergeQuotaBuckets(buckets, extra);
            } catch { summaryDiagnostics.push({ channel: other === summaryBases[0] ? 'production' : 'daily', status: 'unavailable' }); }
          }
        }
        const hasSummary = buckets.length > 0;
        buckets = [...catalogBuckets, ...buckets];
        source = catalogBuckets.length ? (hasSummary ? 'oauth-models+summary' : 'oauth-models') : source;
        summaryDiagnostics.push({ channel: base === summaryBases[0] ? 'production' : 'daily', catalog: catalogStatus, modelCount: catalogBuckets.length });
        if (!buckets.length && catalogStatus === 'unverified') throw fail('QUOTA_UNVERIFIED');
        if (!buckets.length) throw fail('QUOTA_UNAVAILABLE');
        if (!auth.email) {
          try { auth.email = (await request('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', { accessToken: token, method: 'GET', signal })).email; } catch { }
        }
        const accountKey = createHash('sha256').update(auth.email?.toLowerCase() || auth.refreshToken || token).digest('hex');
        const geminiMissing = !buckets.some(bucket => bucket.windows.some(window => /^gemini-/.test(window.key)) || /gemini/i.test(bucket.name));
        return { ok: true, updatedAt: new Date().toISOString(), connection: 'existing-oauth', source, authSource: auth.source,
          accountKey, accountLabel: maskedEmail(auth.email), buckets, summaryDiagnostics,
          notice: `Source: OAuth ${auth.source === 'jcode' ? 'jcode' : 'Antigravity CLI'}${maskedEmail(auth.email) ? ' · ' + maskedEmail(auth.email) : ''}. Quota for the saved account.${geminiMissing ? ' The API has not returned Gemini quota.' : ''}`,
        };
      } catch (error) {
        lastError = error;
        if (['AUTH_REJECTED', 'AUTH_EXPIRED', 'NETWORK_BLOCKED', 'API_TIMEOUT'].includes(error.code)) break;
      }
    }
    throw lastError;
  } catch (error) {
    const messages = {
      AUTH_NOT_FOUND: 'No saved Antigravity credentials found.',
      AUTH_ACCESS_DENIED: 'This environment cannot access existing Antigravity credentials.',
      AUTH_REJECTED: 'Google rejected the saved credentials.', AUTH_EXPIRED: 'The saved credentials have no usable access token.',
      AUTH_NOT_CONFIGURED: 'Antigravity OAuth client credentials are not configured on this machine.',
      NETWORK_BLOCKED: 'This environment blocks connections to Google.', NETWORK_ERROR: 'Could not connect to the Google API.',
      API_TIMEOUT: 'The Google quota request timed out.', API_RATE_LIMITED: 'The quota API is rate limited.',
      PLAN_UNAVAILABLE: 'This API does not provide quota for the saved account plan.',
      QUOTA_UNVERIFIED: 'The API returned only full quotas; actual usage could not be verified.', QUOTA_UNAVAILABLE: 'The API returned no usable quota.',
    };
    const code = messages[error.code] ? error.code : 'API_REQUEST_FAILED';
    return { ok: false, code, error: messages[code] || 'Could not read quota from the Antigravity API.', authSource: auth?.source || null };
  }
}

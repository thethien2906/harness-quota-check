import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { fetchAccountQuota } from './antigravity-oauth.mjs';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const SERVICE = '/exa.language_server_pb.LanguageServerService/';
const failure = (code, text) => ({ ok: false, code, error: text });
const safeLabel = (value, fallback) => typeof value === 'string' && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 120) : fallback;
const fraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value * 100 : null;
const resetSeconds = value => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

export function normalizeAntigravity(data) {
  const groups = data?.response?.groups ?? data?.groups;
  if (Array.isArray(groups)) return groups.map((group, index) => ({
    id: `group-${index}`, name: safeLabel(group.displayName, 'Model group'), plan: null,
    windows: (Array.isArray(group.buckets) ? group.buckets : []).flatMap((bucket, i) => {
      const remaining = fraction(bucket.remainingFraction);
      if (remaining === null) return [];
      const minutes = bucket.window === 'weekly' ? 10080 : bucket.window === '5h' ? 300 : null;
      return [{ key: safeLabel(bucket.bucketId, `quota-${i}`), label: minutes ? null : safeLabel(bucket.displayName, 'Quota'), minutes, remaining, resetsAt: resetSeconds(bucket.resetTime) }];
    }),
  })).filter(group => group.windows.length);

  // Older IDE releases report one effective quota per model. Do not invent
  // separate five-hour/weekly windows from this combined figure.
  const status = data?.userStatus;
  const models = status?.cascadeModelConfigData?.clientModelConfigs;
  if (!Array.isArray(models)) return [];
  const plan = safeLabel(status?.userTier?.name ?? status?.planStatus?.planInfo?.planName, null);
  return models.flatMap((model, index) => {
    const remaining = fraction(model.quotaInfo?.remainingFraction);
    if (remaining === null) return [];
    return [{ id: `model-${index}`, name: safeLabel(model.label ?? model.modelOrAlias?.model, 'Model'), plan,
      windows: [{ key: 'model', label: 'Model quota', minutes: null, remaining, resetsAt: resetSeconds(model.quotaInfo.resetTime) }] }];
  });
}

export function ownedPorts(text, servers) {
  const owners = new Map(servers.map(server => [Number(server.id), server]));
  const candidates = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== 'TCP' || parts.length < 5 || parts[3] !== 'LISTENING') continue;
    const server = owners.get(Number(parts[4]));
    if (!server) continue;
    const match = parts[1].match(/^(127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):(\d+)$/);
    if (!match) continue;
    const port = Number(match[2]);
    if (port < 1 || port > 65535 || seen.has(port)) continue;
    seen.add(port);
    candidates.push({ ...server, port, host: match[1].startsWith('[') ? '::1' : '127.0.0.1' });
  }
  return candidates.sort((a, b) => a.id - b.id || b.port - a.port).slice(0, 12);
}

export async function discoverAntigravity() {
  const shell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await execute(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'discover-antigravity.ps1')], { windowsHide: true, timeout: 8000, maxBuffer: 256 * 1024 });
  const data = JSON.parse(stdout);
  if (!data.running || data.code || !data.servers?.length) return { ...data, candidates: [] };
  const netstat = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'netstat.exe');
  const ports = await execute(netstat, ['-ano', '-p', 'tcp'], { windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
  return { running: true, products: data.products, candidates: ownedPorts(ports.stdout, data.servers) };
}

// Hosts come only from the verified PID-owned local listener table. No redirects
// or configurable remote URL can receive the temporary CSRF header.
export function localRpc(candidate, method, { tls = false, timeoutMs = 2000, signal } = {}) {
  if (!['127.0.0.1', '::1'].includes(candidate.host) || !Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535) {
    return Promise.reject(Object.assign(new Error('Invalid local endpoint'), { code: 'INVALID_ENDPOINT' }));
  }
  if (!['RetrieveUserQuotaSummary', 'GetUserStatus', 'GetLocalSession'].includes(method)) return Promise.reject(new Error('Unsupported RPC'));
  const readPage = method === 'GetLocalSession';
  return new Promise((resolve, reject) => {
    const request = (tls ? https : http).request({ hostname: candidate.host, port: candidate.port, path: readPage ? '/' : SERVICE + method, method: readPage ? 'GET' : 'POST',
      // The embedded language server has a self-signed certificate. This option
      // is scoped to this loopback-only request, never to the global TLS agent.
      ...(tls ? { rejectUnauthorized: false } : {}), signal,
      headers: { 'Content-Type': 'application/json', 'Content-Length': readPage ? '0' : '2', 'Connect-Protocol-Version': '1', ...(candidate.csrf ? { 'x-codeium-csrf-token': candidate.csrf } : {}) },
    }, response => {
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { response.destroy(); request.destroy(); reject(Object.assign(new Error('Response too large'), { code: 'PROTOCOL_ERROR' })); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          let code = response.statusCode === 401 || response.statusCode === 403 ? 'LOCAL_AUTH_UNAVAILABLE' : 'PROTOCOL_ERROR';
          if (response.statusCode === 404 || response.statusCode === 501) code = 'RPC_UNAVAILABLE';
          if (response.statusCode === 400 && /HTTP request to an HTTPS server/i.test(text)) code = 'TLS_REQUIRED';
          reject(Object.assign(new Error(code), { code })); return;
        }
        if (readPage) { resolve({ csrf: text.match(/"csrfToken"\s*:\s*"([^"\r\n]+)"/)?.[1] || null }); return; }
        try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('Invalid JSON'), { code: 'PROTOCOL_ERROR' })); }
      });
    });
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('Request timeout'), { code: 'QUOTA_TIMEOUT' })), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    request.end(readPage ? undefined : '{}');
  });
}

export async function getLocalAntigravitySnapshot({ discover = discoverAntigravity, query = localRpc, readCached = async () => [], timeoutMs = 14000 } = {}) {
  let discovered;
  try { discovered = await discover(); }
  catch { return failure('DISCOVERY_BLOCKED', 'Could not check the local Antigravity connection.'); }
  if (!discovered.running) return failure('NOT_RUNNING', 'Antigravity not running');
  if (discovered.code) return failure(discovered.code, 'Antigravity is running · access to local connection details was denied.');
  if (!discovered.candidates?.length) return failure('SERVER_STARTING', 'Antigravity is running · waiting for the local server.');
  const deadline = Date.now() + timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  let lastCode = 'SESSION_UNAVAILABLE';
  const snapshots = await readCached(discovered.candidates);
  const issues = [];
  const successfulIds = new Set(snapshots.map(snapshot => snapshot.original.id));
  const rejectedIds = new Set();
  for (const original of discovered.candidates) {
    if (successfulIds.has(original.id) || rejectedIds.has(original.id)) continue;
    const candidate = { ...original };
    let tls = false;
    for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
      try {
        if (!candidate.csrf) {
          try { candidate.csrf = (await query(candidate, 'GetLocalSession', { tls, signal })).csrf || ''; }
          catch (error) { if (error.code !== 'RPC_UNAVAILABLE') throw error; }
        }
        let data;
        let source = 'quota-summary';
        try { data = await query(candidate, 'RetrieveUserQuotaSummary', { tls, signal }); }
        catch (error) {
          if (error.code !== 'RPC_UNAVAILABLE') throw error;
          source = 'model-status'; data = await query(candidate, 'GetUserStatus', { tls, signal });
        }
        let buckets = normalizeAntigravity(data);
        if (!buckets.length && source === 'quota-summary') {
          source = 'model-status'; buckets = normalizeAntigravity(await query(candidate, 'GetUserStatus', { tls, signal }));
        }
        if (!buckets.length) {
          issues.push({ kind: original.kind || 'ide', ...failure('QUOTA_UNAVAILABLE', 'No quota is available for this session.') });
          rejectedIds.add(original.id); break;
        }
        let status = data?.userStatus;
        if (!status) { try { status = (await query(candidate, 'GetUserStatus', { tls, signal }))?.userStatus; } catch { } }
        const identity = status?.email?.toLowerCase() || status?.userId || status?.id;
        const accountKey = identity ? createHash('sha256').update(String(identity)).digest('hex') : null;
        snapshots.push({ original, source, buckets, accountKey, updatedAt: new Date().toISOString() });
        successfulIds.add(original.id);
        break;
      } catch (error) {
        const code = error.code;
        if (code === 'EACCES' || code === 'EPERM' || code === 'LOCAL_AUTH_UNAVAILABLE') {
          const blocked = code !== 'LOCAL_AUTH_UNAVAILABLE';
          issues.push({ kind: original.kind || 'ide', ...failure(blocked ? 'CONNECTION_BLOCKED' : code, blocked ? 'Local connection access was denied.' : candidate.csrf ? 'The server has not accepted the current connection.' : 'The running session has not exposed a quota access token.') });
          rejectedIds.add(original.id); break;
        }
        if (!tls && (code === 'TLS_REQUIRED' || code === 'ECONNRESET')) { tls = true; continue; }
        lastCode = code === 'QUOTA_TIMEOUT' || signal.aborted ? 'QUOTA_TIMEOUT' : 'SESSION_UNAVAILABLE';
        break;
      }
    }
  }
  if (snapshots.length) {
    let alive;
    try { alive = await discover(); } catch { return failure('DISCOVERY_BLOCKED', 'Could not recheck the Antigravity session.'); }
    if (!alive.running) return failure('NOT_RUNNING', 'Antigravity not running');
    const active = snapshots.filter(({ original }) => alive.candidates?.some(item => item.id === original.id && item.port === original.port && item.csrf === original.csrf));
    // Collapse duplicate IDE windows only when they identify the same account.
    // Equal percentages alone are not evidence of a shared account.
    const byAccount = new Map();
    for (const snapshot of active) {
      const key = `${snapshot.original.kind}:${snapshot.accountKey || snapshot.original.id}`;
      const previous = byAccount.get(key);
      if (!previous || (snapshot.source === 'quota-summary' && previous.source !== 'quota-summary')) byAccount.set(key, snapshot);
    }
    const valid = [...byAccount.values()];
    if (!valid.length) return failure('SESSION_CHANGED', 'The Antigravity session changed · select Refresh.');
    const knownKinds = new Set([...valid.map(s => s.original.kind || 'ide'), ...issues.map(i => i.kind)]);
    for (const kind of discovered.products || []) if (!knownKinds.has(kind)) issues.push({ kind, ...failure('SERVER_STARTING', 'Waiting for the local server.') });
    return { ok: true, updatedAt: new Date(Math.min(...valid.map(snapshot => Date.parse(snapshot.updatedAt)))).toISOString(), connection: 'existing-antigravity-session', source: 'local',
      notice: issues.map(issue => `${issue.kind === 'cli' ? 'CLI' : 'IDE'}: ${issue.error}`).join(' '),
      buckets: valid.flatMap(({ original, buckets }) => buckets.map(bucket => ({ ...bucket, id: `${original.kind || 'ide'}-${original.id}-${bucket.id}`, name: `${original.kind === 'cli' ? 'CLI' : 'IDE'} · ${bucket.name}` }))),
      sources: valid.map(s => ({ kind: s.original.kind || 'ide', source: s.source })),
      issues: issues.map(({ kind, code }) => ({ kind, code })),
    };
  }
  if (issues.length) return { ...failure(issues[0].code, issues.map(issue => `${issue.kind === 'cli' ? 'Antigravity CLI' : 'Antigravity IDE'}: ${issue.error}`).join(' ')), issues: issues.map(({ kind, code }) => ({ kind, code })) };
  if (signal.aborted || Date.now() >= deadline) lastCode = 'QUOTA_TIMEOUT';
  return failure(lastCode, lastCode === 'QUOTA_TIMEOUT' ? 'The Antigravity quota request timed out.' : 'Antigravity is running · could not connect to the local quota server.');
}

// Account API first: same request/auth contract as jcode. No agy process is
// started, restarted, modified, or driven through terminal commands.
export async function getAntigravitySnapshot({ discover = discoverAntigravity, query = localRpc, fetchAccount = fetchAccountQuota } = {}) {
  let initial;
  try { initial = await discover(); } catch { return failure('DISCOVERY_BLOCKED', 'Could not check the running Antigravity session.'); }
  if (!initial.running) return failure('NOT_RUNNING', 'Antigravity not running');
  if (initial.code) return failure(initial.code, 'This environment cannot read Antigravity session details.');
  const account = await fetchAccount({ normalizeSummary: normalizeAntigravity });
  if (account.ok) {
    let alive;
    try { alive = await discover(); } catch { return failure('DISCOVERY_BLOCKED', 'Could not recheck the Antigravity session.'); }
    if (!alive.running) return failure('NOT_RUNNING', 'Antigravity not running');
    return { ...account, buckets: account.buckets.map(bucket => ({ ...bucket, name: `API · ${bucket.name}` })) };
  }
  const local = await getLocalAntigravitySnapshot({ discover, query });
  if (local.ok) return { ...local, notice: [account.error, local.notice].filter(Boolean).join(' '), apiAttempt: { code: account.code, authSource: account.authSource } };
  if (local.code === 'NOT_RUNNING') return local;
  return { ...account, issues: local.issues || [], localAttempt: { code: local.code } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await getAntigravitySnapshot();
  const { ok, code, connection, source, authSource, apiAttempt, summaryDiagnostics } = result;
  try { writeFileSync(join(root, 'antigravity-status.json'), JSON.stringify({ checkedAt: new Date().toISOString(), ok, code, connection, source, authSource, apiAttempt, summaryDiagnostics }, null, 2)); } catch {}
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { getQuotaSnapshot } from './runtime.mjs';
import { websocketStream } from './websocket-stream.mjs';

// Use the installed CLI's authentication; never read or copy credential files.
export function resolveCodex(executable = process.env.CODEX_EXECUTABLE) {
  if (executable) return [executable, []];
  const dirs = (process.env.PATH || '').split(';');
  for (const dir of dirs) {
    const exe = join(dir, 'codex.exe');
    if (existsSync(exe)) return [exe, []];
    const js = join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (existsSync(js)) return [process.execPath, [js]];
  }
  const js = join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (existsSync(js)) return [process.execPath, [js]];
  throw new Error('Could not find the active Codex CLI.');
}

export function normalize(result) {
  const buckets = result.rateLimitsByLimitId;
  const limits = buckets && Object.keys(buckets).length ? Object.entries(buckets) : [['codex', result.rateLimits]];
  return limits.filter(([, b]) => b).map(([id, b]) => ({
    id, name: b.limitName || id, plan: b.planType || null,
    windows: ['primary', 'secondary'].flatMap(key => {
      const w = b[key];
      if (!w || !Number.isFinite(w.usedPercent)) return [];
      return [{ key, remaining: Math.max(0, Math.min(100, 100 - w.usedPercent)), minutes: w.windowDurationMins, resetsAt: w.resetsAt }];
    }),
  }));
}

export async function readQuota({ proxy = false, executable, home, spawnProcess = spawn, timeoutMs = 15000 } = {}) {
  const [exe, args] = resolveCodex(executable);
  const options = proxy ? ['proxy', ...(home ? ['--sock', join(home, 'app-server-control', 'app-server-control.sock')] : [])] : [];
  const child = spawnProcess(exe, [...args, 'app-server', ...options], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: dirname(fileURLToPath(import.meta.url)), env: { ...process.env, ...(home ? { CODEX_HOME: home } : {}) } });
  // Keep stderr private. It is used only to classify local connection failures.
  let stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4096); });
  let lines;
  let websocket;
  let phase = proxy ? 'websocket-handshake' : 'initialize';
  let sequence = 0;
  const pending = new Map();
  let failure;
  const fail = error => { error.phase ||= phase; failure = error; for (const p of pending.values()) p.reject(error); pending.clear(); websocket?.abort(error); };
  child.on('error', fail);
  child.on('exit', () => fail(new Error(stderr || 'The Codex connection closed.')));
  child.stdin.on('error', fail);
  const receive = line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    if (message.error) { const error = new Error(message.error.message); error.phase = phase; p.reject(error); }
    else p.resolve(message.result);
  };
  const send = message => {
    const json = JSON.stringify(message);
    if (websocket) websocket.send(json);
    else child.stdin.write(json + '\n');
  };
  if (proxy) websocket = websocketStream(child.stdout, child.stdin, receive, fail);
  else { lines = createInterface({ input: child.stdout }); lines.on('line', receive); }
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
  const timer = setTimeout(() => { const error = new Error('Quota request timeout'); error.code = 'QUOTA_TIMEOUT'; fail(error); child.kill(); }, timeoutMs);
  try {
    if (websocket) await websocket.ready;
    phase = 'initialize';
    await request('initialize', { clientInfo: { name: 'quota_peek', title: 'Quota Peek', version: '0.2.0' } });
    send({ method: 'initialized', params: {} });
    phase = 'rate-limits';
    const result = await request('account/rateLimits/read', null);
    return { ok: true, updatedAt: new Date().toISOString(), buckets: normalize(result) };
  } finally {
    clearTimeout(timer);
    lines?.close();
    websocket?.dispose();
    child.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await getQuotaSnapshot({ query: readQuota });
    const { ok, code, phase, connection, attempts } = result;
    // Local diagnostics contain only fixed state codes, no account or quota data.
    try { writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'quota-status.json'), JSON.stringify({ checkedAt: new Date().toISOString(), ok, code, phase, connection, attempts }, null, 2)); } catch {}
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  }
  catch (error) { console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
}

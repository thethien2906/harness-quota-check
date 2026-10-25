import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execute = promisify(execFile);

// Only process names and executable paths; never inspect command lines or memory.
export async function detectRunningCodex() {
  const shell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = "$ErrorActionPreference='Stop'; @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -eq 'codex' } | ForEach-Object { @{id=$_.Id;path=$_.Path} }) | ConvertTo-Json -Compress";
  const { stdout } = await execute(shell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 128 * 1024 });
  const processes = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(processes) ? processes : [processes];
}

export function sessionTarget(processes, env = process.env) {
  if (!processes.length) return null;
  const daemon = processes.find(p => /[\\/]packages[\\/]app-server-daemon[\\/].*[\\/]bin[\\/]codex\.exe$/i.test(p.path || ''));
  const native = processes.find(p => /[\\/]vendor[\\/].*[\\/]bin[\\/]codex\.exe$/i.test(p.path || ''));
  const inferredHome = daemon?.path.replace(/[\\/]packages[\\/]app-server-daemon[\\/].*$/i, '');
  return {
    executable: daemon?.path || native?.path || env.CODEX_EXECUTABLE || null,
    home: env.CODEX_HOME || inferredHome || (env.USERPROFILE ? join(env.USERPROFILE, '.codex') : null),
    proxy: Boolean(daemon),
    pids: processes.map(p => p.id),
  };
}

export function quotaFailure(error) {
  const message = error.message || '';
  let code = 'SESSION_UNAVAILABLE';
  let text = 'Could not read quota from the existing session.';
  if (/10013|10050|access.*denied|permission|forbidden/i.test(message)) {
    code = 'CONNECTION_BLOCKED'; text = 'Local connection access was denied.';
  } else if (error.code === 'QUOTA_TIMEOUT' || /timeout/i.test(message)) {
    code = 'QUOTA_TIMEOUT'; text = 'Codex did not respond within 15 seconds.';
  } else if (/authentication required|unauthenticated|not logged|401/i.test(message)) {
    code = 'AUTH_UNAVAILABLE'; text = 'This session has not shared authentication for quota access.';
  } else if (/failed to connect|not found|10061|10060|10049|ENOENT/i.test(message)) {
    code = 'SOCKET_UNAVAILABLE'; text = 'Could not find a connection to the running server.';
  } else if (/websocket|handshake|upgrade|invalid.*method|unrecognized subcommand/i.test(message)) {
    code = 'PROTOCOL_ERROR'; text = 'The server connection uses an incompatible protocol.';
  }
  const phase = ['websocket-handshake', 'initialize', 'rate-limits'].includes(error.phase) ? error.phase : null;
  return { ok: false, code, error: 'Codex is running · ' + text, phase };
}

export async function getQuotaSnapshot({ detect = detectRunningCodex, query, env = process.env } = {}) {
  let target;
  try { target = sessionTarget(await detect(), env); }
  catch { return { ok: false, code: 'PROCESS_CHECK_FAILED', error: 'Could not check whether Codex is running.' }; }
  if (!target) return { ok: false, code: 'NOT_RUNNING', error: 'Codex not running' };
  const attempts = [];
  try {
    let result;
    try { result = await query(target); }
    catch (error) {
      const first = quotaFailure(error);
      attempts.push({ transport: target.proxy ? 'websocket' : 'stdio', code: first.code, phase: first.phase });
      // Some Codex builds lack a reachable control socket. The CLI can still
      // reuse its existing local auth without any login or token handling here.
      if (!target.proxy || !['QUOTA_TIMEOUT', 'SOCKET_UNAVAILABLE', 'PROTOCOL_ERROR', 'AUTH_UNAVAILABLE'].includes(first.code)) throw error;
      const alive = await detect();
      if (!alive.some(p => target.pids.includes(p.id))) return { ok: false, code: 'NOT_RUNNING', error: 'Codex not running' };
      target = { ...target, proxy: false };
      result = await query(target);
    }
    // Discard a response if the original Codex instance closed during the request.
    const alive = await detect();
    if (!alive.some(p => target.pids.includes(p.id))) return { ok: false, code: 'NOT_RUNNING', error: 'Codex not running' };
    return { ...result, connection: target.proxy ? 'existing-server' : 'existing-cli-auth', attempts };
  } catch (error) {
    return { ...quotaFailure(error), attempts };
  }
}

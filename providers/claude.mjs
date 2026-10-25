import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const fail = code => Object.assign(new Error(code), { code });
export async function detectClaude() {
  const shell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-File', join(root, 'discover-claude.ps1')], { windowsHide: true, timeout: 8000 });
  const data = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(data) ? data : [data];
}
export async function readClaudeAuth({ env = process.env, read = readFile, inspect = lstat } = {}) {
  const home = env.CLAUDE_CONFIG_DIR || (env.USERPROFILE && join(env.USERPROFILE, '.claude'));
  if (!home) throw fail('AUTH_NOT_FOUND');
  const path = join(home, '.credentials.json');
  const info = await inspect(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw fail('AUTH_INVALID');
  const data = JSON.parse((await read(path, 'utf8')).replace(/^\uFEFF/, ''));
  const oauth = data.claudeAiOauth;
  if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) throw fail('AUTH_NOT_FOUND');
  // Refresh tokens may rotate. Leave their lifecycle to the running Claude CLI.
  if (Number.isFinite(oauth.expiresAt) && oauth.expiresAt <= Date.now()) throw fail('AUTH_EXPIRED');
  return oauth;
}
export function requestClaudeUsage(accessToken) {
  return new Promise((resolve, reject) => {
    const request = https.get('https://api.anthropic.com/api/oauth/usage', { headers: {
      Authorization: `Bearer ${accessToken}`, 'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'QuotaPeek/1.0', Accept: 'application/json',
    } }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) { request.destroy(); reject(fail('INVALID_RESPONSE')); }
        else chunks.push(chunk);
      });
      response.on('error', () => reject(fail('NETWORK_ERROR')));
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(fail(response.statusCode === 401 ? 'AUTH_REJECTED' : response.statusCode === 403 ? 'ACCESS_DENIED' : response.statusCode === 429 ? 'RATE_LIMITED' : 'API_ERROR')); return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(fail('INVALID_RESPONSE')); }
      });
    });
    const timer = setTimeout(() => { reject(fail('API_TIMEOUT')); request.destroy(); }, 10000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(fail('NETWORK_ERROR')));
  });
}
export function normalizeClaude(data) {
  const definitions = [
    ['five_hour', 'Claude', 300, '5 hours'], ['seven_day', 'Claude', 10080, '7 days'],
    ['seven_day_sonnet', 'Sonnet', 10080, '7 days'], ['seven_day_opus', 'Opus', 10080, '7 days'],
    ['seven_day_oauth_apps', 'OAuth apps', 10080, '7 days'],
  ];
  const buckets = new Map();
  for (const [key, name, minutes, label] of definitions) {
    const value = data?.[key];
    if (typeof value?.utilization !== 'number' || !Number.isFinite(value.utilization) || value.utilization < 0 || value.utilization > 100) continue;
    if (!buckets.has(name)) buckets.set(name, { id: key, name, windows: [] });
    const reset = Date.parse(value.resets_at);
    buckets.get(name).windows.push({ key, minutes, label, remaining: 100 - value.utilization, resetsAt: Number.isFinite(reset) ? Math.floor(reset / 1000) : null });
  }
  return [...buckets.values()];
}
export async function getClaudeSnapshot({ detect = detectClaude, load = readClaudeAuth, request = requestClaudeUsage } = {}) {
  const messages = {
    NOT_RUNNING: 'Claude Code not running', PROCESS_CHECK_FAILED: 'Could not check the Claude Code session.',
    AUTH_NOT_FOUND: 'No saved Claude Code OAuth credentials found.', AUTH_INVALID: 'The Claude Code credential format is not supported.',
    AUTH_EXPIRED: 'OAuth has expired. Waiting for Claude Code to refresh its credentials.', AUTH_REJECTED: 'Claude rejected the saved credentials. Refresh after the CLI updates them.',
    ACCESS_DENIED: 'The current OAuth credentials cannot read Claude quota.', RATE_LIMITED: 'Claude quota requests are rate limited.',
    AUTH_ACCESS_DENIED: 'Access to Claude Code credentials was denied.', API_TIMEOUT: 'The Claude quota request timed out.',
    NETWORK_ERROR: 'Could not connect to the Claude API.', QUOTA_UNAVAILABLE: 'The API returned no usable Claude quota.',
    API_ERROR: 'Could not read quota from the Claude API.', INVALID_RESPONSE: 'The Claude quota response was invalid.',
  };
  let original;
  try { original = await detect(); } catch { return { ok: false, code: 'PROCESS_CHECK_FAILED', error: messages.PROCESS_CHECK_FAILED }; }
  if (!original.length) return { ok: false, code: 'NOT_RUNNING', error: messages.NOT_RUNNING };
  try {
    const auth = await load();
    const buckets = normalizeClaude(await request(auth.accessToken));
    if (!buckets.length) throw fail('QUOTA_UNAVAILABLE');
    let alive;
    try { alive = await detect(); } catch { throw fail('PROCESS_CHECK_FAILED'); }
    if (!alive.some(process => original.some(previous => previous.id === process.id))) throw fail('NOT_RUNNING');
    return { ok: true, updatedAt: new Date().toISOString(), connection: 'existing-cli-oauth', source: 'claude-oauth', buckets,
      notice: 'Source: existing Claude Code OAuth · quota for the saved account.' };
  } catch (error) {
    const code = ['EACCES', 'EPERM'].includes(error.code) ? 'AUTH_ACCESS_DENIED' : error.code === 'ENOENT' ? 'AUTH_NOT_FOUND' : messages[error.code] ? error.code : 'API_ERROR';
    return { ok: false, code, error: messages[code] };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await getClaudeSnapshot();
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

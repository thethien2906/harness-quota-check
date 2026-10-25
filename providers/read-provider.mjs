import { getQuotaSnapshot } from './runtime.mjs';
import { readQuota } from './quota.mjs';
import { getAntigravitySnapshot } from './antigravity.mjs';
import { getClaudeSnapshot } from './claude.mjs';

try {
  const provider = process.argv[2];
  const handlers = { codex: () => getQuotaSnapshot({ query: readQuota }), antigravity: getAntigravitySnapshot, claude: getClaudeSnapshot };
  const handler = handlers[provider];
  if (!handler || !Object.hasOwn(handlers, provider)) throw new Error();
  console.log(JSON.stringify(await handler()));
} catch {
  // Never emit an exception, stderr, token, or unfiltered upstream payload.
  console.log(JSON.stringify({ ok: false, code: 'ADAPTER_ERROR', error: 'Could not read quota. Try again.' }));
}

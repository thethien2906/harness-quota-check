import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Coordinator, PROVIDERS } from './coordinator.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
const shell = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const coordinator = new Coordinator({
  query: async provider => {
    const { stdout } = await exec(process.execPath, [join(root, 'read-provider.mjs'), provider], { windowsHide: true, timeout: 40000, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(stdout);
  },
  publish: state => process.stdout.write(JSON.stringify(state) + '\n'),
});
let alive = true;
let scanning = false;
async function scan() {
  if (scanning || !alive) return;
  scanning = true;
  try {
    const { stdout } = await exec(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'discover-running.ps1')], { windowsHide: true, timeout: 8000, maxBuffer: 128 * 1024 });
    coordinator.observe(JSON.parse(stdout));
  } catch { coordinator.observe({}); }
  finally { scanning = false; }
}
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.type === 'refresh' && PROVIDERS.includes(message.provider)) {
      void (async () => { await scan(); await coordinator.refresh(message.provider); })();
    }
  } catch { /* Only known IPC commands are accepted. */ }
});
input.on('close', () => { alive = false; clearInterval(timer); process.exit(0); });
const timer = setInterval(scan, 2000);
await scan();

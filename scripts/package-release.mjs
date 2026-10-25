import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const folder = join(root, 'release/Quota Peek');
const zip = join(root, 'release/QuotaPeek_0.1.0_windows_x64_portable.zip');
const installer = join(root, 'src-tauri/target/release/bundle/nsis/Quota Peek_0.1.0_x64-setup.exe');
if (!existsSync(join(folder, 'quota-peek.exe')) || !existsSync(installer)) throw new Error('Build the portable app and installer first.');
await mkdir(join(root, 'release'), { recursive: true });
const quote = value => `'${value.replace(/'/g, "''")}'`;
await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
  '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath ${quote(folder)} -DestinationPath ${quote(zip)} -Force`,
], { windowsHide: true, timeout: 120000 });
const checksums = [];
for (const file of [installer, zip]) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  checksums.push(`${hash.digest('hex')}  ${basename(file)}`);
}
await writeFile(join(root, 'release/SHA256SUMS.txt'), checksums.join('\n') + '\n');
console.log('Release assets ready: installer, portable ZIP and SHA256SUMS.txt.');

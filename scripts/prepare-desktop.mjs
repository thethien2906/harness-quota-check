import { cp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, 'src-tauri/resources/runtime'), { recursive: true });
await copyFile(process.execPath, join(root, 'src-tauri/resources/runtime/node.exe'));
try {
  await copyFile(join(dirname(process.execPath), 'LICENSE'), join(root, 'src-tauri/resources/runtime/LICENSE'));
} catch {
  const licensePath = join(root, 'src-tauri/resources/runtime/LICENSE');
  try { await readFile(licensePath); } catch {
    const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
    if (!response.ok) throw new Error('Node runtime license could not be retrieved');
    await writeFile(licensePath, await response.text());
  }
}
await cp(join(root, 'providers'), join(root, 'src-tauri/resources/providers'), {
  recursive: true, filter: source => !source.endsWith('.test.mjs'),
});
console.log('Desktop runtime and provider resources prepared.');

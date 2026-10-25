import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function removeOwnedBridge(settings, nodePath = process.execPath, root = dirname(fileURLToPath(import.meta.url))) {
  const script = join(root, 'antigravity-statusline.mjs');
  const commands = [`call "${nodePath}" "${script}"`, `"${nodePath}" "${script}"`];
  if (!commands.includes(settings?.statusLine?.command)) return settings;
  const { statusLine, ...rest } = settings;
  return rest;
}

// Undo only Quota Peek's own previous integration. Never remove a user command.
export async function cleanupBridge() {
  if (!process.env.USERPROFILE) return;
  const file = join(process.env.USERPROFILE, '.gemini', 'antigravity-cli', 'settings.json');
  try {
    const text = await readFile(file, 'utf8');
    const settings = JSON.parse(text.replace(/^\uFEFF/, ''));
    const updated = removeOwnedBridge(settings);
    if (updated === settings || await readFile(file, 'utf8') !== text) return;
    const temporary = file + `.quota-peek-cleanup-${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(updated, null, 2) + '\n', 'utf8');
    await rename(temporary, file);
  } catch { /* Cleanup must not prevent the panel opening. */ }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await cleanupBridge();

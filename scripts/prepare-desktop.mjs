import { cp, mkdir, copyFile, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const resources = join(root, 'src-tauri/resources');
await mkdir(join(resources, 'runtime'), { recursive: true });
await copyFile(process.execPath, join(resources, 'runtime/node.exe'));
try {
  await copyFile(join(dirname(process.execPath), 'LICENSE'), join(resources, 'runtime/LICENSE'));
} catch {
  const licensePath = join(resources, 'runtime/LICENSE');
  try { await readFile(licensePath); } catch {
    const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
    if (!response.ok) throw new Error('Node runtime license could not be retrieved');
    await writeFile(licensePath, await response.text());
  }
}
// Ship only the product adapters. Test fixtures and the development credential
// file (*.local.json) are never copied verbatim into packaged resources.
await cp(join(root, 'providers'), join(resources, 'providers'), {
  recursive: true,
  filter: source => !source.endsWith('.test.mjs') && !source.endsWith('.local.json'),
});
const providers = join(resources, 'providers');
const bundled = join(providers, 'antigravity-oauth.json');
// The Antigravity OAuth client is the public installed-app identifier used by
// jcode and Antigravity: not a secret of our own and not tied to a Google Cloud
// project. Env wins, then the untracked development file. It is written under a
// clear build name so no stray *.local.json ever ships.
async function readCredential(name) {
  try {
    const saved = JSON.parse((await readFile(join(root, 'providers', name), 'utf8')).replace(/^\uFEFF/, ''));
    if (saved?.clientId && saved?.clientSecret) return { clientId: saved.clientId, clientSecret: saved.clientSecret };
  } catch { }
  return null;
}
const id = process.env.QUOTA_PEEK_ANTIGRAVITY_CLIENT_ID;
const secret = process.env.QUOTA_PEEK_ANTIGRAVITY_CLIENT_SECRET;
const credential = (id && secret) ? { clientId: id, clientSecret: secret }
  : await readCredential('antigravity-oauth.local.json') ?? await readCredential('antigravity-oauth.json');
if (credential) await writeFile(bundled, JSON.stringify(credential) + '\n');
else try { await unlink(bundled); } catch { }
try { await unlink(join(providers, 'antigravity-oauth.local.json')); } catch { }
console.log(credential
  ? 'Desktop runtime, provider resources and bundled Antigravity credential prepared.'
  : 'Desktop runtime and provider resources prepared. No Antigravity client credential in this build.');

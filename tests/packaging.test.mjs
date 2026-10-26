import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('packaging copies adapters but never test fixtures or untracked local secrets', async () => {
  const script = await readFile(join(root, 'scripts/prepare-desktop.mjs'), 'utf8');
  assert.match(script, /endsWith\('\.test\.mjs'\)/);
  assert.match(script, /endsWith\('\.local\.json'\)/);
  // The released credential is baked from the build environment and named
  // antigravity-oauth.json; only the untracked dev file uses .local.json.
  assert.match(script, /antigravity-oauth\.json/);
  assert.match(script, /QUOTA_PEEK_ANTIGRAVITY_CLIENT_ID/);
});

test('release publishing refuses tracked or packaged local secrets and a cross-repo default', async () => {
  const script = await readFile(join(root, 'scripts/publish-release.mjs'), 'utf8');
  assert.ok(script.includes('antigravity-oauth.local.json'));
  assert.match(script, /QUOTA_PEEK_RELEASE_REPO/);
});

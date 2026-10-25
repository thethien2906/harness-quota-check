import './prepare-desktop.mjs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryBridge } from './cargo-registry.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2];
if (!['dev', 'build', 'bundle'].includes(mode)) throw new Error('Use dev, build or bundle');
const bridge = await registryBridge();
await mkdir(join(root, '.cache/cargo'), { recursive: true });
await writeFile(join(root, '.cache/cargo/config.toml'), `[source.crates-io]\nreplace-with = "node-https"\n[source.node-https]\nregistry = "${bridge.url}"\n`);
const devConfig = mode === 'dev' ? ['--config', join(root, 'src-tauri/tauri.dev.conf.json')] : [];
const child = spawn(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), mode, ...devConfig, ...process.argv.slice(3)], {
  cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_HOME: join(root, '.cache/cargo'), npm_config_cache: join(root, '.cache/npm') },
});
child.on('error', () => { bridge.close(); process.exit(1); });
child.on('exit', code => { bridge.close(); process.exit(code || 0); });

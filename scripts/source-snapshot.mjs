import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, '.cache/source-audit', String(Date.now()));
await mkdir(target, { recursive: true });
const entries = ['package.json','package-lock.json','.npmrc','.gitignore','index.html','tsconfig.json','vite.config.ts','playwright.config.ts','README.md','src','providers','public','scripts','tests','docs','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/build.rs','src-tauri/tauri.conf.json','src-tauri/tauri.dev.conf.json','src-tauri/capabilities','src-tauri/src','src-tauri/icons'];
for (const entry of entries) await cp(join(root, entry), join(target, entry), { recursive: true });
// No RnD, dependencies, build output, cached resources or runtime are copied.
await writeFile(join(root, '.cache/source-audit/latest.json'), JSON.stringify({ target }, null, 2));
console.log(target);

// Run from the developer's own terminal: npm run release:publish
// Credentials stay in process memory or GitHub CLI's own credential store.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = 'thethien2906/harness-quota-check';
const origin = `https://github.com/${repository}.git`;
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (version !== '0.1.0') throw new Error('Review the release script before publishing another version.');
const assets = [
  join(root, 'src-tauri/target/release/bundle/nsis/Quota Peek_0.1.0_x64-setup.exe'),
  join(root, 'release/QuotaPeek_0.1.0_windows_x64_portable.zip'),
  join(root, 'release/SHA256SUMS.txt'),
];
for (const asset of assets) if (!existsSync(asset)) throw new Error(`Release asset missing: ${asset}`);
if (process.argv.includes('--dry-run')) {
  console.log(`Repository: ${origin}\nBranch: main\nTag: ${version}\nAssets:\n${assets.join('\n')}\nNo authentication, Git writes or remote changes performed.`);
  process.exit(0);
}

let environment = { ...process.env };
function run(executable, args, { capture = false, input, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env: environment, windowsHide: true,
      stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', quiet ? 'ignore' : 'inherit'] });
    let output = '';
    if (capture) child.stdout.on('data', chunk => { output += chunk.toString(); });
    if (input !== undefined) child.stdin.end(input);
    child.on('error', () => reject(new Error(`Could not run ${executable}.`)));
    child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(`${executable} exited with code ${code}.`)));
  });
}
const bundledCli = join(root, '.cache/gh/bin/gh.exe');
let gh = existsSync(bundledCli) ? bundledCli : 'gh';
try { await run(gh, ['--version'], { capture: true, quiet: true }); }
catch { throw new Error('Install GitHub CLI (gh) and retry.'); }
try { await run(gh, ['api', 'user', '--jq', '.login'], { capture: true, quiet: true }); }
catch {
  try {
    const filled = await run('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n', capture: true, quiet: true,
    });
    const token = filled.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
    if (!token) throw new Error('No saved GitHub credential.');
    environment = { ...environment, GH_TOKEN: token };
    await run(gh, ['api', 'user', '--jq', '.login'], { capture: true, quiet: true });
  } catch {
    // The user is at their own terminal for any interactive authorization.
    delete environment.GH_TOKEN;
    delete environment.GITHUB_TOKEN;
    await run(gh, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
  }
}

const permission = await run(gh, ['api', `repos/${repository}`, '--jq', '.permissions.push'], { capture: true });
if (permission !== 'true') throw new Error('The current GitHub account cannot push to the requested repository.');
if (!existsSync(join(root, '.git'))) await run('git', ['init', '-b', 'main']);
let currentOrigin = '';
try { currentOrigin = await run('git', ['remote', 'get-url', 'origin'], { capture: true, quiet: true }); } catch { }
if (currentOrigin && ![origin, origin.slice(0, -4), `git@github.com:${repository}.git`].includes(currentOrigin)) throw new Error('origin points to another repository. No remote was changed.');
if (!currentOrigin) await run('git', ['remote', 'add', 'origin', origin]);
const branch = await run('git', ['branch', '--show-current'], { capture: true });
if (branch !== 'main') throw new Error('Switch to main before publishing.');

// Use gh's authentication without copying credentials into Git config/files.
const quotedGh = `'${gh.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
const gitAuth = ['-c', 'credential.helper=', '-c', `credential.helper=!${quotedGh} auth git-credential`];
await run('git', ['add', '.']);
const tracked = (await run('git', ['ls-files', '-z'], { capture: true })).split('\0');
if (tracked.some(path => /^(RnD|\.cache|node_modules|dist|release)\//i.test(path) || /^src-tauri\/(target|resources)\//.test(path))) throw new Error('An ignored archive, dependency or build output is tracked. Untrack it before publishing.');
const staged = await run('git', ['diff', '--cached', '--name-only'], { capture: true });
if (staged) await run('git', ['commit', '-m', 'feat: release Quota Peek 0.1.0']);
const commit = await run('git', ['rev-parse', 'HEAD'], { capture: true });
await run('git', [...gitAuth, 'push', '-u', 'origin', 'main']);
let tagCommit = '';
try { tagCommit = await run('git', ['rev-parse', `${version}^{commit}`], { capture: true, quiet: true }); } catch { }
if (tagCommit && tagCommit !== commit) throw new Error('Tag 0.1.0 points to another commit. It was not moved.');
if (!tagCommit) await run('git', ['tag', '-a', version, '-m', 'Quota Peek 0.1.0']);
await run('git', [...gitAuth, 'push', 'origin', `refs/tags/${version}`]);

mkdirSync(join(root, '.cache'), { recursive: true });
const notes = join(root, '.cache/release-notes-0.1.0.md');
writeFileSync(notes, `Quota Peek 0.1.0 for Windows x64.\n\n- Monitor Codex, Antigravity and Claude Code using existing local credentials.\n- Compact icon rail with hover quota gauges and an anchored detail view.\n- Smooth edge reveal, English interface and the minimal Needle icon.\n\nDownloads:\n- Setup executable: install Quota Peek.\n- Portable ZIP: extract the complete folder and run quota-peek.exe.\n- SHA256SUMS.txt: verify downloaded files.\n\nOnly running tools are checked. Available quota windows depend on the provider and account.\n`);
let existingRelease;
try { existingRelease = JSON.parse(await run(gh, ['release', 'view', version, '--repo', repository, '--json', 'isDraft,url'], { capture: true, quiet: true })); } catch { }
if (existingRelease && !existingRelease.isDraft) throw new Error('The release is already published. It was not overwritten.');
if (!existingRelease) await run(gh, ['release', 'create', version, '--repo', repository, '--verify-tag', '--draft', '--title', 'Quota Peek 0.1.0', '--notes-file', notes]);
await run(gh, ['release', 'upload', version, ...assets, '--repo', repository, '--clobber']);
await run(gh, ['release', 'edit', version, '--repo', repository, '--draft=false', '--latest']);
console.log(`Published commit ${commit}\nhttps://github.com/${repository}/releases/tag/${version}`);

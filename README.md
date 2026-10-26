# Quota Peek

A tiny always-on-top panel at the edge of your screen that shows the remaining quota for your coding tools — **Codex**, **Antigravity**, and **Claude Code** — without running a check command in each one.

Windows x64 · Tauri 2 + React + TypeScript · uses your existing local credentials, no sign-in.

## Install

Download the latest release: <https://github.com/thethien2906/harness-quota-check/releases/latest>

| Option | File | Notes |
|---|---|---|
| Installer | `Quota Peek_0.2.0_x64-setup.exe` | Per-user install, no admin needed. Installs WebView2 if the machine lacks it. |
| Portable | `QuotaPeek_0.2.0_windows_x64_portable.zip` | Extract the whole folder and run `quota-peek.exe`; keep `resources/` next to it. |

Verify downloads against `SHA256SUMS.txt`.

Requires Windows x64. The app is unsigned, so SmartScreen may warn — choose **More info → Run anyway**.

## Features

- Edge-docked panel that reveals on hover; pin it to keep it open.
- **Compact** rail: three tool icons, each with a gauge showing remaining quota on hover.
- **Detail** view: quota windows, reset times, model detail, and data freshness.
- Only checks tools that are currently running, and clears stale data when a tool closes.
- Reads each tool's existing local credentials — no Quota Peek account, no server, no telemetry.

## What it shows

| Tool | Gauge source |
|---|---|
| Codex | 5-hour window |
| Antigravity | Highest numeric model release the source returns (e.g. Argon 4) — never the highest percentage |
| Claude Code | 5-hour window |

Nothing is invented: missing or invalid data shows an empty gauge, not 0% or 100%, and it never falls back from the 5-hour window to the weekly one.

## Usage

1. Start the tool you want to monitor (Codex, Antigravity, or Claude Code) and make sure it is logged in.
2. Run Quota Peek. It starts hidden at the right edge of your main screen.
3. Hover the edge strip to open the compact rail, then click an icon for details.
4. Use the tray icon to open, hide, or quit.

Preview the UI in a browser with sample data:

```powershell
npm.cmd run dev:web
# open http://127.0.0.1:1420/?preview=1
```

## Development

Prerequisites: Node.js 24+; Rust stable and Visual Studio C++ Build Tools on Windows. Packaged users do not need Node — a runtime is bundled.

```powershell
npm.cmd install
npm.cmd run dev               # Vite + Tauri with HMR
npm.cmd run desktop:build     # release exe + portable folder
npm.cmd run desktop:installer # NSIS installer
npm.cmd test                  # adapter / coordinator / logic tests
npm.cmd run test:ui           # Playwright UI tests
npm.cmd run build             # type-check + frontend build
```

### Releasing

```powershell
npm.cmd run desktop:build
npm.cmd run desktop:installer
npm.cmd run package:release   # ZIP + SHA256SUMS.txt
npm.cmd run release:publish   # commit, push, tag, publish GitHub release
```

The version comes from `package.json`. The publish script uses your existing GitHub CLI or git credentials, never force-pushes, and refuses to publish tracked build output or local secrets.

## Architecture

```text
src/          React UI, data contract, compact-quota selection
providers/    product adapters + worker/coordinator (Node)
src-tauri/    Rust desktop host: tray, window, edge watcher, IPC
scripts/      build, packaging and release tooling
docs/         architecture, provider behavior, design system
```

The Rust host spawns a bundled Node worker that polls the running tools and emits sanitized snapshots to the React UI over Tauri IPC. Credentials are read only in the backend, and only for a tool that is running.

- [Architecture](docs/ARCHITECTURE.md)
- [Provider behavior and limits](docs/PROVIDER_BEHAVIOR.md)
- [Design system](docs/DESIGN_SYSTEM.md)

## Notes

- Windows only for now — no WSL, no remote sessions, no multi-account selection.
- No auto-start and no auto-update yet.
- The bundled Antigravity OAuth client id/secret are the **public** installed-app identifiers used by jcode and Antigravity; no Google Cloud project is involved.
- `RnD/` is a local, gitignored research archive — the app, tests, icons, and build do not need it.

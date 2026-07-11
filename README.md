# openkhodam

OpenKhodam is a work-in-progress Electron desktop agent workspace for knowledge workers, built on top of OpenCode. It runs OpenCode as a managed sidecar and uses the OpenCode SDK to provide project-scoped sessions, a custom UI, and app-specific tools.

## Current Capabilities

- Open and remember local project folders.
- Create and resume project-scoped OpenCode sessions.
- Select the OpenCode model, agent, and reasoning effort used for a conversation.
- Stream messages and tool activity through the desktop chat UI.
- Connect Google Workspace to search Drive and read or edit Google Docs and Sheets.
- Track linked Google artifacts and managed snapshots by project and session.

## Workspace Layout

- `packages/desktop` contains the Electron main, preload, renderer, OpenCode sidecar lifecycle, bundled plugins, app integrations, and packaging config.
- `packages/ui` contains shared React views, UI-facing types, formatters, and styles that other frontends can reuse.
- `packages/e2e` contains Playwright coverage for desktop application flows.
- [`docs/configuration.md`](docs/configuration.md) documents persistence ownership, secrets, and project-local artifacts.

## Project Setup

This repository includes a Nix flake with the expected Node.js and pnpm versions. The examples below run commands through the development shell so they work without a separate local pnpm install.

### Install

```bash
nix develop -c pnpm install
```

### Development

```bash
nix develop -c pnpm dev
```

On Linux, Electron may fail outside a fully configured desktop session with errors about the SUID sandbox helper or a missing `$DISPLAY`. For local desktop development, run from a graphical session. For headless observation, the Nix shell includes `xvfb-run`; run Electron under Xvfb and disable the sandbox for that development process:

```bash
nix develop -c xvfb-run -a env ELECTRON_DISABLE_SANDBOX=1 pnpm --filter @openkhodam/desktop exec electron-vite dev --remoteDebuggingPort 9222 --noSandbox -- --disable-gpu
```

When the app starts successfully, the renderer is served from `http://localhost:5173/` and the Electron window opens the project/chat workspace. OpenCode server status and restart controls are available in Settings.

To target a single workspace directly, use pnpm filters:

```bash
nix develop -c pnpm --filter @openkhodam/desktop dev
nix develop -c pnpm --filter @openkhodam/ui typecheck
```

### Validation

Run the same quality checks used by CI:

```bash
nix develop -c pnpm typecheck
nix develop -c pnpm lint
nix develop -c pnpm format:check
nix develop -c pnpm test:e2e
```

Electron e2e tests require a graphical session. On headless Linux, run them under Xvfb with the same environment as CI:

```bash
nix develop -c xvfb-run -a env CI=1 ELECTRON_DISABLE_SANDBOX=1 pnpm test:e2e
```

### Build

```bash
# For Windows
nix develop -c pnpm build:win

# For macOS
nix develop -c pnpm build:mac

# For Linux
nix develop -c pnpm build:linux
```

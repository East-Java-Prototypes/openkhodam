# openkhodam

OpenKhodam is a work-in-progress agent harness for knowledge workers, built on top of OpenCode.

## Plan

- Run OpenCode as a sidecar server, similar to OpenCode Desktop, and communicate with it through the SDK.
- Provide a custom UI and project-specific tool calls.

## Workspace Layout

- `packages/desktop` contains the Electron main, preload, renderer entrypoint, and packaging config.
- `packages/ui` contains shared React views, UI-facing types, and styles that other frontends can reuse.

## Project Setup

This repository includes a Nix flake with the expected Node.js and pnpm versions. The examples below run commands through the development shell so they work without a separate local pnpm install.

### Install

```bash
$ nix develop -c pnpm install
```

### Development

```bash
$ nix develop -c pnpm dev
```

On Linux, Electron may fail outside a fully configured desktop session with errors about the SUID sandbox helper or a missing `$DISPLAY`. For local desktop development, run from a graphical session. For headless observation, the Nix shell includes `xvfb-run`; run Electron under Xvfb and disable the sandbox for that development process:

```bash
$ nix develop -c xvfb-run -a env ELECTRON_DISABLE_SANDBOX=1 pnpm --filter @openkhodam/desktop exec electron-vite dev --remoteDebuggingPort 9222 --noSandbox -- --disable-gpu
```

When the app starts successfully, the renderer is served from `http://localhost:5173/` and the Electron window should show the OpenCode server status.

To target a single workspace directly, use pnpm filters:

```bash
$ nix develop -c pnpm --filter @openkhodam/desktop dev
$ nix develop -c pnpm --filter @openkhodam/ui typecheck
```

### Build

```bash
# For windows
$ nix develop -c pnpm build:win

# For macOS
$ nix develop -c pnpm build:mac

# For Linux
$ nix develop -c pnpm build:linux
```

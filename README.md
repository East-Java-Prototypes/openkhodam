# openkhodam

An Electron application with React and TypeScript

## Workspace Layout

- `packages/desktop` contains the Electron main, preload, renderer entrypoint, and packaging config.
- `packages/ui` contains shared React views, UI-facing types, and styles that other frontends can reuse.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

This repository includes a Nix flake that provides the expected Node.js and pnpm versions. If you do not already have pnpm installed locally, run commands through the development shell:

```bash
$ nix develop -c pnpm install
$ nix develop -c pnpm dev
```

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

On Linux, Electron may fail outside a fully configured desktop session with errors about the SUID sandbox helper or a missing `$DISPLAY`. For local desktop development, run from a graphical session. For headless observation, the Nix shell includes `xvfb-run`; run Electron under Xvfb and disable the sandbox for that dev process:

```bash
$ nix develop -c xvfb-run -a env ELECTRON_DISABLE_SANDBOX=1 pnpm --filter @openkhodam/desktop exec electron-vite dev --remoteDebuggingPort 9222 --noSandbox -- --disable-gpu
```

When the app starts successfully, the renderer is served from `http://localhost:5173/` and the Electron window should show the OpenCode server status.

To target a single workspace directly:

```bash
$ pnpm --filter @openkhodam/desktop dev
$ pnpm --filter @openkhodam/ui typecheck
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

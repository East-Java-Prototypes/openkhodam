# openkhodam

An Electron application with React and TypeScript

## Workspace Layout

- `packages/desktop` contains the Electron main, preload, renderer entrypoint, and packaging config.
- `packages/ui` contains shared React views, UI-facing types, and styles that other frontends can reuse.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

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

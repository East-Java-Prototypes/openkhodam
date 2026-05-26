# Agent Development Notes

- This repository uses `flake.nix` to provide the expected Node.js and pnpm tooling.
- Run project commands through the Nix development shell unless you are already inside `nix develop`.
- Examples:
  - `nix develop -c pnpm install`
  - `nix develop -c pnpm lint`
  - `nix develop -c pnpm typecheck`

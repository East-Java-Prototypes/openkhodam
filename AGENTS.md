# Agent Development Notes

- This repository uses `flake.nix` to provide the expected Node.js and pnpm tooling.
- Run project commands through the Nix development shell unless you are already inside `nix develop`.
- Examples:
  - `nix develop -c pnpm install`
  - `nix develop -c pnpm lint`
  - `nix develop -c pnpm typecheck`
- When changing feature or user-facing flows, add or update e2e coverage when it is feasible and proportionate.
- Desktop `components/ui/*` wrappers should compose through `@base-ui/react`/Base UI primitives; do not add `radix-ui` for new or updated desktop UI wrappers.
- If e2e coverage is not feasible for a change, explain why in your handoff/report and cover the behavior with the most appropriate lower-level tests instead.
- When e2e CI is relevant to the task, do not stop at starting the run; wait for it to complete and collect the pass/fail evidence.

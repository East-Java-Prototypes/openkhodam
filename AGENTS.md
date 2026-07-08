# Agent Development Notes

- Before finalizing implementation plans in this repo, load and apply the repo-local `openkhodam-scope` skill. Use it for repo-specific planning, scoping, feature work, refactors, and behavior matching; it complements the global `develop` skill and should not force reference lookups for unrelated trivial changes.
- For UI design, visual polish, chat presentation, component styling, geometry/radius, spacing, borders, typography, hover, or focus-state changes, also load the repo-local `openkhodam-design-integrity` skill; it complements `openkhodam-scope` by preserving the app's visual language.
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

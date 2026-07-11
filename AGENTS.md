# Agent Development Notes

## Skills

- Load the repo-local `openkhodam-scope` skill before substantial implementation or before finalizing plans for work that affects behavior, architecture, data flow, UI flow, integration boundaries, feature behavior, refactors, or behavior matching. Do not use it to slow down unrelated mechanical changes.
- For UI design, visual polish, chat presentation, component styling, geometry, spacing, borders, typography, hover, or focus-state changes, also load the repo-local `openkhodam-design-integrity` skill.

## Toolchain

- This repository uses `flake.nix` to provide the expected Node.js and pnpm tooling.
- Run project commands through `nix develop -c` unless the current shell is already inside `nix develop`.
- Use repository scripts instead of invoking underlying tools directly when a script exists.

## Validation

- Keep verification proportionate to the changed surface.
- For code changes, run the relevant targeted tests plus `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` through the Nix development shell.
- For documentation or configuration-only changes, run the relevant formatter or schema check and `git diff --check`.
- For feature or user-facing flow changes, add or update e2e coverage when feasible and proportionate.
- If e2e coverage is not feasible, explain why in the handoff and cover the behavior with the most appropriate lower-level tests.
- When e2e CI is relevant, wait for the run to complete and report pass/fail evidence.

## UI Boundaries

- Desktop `components/ui/*` wrappers must compose through `@base-ui/react`/Base UI primitives.
- Do not add `radix-ui` for new or updated desktop UI wrappers.

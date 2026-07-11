---
name: openkhodam-scope
description: Use before implementing or planning substantial openkhodam changes, including feature work, refactors, and behavior matching; guides local inspection and opencode/openwork reference use.
---

# Openkhodam Scope

Use this repo-local skill before substantial implementation or before finalizing an implementation plan for openkhodam work that may affect behavior, architecture, data flow, UI flow, or integration boundaries.

Do not use this skill to slow down purely mechanical or unrelated trivial changes such as typo fixes, comment-only edits, lockfile-only maintenance, or obvious one-line config updates unless behavior or architecture is uncertain.

## Scoping Workflow

1. Inspect the local openkhodam code first to understand current naming, boundaries, and call flow.
2. When the task overlaps with opencode behavior, SDK/app/desktop patterns, or core agent orchestration, consult the existing `opencode` reference before inventing a new pattern.
3. When the task overlaps with using opencode as an application core or host integration, consult the existing `openwork` reference before inventing a new pattern.
4. Reuse local conventions when they are clear; use the references to resolve uncertainty, match behavior, or avoid duplicating solved patterns.
5. Keep scoping lightweight: cite the specific local module or reference pattern that informed the decision instead of copying broad reference details.

## Call Flow Focus

When planning or reporting implementation behavior, describe the composition path:

`entry point -> orchestrator/container -> domain/service function -> boundary/side effect`

Prefer call traces and module names over long function-body summaries. Include implementation detail only when it is surprising, risky, or needed to justify a design choice.

## Scope Guardrails

- This skill complements, but does not replace, the global `develop` implementation workflow.
- Use the repo's existing `opencode` and `openwork` references; do not add new reference configuration for this skill.
- Avoid broad reference spelunking when the local code and task scope are already obvious.
- If reference behavior conflicts with local repo conventions or the approved task scope, call out the tradeoff before changing course.

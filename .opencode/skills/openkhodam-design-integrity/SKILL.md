---
name: openkhodam-design-integrity
description: Use when making OpenKhodam UI design, visual polish, chat presentation, component styling, geometry/radius, spacing, borders, typography, hover, or focus-state changes.
---

# OpenKhodam Design Integrity

Use this repo-local skill alongside `openkhodam-scope` whenever a change affects UI appearance, styling, or interaction polish. Its job is to preserve the app's existing visual language before introducing new design ideas.

## Skill Precedence

- Use the generic `shadcn` skill for component APIs, accessibility, composition, and registry or CLI workflows, not as the source of OpenKhodam's visual direction.
- Use nearby OpenKhodam UI and this skill for geometry, spacing, typography, color, borders, shadows, and interaction styling. When generic examples conflict with established local patterns, the local patterns win.
- Preserve the repository's Base UI boundary: desktop `components/ui/*` wrappers compose through `@base-ui/react`; Radix examples are not precedent for new or updated wrappers.

## Design Guardrails

- Start by inspecting nearby UI: compare sibling components, adjacent chat/tool surfaces, existing utility classes, and shared wrappers before adding or changing classes.
- Reuse established component and style conventions. Prefer extending the local pattern over inventing a new visual treatment.
- Preserve existing geometry by default. Do not add, increase, decrease, or normalize `rounded-*`, `border-radius`, or radius tokens unless the user explicitly requested a radius change or the exact nearby pattern already uses it.
- For chat, message, tool-call, and transcript surfaces, prefer square or structured geometry unless local code clearly proves that rounded cards are the established pattern.
- Keep spacing, borders, color, shadows, hover states, focus states, and typography aligned with the surrounding surface before optimizing for isolated beauty.
- Avoid broad polish sweeps. Make the smallest visual change that satisfies the request and explain any intentional deviation from local precedent.

## Review Checklist

Before handing off UI/style work, verify:

1. Nearby UI was inspected and the chosen pattern matches existing visual language.
2. No unrequested rounded-corner or radius drift was introduced.
3. New classes or tokens are justified by an existing local convention or an explicit user request.
4. Chat/tool surfaces still read as part of the same structured interface.
5. Focus and hover affordances remain visible, accessible, and consistent with adjacent controls.

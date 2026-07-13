# OpenKhodam context

## Sidecar architecture and artifact ownership (Phase 4)

Electron supervises OpenCode and OpenKhodam as sibling sidecars. Renderer prompting continues to go directly to OpenCode; renderer artifact reads use the authenticated OpenKhodam HTTP client.

Composition paths:

`Electron supervisor -> OpenKhodam worker -> @openkhodam/server listener -> Hono routes -> project artifact manager -> project-local files`

`renderer/plugin adapter -> @openkhodam/client -> authenticated HTTP boundary -> @openkhodam/server`

`@openkhodam/protocol` owns framework-neutral request/response types and runtime validators. `@openkhodam/client` owns authenticated, cancellable HTTP calls and normalized errors. `@openkhodam/server` owns Hono, persistence, and the only artifact writer. Desktop has no artifact persistence or artifact IPC surface.

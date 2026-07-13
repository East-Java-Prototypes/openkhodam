# OpenKhodam context

## Sidecar architecture (Phase 1)

OpenKhodam is moving toward an Electron host that supervises OpenCode and OpenKhodam as sibling sidecars. Renderer prompting continues to go directly to OpenCode. This phase only introduces reusable modules for OpenKhodam's future local API; it does not start a sidecar from Electron or migrate any desktop behavior.

Composition path for the new foundation:

`future Electron supervisor -> @openkhodam/server listener -> Hono app -> protocol responses`

`future renderer/plugin adapter -> @openkhodam/client -> HTTP boundary -> @openkhodam/server`

`@openkhodam/protocol` owns framework-neutral request/response types and runtime validators. `@openkhodam/client` owns authenticated, cancellable HTTP calls and normalized errors. `@openkhodam/server` is the Hono implementation adapter and is the only module that imports Hono or its Node adapter.

# ADR 0001: Prepare OpenKhodam for a sibling sidecar

## Status

Accepted — Phase 1 foundation.

## Decision

Electron will eventually supervise OpenCode and OpenKhodam as sibling sidecars. Phase 1 introduces three modules without changing Electron, renderer, plugin, artifact, or configuration behavior:

- `@openkhodam/protocol`: stable connection and endpoint contracts, error shape, and runtime validators.
- `@openkhodam/client`: small authenticated HTTP client with cancellation and typed normalized failures.
- `@openkhodam/server`: Hono application plus a loopback-only Node listener with lifecycle control.

Hono and `@hono/node-server` are confined to the server implementation. Protocol and client remain framework-independent so future renderer and plugin adapters can use the same client contract.

## Consequences

The local API currently exposes only authenticated health, version, and capabilities endpoints. Artifact operations, Electron supervision, migration work, and OpenCode proxying remain future phases.

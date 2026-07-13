# ADR 0001: OpenKhodam sibling sidecar and artifact ownership

## Status

Accepted — Phase 4 cutover.

## Decision

Electron supervises OpenCode and OpenKhodam as sibling sidecars. Artifact persistence is owned exclusively by the OpenKhodam server worker:

- `@openkhodam/protocol`: stable connection and endpoint contracts, error shape, and runtime validators.
- `@openkhodam/client`: small authenticated HTTP client with cancellation and typed normalized failures.
- `@openkhodam/server`: Hono application, loopback-only Node listener, artifact routes, and project-local artifact persistence.

Hono and `@hono/node-server` are confined to the server implementation. Protocol and client remain framework-independent so renderer and plugin adapters use the same client contract. Desktop retains only sidecar lifecycle and connection IPC; it has no artifact IPC or artifact filesystem implementation.

## Consequences

Artifact operations use authenticated routes. The server serializes mutations for each canonical project directory, preventing concurrent in-process route writers from losing updates. Cross-process writers are outside the current ownership model: only the one managed server worker may write artifacts.

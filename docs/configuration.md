# OpenKhodam configuration ownership

OpenKhodam owns project artifacts through its loopback HTTP server. Keep new stores explicit and app-owned; do not add a broad config framework unless there is a concrete caller for it.

## Current files

- `userData/openkhodam-config.json` is the app/user config. It is owned by `OpenKhodamConfigFileStore` and currently stores opened project folders plus the Google Workspace connection status, granted scopes, account metadata, and OAuth tokens.
- `userData/opencode-sidecar/runtime-opencode-config.json` is generated runtime config. It is written before the OpenCode sidecar starts and passed to OpenCode through `OPENCODE_CONFIG`. It should contain only the managed runtime payload OpenCode needs, such as bundled plugin paths.
- `<project>/.openkhodam/artifacts.json` is the project-local session artifact index. It is owned by the server `ProjectArtifactsFileStore` and currently stores `sessionId -> LinkedGoogleArtifact[]` records for Google Docs and Google Sheets. Renderer reads and plugin mutations use the authenticated server HTTP API; it is not user-authored setup.
- `<project>/.openkhodam/artifacts/{google-docs,google-sheets}/*.json` contains managed snapshots of Google Workspace content persisted by OpenKhodam tools. These files are project-local artifacts, not user-authored setup or configuration.

Project artifact files use `packages/server/src/json-config-file.ts`; desktop-only user config uses its desktop helper. The server helper centralizes JSON formatting, atomic writes, and temporary-file cleanup.

## Concurrency limitation

`ProjectArtifactsModule` serializes all reads and mutations per canonical project directory and `ProjectArtifactsFileStore` replaces `.openkhodam/artifacts.json` atomically. An interrupted write does not leave a partial file and managed callers cannot lose updates through concurrent in-process requests.

## Secrets and non-secrets

- Treat OAuth tokens, refresh tokens, and credentials as secrets. Keep them in local app-owned storage with restrictive file permissions, and never place them in project/workspace files or checked-in docs/fixtures.
- Generated runtime config should stay non-secret. Plugin paths and OpenCode loader metadata are acceptable; credentials and user content are not.
- Project artifact data is non-secret but may be sensitive: its index contains Google Workspace IDs, titles, URLs, and session/message IDs, while managed snapshots can contain full Google Doc text and Google Sheet cell values. These files may be committed if the project includes `.openkhodam`. Never persist OAuth tokens, refresh tokens, credentials, authorization headers, cookie headers, or API keys anywhere under `.openkhodam`.
- Future project/session config should avoid secrets by default. If a secret is required, use a secret-specific local store or OS-backed credential mechanism instead of extending project JSON.

## Adding or extending config

1. Decide ownership first: app/user config, generated runtime config, or project/session artifact data. Do not mix these responsibilities in one file.
2. Keep the path stable and documented. App/user config belongs under Electron `userData`; generated OpenCode runtime config belongs under `userData/opencode-sidecar`; the session artifact index belongs under the active project at `.openkhodam/artifacts.json`; managed artifact snapshots belong beneath `.openkhodam/artifacts/`. Project artifact callers must provide a non-empty absolute path to an existing directory, which OpenKhodam canonicalizes before resolving project artifact paths; OpenKhodam rejects symlinked project artifact directories and files.
3. Define a typed store API for callers and keep low-level file IO inside `JsonConfigFile`/`writeJsonConfigFile`.
4. Provide a default value for missing app-owned config files and a normalizer that accepts older or partial payloads.
5. Preserve atomic writes and restrictive modes for files that may contain user or auth data.
6. Add focused tests around path, payload shape, missing-file defaults, normalization, and mode-sensitive behavior when feasible.
7. Use the OpenKhodam server HTTP client: renderer credentials may only read artifact lists, while plugin credentials may perform semantic mutations and snapshots. Do not expose either role or token to unrelated callers. Keep Google Docs compatibility APIs limited to callers that still require them, and persist or delete managed content snapshots through server routes rather than writing paths directly.

Google Workspace tool integration, prompt context injection, preview panes, manual attach forms, and durable workspace/session aggregation are separate features and should not be added to these files without a new ownership decision.

# OpenKhodam configuration ownership

OpenKhodam owns a small number of JSON files in the Electron main process. Keep new config stores explicit and app-owned; do not add a broad config framework unless there is a concrete caller for it.

## Current files

- `userData/openkhodam-config.json` is the app/user config. It is owned by `OpenKhodamConfigFileStore` and currently stores the Google Workspace connection status, granted scopes, account metadata, and OAuth tokens.
- `userData/opencode-sidecar/runtime-opencode-config.json` is generated runtime config. It is written before the OpenCode sidecar starts and passed to OpenCode through `OPENCODE_CONFIG`. It should contain only the managed runtime payload OpenCode needs, such as bundled plugin paths.
- `<project>/.openkhodam/artifacts.json` is project-local session artifact memory. It is owned by `ProjectArtifactsFileStore` and currently stores `sessionId -> linkedDocs[]` records for Google Docs that OpenKhodam tools or UI explicitly record through the OpenKhodam IPC/integration APIs. It is not user-authored setup.

All JSON config files are written through `packages/desktop/src/main/config/json-config-file.ts`, which centralizes default-on-missing reads, normalization, JSON formatting, atomic writes, temporary-file cleanup, and file mode handling.

## Concurrency limitation

`ProjectArtifactsFileStore` replaces `.openkhodam/artifacts.json` atomically, so an interrupted write does not leave a partial file. It does not currently serialize read-modify-write mutations across store instances for the same canonical artifact-file path. For example, parallel Google Docs or Sheets tool calls can both read the same snapshot, then the later write can discard the other call's logical update.

Future work must serialize mutations per artifact-file path and add parallel mutation coverage. Until then, treat this as a possible lost-update condition, not file corruption.

## Secrets and non-secrets

- Treat OAuth tokens, refresh tokens, and credentials as secrets. Keep them in local app-owned storage with restrictive file permissions, and never place them in project/workspace files or checked-in docs/fixtures.
- Generated runtime config should stay non-secret. Plugin paths and OpenCode loader metadata are acceptable; credentials and user content are not.
- Project artifact memory is non-secret but may be sensitive: Google Doc IDs, titles, URLs, and session/message IDs can reveal private project context and may be committed if the project includes `.openkhodam`. Never persist OAuth tokens, refresh tokens, credentials, authorization headers, cookie headers, or API keys in `.openkhodam/artifacts.json`.
- Future project/session config should avoid secrets by default. If a secret is required, use a secret-specific local store or OS-backed credential mechanism instead of extending project JSON.

## Adding or extending config

1. Decide ownership first: app/user config, generated runtime config, or project/session artifact memory. Do not mix these responsibilities in one file.
2. Keep the path stable and documented. App/user config belongs under Electron `userData`; generated OpenCode runtime config belongs under `userData/opencode-sidecar`; session artifact memory belongs under the active project at `.openkhodam/artifacts.json`. Project artifact callers must provide a non-empty absolute path to an existing directory, which OpenKhodam canonicalizes before appending `.openkhodam/artifacts.json`; OpenKhodam rejects symlinked `.openkhodam` directories and symlinked `artifacts.json` files.
3. Define a typed store API for callers and keep low-level file IO inside `JsonConfigFile`/`writeJsonConfigFile`.
4. Provide a default value for missing app-owned config files and a normalizer that accepts older or partial payloads.
5. Preserve atomic writes and restrictive modes for files that may contain user or auth data.
6. Add focused tests around path, payload shape, missing-file defaults, normalization, and mode-sensitive behavior when feasible.
7. Mutate project artifact memory only through the OpenKhodam APIs (`listProjectArtifacts`, `listSessionLinkedDocs`, `recordLinkedGoogleDoc`, `delistLinkedGoogleDoc`, and `relistLinkedGoogleDoc`) so delist/relist intent and secret filtering stay centralized.

Google Docs tool integration, prompt context injection, preview panes, manual attach forms, and durable workspace/session aggregation are separate features and should not be added to these files without a new ownership decision.

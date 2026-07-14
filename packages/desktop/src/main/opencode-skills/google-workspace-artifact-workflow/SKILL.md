---
name: google-workspace-artifact-workflow
description: Use when reading or editing Google Docs through Google Workspace commands and continuing a truncated offline artifact preview.
---

# Google Docs artifact workflow

1. Hydrate or refresh a document with `google.docs.read`. Keep its opaque `artifactRef`.
2. When the preview is truncated, call `google.artifacts.read` with that `artifactRef`; do not inspect files directly.
3. Follow each returned `nextCursor` with the same `artifactRef` until no cursor remains.
4. After any Docs edit, discard old cursors and use the refreshed `artifactRef` from the edit result. Cursors belong to one cached snapshot.
5. If cached content is stale, missing, or invalid, manually rerun `google.docs.read` before reading the artifact again.

Current offline coverage is the first tab's paragraph text only. Rich formatting, lists, and tables are unsupported.

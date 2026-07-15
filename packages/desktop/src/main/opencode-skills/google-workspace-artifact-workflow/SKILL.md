---
name: google-workspace-artifact-workflow
description: Use when reading or editing Google Docs through Google Workspace commands and continuing a truncated offline artifact preview.
---

# Google Docs artifact workflow

1. Hydrate or refresh a document with `google.docs.read`. Check `artifactSync`: `synced` includes the opaque `artifactRef`; `unavailable` means no offline cache is available for this response.
2. A synced artifact can be persisted without session linking (`linked: false`); linkage is optional and does not change offline-read availability.
3. When the preview is truncated and `artifactSync.status` is `synced`, call `google.artifacts.read` with its `artifactRef`; do not inspect files directly.
4. Follow each returned `nextCursor` with the same `artifactRef` until no cursor remains.
5. After any Docs edit, discard old cursors and restart `google.artifacts.read` without a cursor using the refreshed `artifactRef`. Cursors belong to one cached snapshot.
6. If cached content is stale, missing, invalid, or sync is unavailable, manually rerun `google.docs.read` before reading the artifact again.

Current offline coverage includes the first tab's rich text, native lists, and simple rectangular table cells with coordinates. Merged or irregular tables and images are unsupported; their table paragraph text is retained with explicit unsupported-table markers rather than reconstructed as table cells.

---
name: Artifact workflow asset paths
description: Uploaded workspace assets may need a root-relative fallback when accessed from an artifact service.
---

Artifact service workflows can run with the artifact directory as the current working directory rather than the workspace root.

**Why:** A workbook-backed API seed initially failed because it looked for attached assets under the service directory.

**How to apply:** When server startup needs an uploaded workspace asset, resolve both the current directory and the workspace-root-relative path, and fail with a clear message if neither exists.
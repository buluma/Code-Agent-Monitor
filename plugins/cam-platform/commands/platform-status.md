---
description: CAM platform status across hooks, config, updates, and MCP prerequisites
---

Run `cam health`, `cam hooks status`, `cam config claude overview`,
`cam config codex overview`, and `cam update-check`. Note that
`cam update-check` runs `git fetch --prune`, so it updates local Git metadata
without changing working-tree files. Also check whether `mcp/build/index.js`
exists. Report exact provider hook state, configuration roots, dashboard
version, and MCP build readiness. Do not modify configuration or install hooks.

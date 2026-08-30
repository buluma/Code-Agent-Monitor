---
name: config-explorer
description: >
  Inspect and safely edit the Claude Code and Codex configuration surfaces
  exposed by CAM. Use when auditing skills, agents, commands, plugins,
  marketplaces, MCP servers, hooks, settings, memory, keybindings, profiles,
  rules, or instruction files, and when a backup-backed allowlisted edit is
  required.
---

# Config Explorer

## Claude Code

Read with:

```bash
cam config claude overview
cam config claude skills --scope user
cam config claude mcp
cam config claude hooks
cam config claude memory
```

Supported writes are limited to text artifacts and keybindings. Use a JSON file
and `--yes`. Every write or delete creates a timestamped backup.

## Codex

Read with:

```bash
cam config codex overview
cam config codex read /absolute/path
```

Use `edit` only for the server's unredacted editable allowlist. Supported writes
and deletes are backup-backed. Base `config.toml` is edit-only. Profiles are
created with `cam config codex profile <name> --yes`.

Never overwrite a redacted preview. Read the editable source before saving.
Never edit plugin or MCP state files outside the server's allowlist.

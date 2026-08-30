---
name: run-agent
description: >
  Launch and supervise Claude Code or Codex through the CAM Run API. Use when
  the user wants to start a monitored agent, select a model, approval policy,
  sandbox, or working directory, send a follow-up, inspect live output, resume
  a native session, or stop a dashboard-launched run.
---

# Run Agent

Use `cam run` against the local dashboard.

## Workflow

1. Verify the provider binary:
   - `cam run binary claude`
   - `cam run binary codex`
2. Discover supported models with `cam run models <provider>`.
3. Confirm the working directory with `cam run cwds`.
4. Show the exact launch settings before starting. Include provider, prompt,
   working directory, model, approval mode, sandbox, and resume session ID.
5. Start only after user confirmation:

```bash
cam run start --provider codex --cwd /path/to/repo \
  --prompt "Review the current changes" \
  --permission on-request --sandbox workspace-write --yes
```

6. Inspect with `cam run list` or `cam run get <id> --envelopes`.
7. Send follow-ups with `cam run send <id> --text "..." --provider codex --yes`.
8. Stop with `cam run stop <id> --yes`.

## Safety

- Never use `danger-full-access` unless the user explicitly requests it.
- Do not start, message, or stop a run without confirmation.
- Preserve the provider used to start the run when sending messages.
- Treat run history as evidence. Do not claim completion from process status
  alone when the final output or persisted session shows an error.

#!/usr/bin/env node
// Forwards a Codex lifecycle hook to each live dashboard without waiting for a
// response, so monitoring never delays the Codex CLI.
// @author Michael Buluma <1452922+buluma@users.noreply.github.com>

const { sendHook } = require("./hook-transport");

const hookType = process.argv[2] || "unknown";

function resolvePorts() {
  try {
    return require("../server/lib/server-info").resolveHookIngestPorts();
  } catch {
    const port = Number.parseInt(process.env.CLAUDE_DASHBOARD_PORT || "", 10);
    return [Number.isInteger(port) && port > 0 ? port : 4820];
  }
}

let input = "";
let sent = false;

function deliver(data) {
  if (sent) return;
  sent = true;
  sendHook(resolvePorts, "/api/hooks/codex", { hook_type: hookType, data }).finally(() =>
    setImmediate(() => process.exit(0))
  );
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  // Codex may leave stdin open after writing the payload, so deliver as soon as
  // the buffer parses instead of idling until EOF and the safety net below.
  try {
    deliver(JSON.parse(input));
  } catch {
    /* payload incomplete — keep reading */
  }
});
process.stdin.on("end", () => deliver({ raw: input }));
setTimeout(() => process.exit(0), 2500);

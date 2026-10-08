/**
 * @file Regression tests for scripts/codex-hook-handler.js stdin handling. Codex
 * may keep a hook's stdin open after writing the payload, so the handler must
 * deliver as soon as a complete JSON payload has arrived instead of waiting for
 * EOF — otherwise it idles until its own safety net fires and sits too close to
 * Codex's hook timeout.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const HANDLER = path.resolve(__dirname, "../../scripts/codex-hook-handler.js");

function startMockServer() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ url: req.url, body });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, received });
    });
  });
}

// Spawn the real handler and write the payload. With holdStdinOpen the pipe is
// never ended, emulating a caller that does not send EOF.
function runHandler({ port, payload, holdStdinOpen, chunks = 1 }) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const child = spawn(process.execPath, [HANDLER, "Stop"], {
      env: { ...process.env, CLAUDE_DASHBOARD_PORT: String(port) },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, ms: Number(process.hrtime.bigint() - start) / 1e6 });
    });
    const text = JSON.stringify(payload);
    const size = Math.ceil(text.length / chunks);
    for (let i = 0; i < text.length; i += size) {
      child.stdin.write(text.slice(i, i + size));
    }
    if (!holdStdinOpen) child.stdin.end();
  });
}

describe("codex-hook-handler stdin handling", () => {
  it("delivers and exits promptly when stdin is never closed", async () => {
    const { server, port, received } = await startMockServer();
    try {
      const { code, ms } = await runHandler({
        port,
        payload: { session_id: "cx-open", hook_event_name: "Stop" },
        holdStdinOpen: true,
      });

      assert.equal(code, 0, "handler should exit cleanly");
      assert.ok(ms < 1500, `handler waited for EOF (${Math.round(ms)}ms)`);
      assert.equal(received.length, 1, "event should be delivered exactly once");
      assert.equal(received[0].url, "/api/hooks/codex");
      const sent = JSON.parse(received[0].body);
      assert.equal(sent.hook_type, "Stop");
      assert.equal(sent.data.session_id, "cx-open");
    } finally {
      server.close();
    }
  });

  it("reassembles a payload split across chunks and delivers once", async () => {
    const { server, port, received } = await startMockServer();
    try {
      const { code } = await runHandler({
        port,
        payload: { session_id: "cx-chunked", note: "x".repeat(2000) },
        chunks: 4,
      });

      assert.equal(code, 0);
      assert.equal(received.length, 1, "must not deliver partial or duplicate events");
      assert.equal(JSON.parse(received[0].body).data.session_id, "cx-chunked");
    } finally {
      server.close();
    }
  });

  it("still delivers when stdin closes normally", async () => {
    const { server, port, received } = await startMockServer();
    try {
      const { code } = await runHandler({ port, payload: { session_id: "cx-eof" } });

      assert.equal(code, 0);
      assert.equal(received.length, 1);
      assert.equal(JSON.parse(received[0].body).data.session_id, "cx-eof");
    } finally {
      server.close();
    }
  });
});

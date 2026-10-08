/**
 * @file Verifies on-demand tray snapshots coalesce requests and retain successful data on failure.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */
import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import vm from "node:vm";
import { createRequire } from "node:module";

it("shares snapshot requests and keeps the cache on server failures", async () => {
  const filename = new URL("../out/server-host.js", import.meta.url);
  const realRequire = createRequire(filename);
  const exports = {};
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      exports,
      require(name) {
        if (name === "electron") return { app: {} };
        if (name === "./logger") return { log: {} };
        return realRequire(name);
      },
      process,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      __dirname: new URL("../out", import.meta.url).pathname,
    },
    { filename: filename.pathname }
  );
  let requests = 0;
  let fail = false;
  const server = http.createServer((_req, res) => {
    requests++;
    setTimeout(() => {
      res.statusCode = fail ? 503 : 200;
      res.end(
        JSON.stringify({ active_sessions: 2, agents_by_status: { working: 3 }, events_today: 7 })
      );
    }, 20);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    await Promise.all([exports.refreshServerSnapshot(port), exports.refreshServerSnapshot(port)]);
    assert.equal(requests, 1);
    assert.equal(exports.getServerSnapshot().eventsToday, 7);
    fail = true;
    await exports.refreshServerSnapshot(port);
    assert.equal(exports.getServerSnapshot().activeSessions, 2);
    await exports.refreshServerSnapshot(null);
    assert.equal(exports.getServerSnapshot(), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/**
 * @file Verifies the Helm Code Config Explorer HTTP surface end-to-end. The
 * route is read-only against Helm Code's state database and exposes a single
 * non-destructive mutation (`POST /resync`) that re-runs the idempotent
 * `ingestHelmcodeSnapshot` pass. These tests build a synthetic `state.sqlite`
 * fixture and exercise both endpoints, including the missing-home and
 * unconfirmed-resync error paths.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { after, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const express = require("express");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-helmcode-config-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.DASHBOARD_HELMCODE_HOME = path.join(TMP, "helmcode");
delete process.env.DASHBOARD_LEGACY_DB_PATH;
delete process.env.DASHBOARD_LITE_DB_PATH;

const { db, stmts } = require("../db");
const router = require("../routes/helmcode-config");

function statePath() {
  return path.join(process.env.DASHBOARD_HELMCODE_HOME, "userdata", "state.sqlite");
}

function buildStateFixture() {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  const handle = new Database(statePath());
  handle.exec(`
    CREATE TABLE IF NOT EXISTS projection_projects (
      project_id TEXT PRIMARY KEY,
      workspace_root TEXT,
      default_model_selection_json TEXT,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT,
      created_at TEXT,
      updated_at TEXT,
      archived_at TEXT,
      deleted_at TEXT,
      model_selection_json TEXT,
      interaction_mode TEXT,
      runtime_mode TEXT,
      pending_approval_count INTEGER DEFAULT 0,
      pinned_at TEXT,
      snoozed_until TEXT
    );
    CREATE TABLE IF NOT EXISTS projection_thread_sessions (
      thread_id TEXT PRIMARY KEY,
      status TEXT,
      provider_name TEXT,
      provider_session_id TEXT,
      active_turn_id TEXT,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT,
      turn_id TEXT,
      role TEXT,
      text TEXT,
      is_streaming INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS projection_thread_activities (
      activity_id TEXT PRIMARY KEY,
      thread_id TEXT,
      turn_id TEXT,
      tone TEXT,
      kind TEXT,
      summary TEXT,
      payload_json TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS projection_turns (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT,
      turn_id TEXT,
      state TEXT,
      requested_at TEXT,
      started_at TEXT,
      completed_at TEXT
    );
  `);
  handle
    .prepare(
      "INSERT INTO projection_projects (project_id, workspace_root, deleted_at) VALUES (?, ?, NULL)"
    )
    .run("proj-1", "/tmp/work");
  handle
    .prepare(
      `INSERT INTO projection_threads (thread_id, project_id, title, created_at, updated_at, archived_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL)`
    )
    .run(
      "thr-1",
      "proj-1",
      "Sample thread",
      "2026-08-28T00:00:00.000Z",
      "2026-08-28T00:00:00.000Z"
    );
  handle
    .prepare(
      `INSERT INTO projection_threads (thread_id, project_id, title, created_at, updated_at, archived_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL)`
    )
    .run("thr-2", "proj-1", "Second", "2026-08-28T00:01:00.000Z", "2026-08-28T00:01:00.000Z");
  handle
    .prepare(
      `INSERT INTO projection_thread_sessions (thread_id, status, provider_name, provider_session_id, active_turn_id, last_error)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run("thr-1", "stopped", "opencode", "sess-1", null, null);
  handle.close();
}

function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/helmcode-config", router);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: data ? { "content-type": "application/json", "content-length": data.length } : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

describe("Helm Code Config Explorer route", () => {
  let server;
  let port;

  after(() => {
    if (server) server.close();
  });

  describe("with a populated state.db fixture", () => {
    it("GET /overview reports home, state DB, runtime, and projection counts", async () => {
      // Build the fixture after the server is up so the route picks it up.
      // (The route reads lazily per request.)
      // The dashboard DB needs the helmcode stmts to exist; require db above.
      assert.ok(stmts, "stmts must load");
      buildStateFixture();

      const up = await startServer();
      server = up.server;
      port = up.port;

      const res = await request(port, "GET", "/api/helmcode-config/overview");
      assert.equal(res.status, 200);
      const body = res.json;
      assert.equal(body.home, process.env.DASHBOARD_HELMCODE_HOME);
      assert.equal(body.state_db_path, statePath());
      assert.equal(body.state_db.exists, true);
      assert.ok(body.state_db.size_bytes > 0);
      assert.equal(typeof body.state_db.mtime, "string");
      assert.equal(body.server_runtime, null);
      assert.equal(body.env.DASHBOARD_HELMCODE_HOME, process.env.DASHBOARD_HELMCODE_HOME);
      assert.equal(body.sync.poll_ms, 4000);
      assert.equal(body.projection_counts.projects, 1);
      assert.equal(body.projection_counts.threads, 2);
      assert.equal(body.projection_counts.archived, 0);
      assert.equal(body.projection_counts.deleted, 0);
      assert.equal(body.projection_counts.messages, 0);
      assert.equal(body.projection_counts.activities, 0);
      assert.equal(body.projection_counts.turns, 0);
    });

    it("POST /resync without confirmation returns 400 ENOTCONFIRMED", async () => {
      const res = await request(port, "POST", "/api/helmcode-config/resync", {});
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "ENOTCONFIRMED");
    });

    it("POST /resync with confirmation returns ok + summary and materializes sessions", async () => {
      const before = stmts.listHelmcodeSessions.all().length;
      const res = await request(port, "POST", "/api/helmcode-config/resync", { confirmed: true });
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, true);
      assert.equal(res.json.summary.scanned, 2);
      assert.equal(res.json.summary.created, 2);
      assert.equal(res.json.summary.removed, 0);
      const after = stmts.listHelmcodeSessions.all().length;
      assert.equal(after - before, 2);
    });

    it("POST /resync is idempotent on a second call (no new creates)", async () => {
      const res = await request(port, "POST", "/api/helmcode-config/resync", { confirmed: true });
      assert.equal(res.status, 200);
      assert.equal(res.json.summary.scanned, 2);
      assert.equal(res.json.summary.created, 0);
    });
  });

  describe("with no state database (Helm Code never ran on this machine)", () => {
    it("GET /overview still returns 200 with projection_counts: null and state_db.exists: false", async () => {
      // Switch the home to an empty directory and rebind the env.
      const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-helmcode-empty-"));
      const saved = process.env.DASHBOARD_HELMCODE_HOME;
      process.env.DASHBOARD_HELMCODE_HOME = emptyHome;
      try {
        if (server) {
          server.close();
          server = null;
        }
        const up = await startServer();
        server = up.server;
        port = up.port;
        const res = await request(port, "GET", "/api/helmcode-config/overview");
        assert.equal(res.status, 200);
        const body = res.json;
        assert.equal(body.home, emptyHome);
        assert.equal(body.state_db.exists, false);
        assert.equal(body.state_db.size_bytes, null);
        assert.equal(body.projection_counts, null);
      } finally {
        process.env.DASHBOARD_HELMCODE_HOME = saved;
      }
    });
  });
});

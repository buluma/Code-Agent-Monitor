/**
 * @file Verifies Helm Code thread ingestion end-to-end against a synthetic
 * state.sqlite fixture: first-sweep materialization, second-sweep idempotence,
 * incremental event emission after the orchestration cursor advances, wipe-on-
 * delete/archive plus liveness reconciliation, and the shared transcript DTO
 * served for helmcode sessions.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { after, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-helmcode-ingest-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.DASHBOARD_HELMCODE_HOME = path.join(TMP, "helmcode");
delete process.env.DASHBOARD_LEGACY_DB_PATH;
delete process.env.DASHBOARD_LITE_DB_PATH;

const { db, stmts } = require("../db");
const { readHelmcodeTranscript } = require("../routes/sessions");
const {
  syncHelmcodeSessions,
  ingestHelmcodeSnapshot,
  reconcileHelmcodeLiveness,
} = require("../lib/helmcode-ingest");

const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const T3 = "00000000-0000-4000-8000-000000000003";
const T4 = "00000000-0000-4000-8000-000000000004";

// The state database Helm Code (release builds) owns: `<home>/userdata/state.sqlite`.
function statePath() {
  return path.join(process.env.DASHBOARD_HELMCODE_HOME, "userdata", "state.sqlite");
}

function openState() {
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
    CREATE TABLE IF NOT EXISTS orchestration_events (
      aggregate_kind TEXT,
      stream_id TEXT,
      sequence INTEGER
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
  return handle;
}

function seedThread(handle, thread) {
  const insert = handle.prepare(
    `INSERT OR REPLACE INTO projection_threads
       (thread_id, project_id, title, created_at, updated_at, archived_at, deleted_at,
        model_selection_json, interaction_mode, runtime_mode, pending_approval_count,
        pinned_at, snoozed_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run(
    thread.thread_id,
    thread.project_id || "proj-1",
    thread.title,
    thread.created_at || "2026-08-01T12:00:00.000Z",
    thread.updated_at || "2026-08-01T12:00:00.000Z",
    thread.archived_at || null,
    thread.deleted_at || null,
    thread.model_selection_json || null,
    thread.interaction_mode || "threaded",
    thread.runtime_mode || "agent",
    thread.pending_approval_count || 0,
    thread.pinned_at || null,
    thread.snoozed_until || null
  );
  handle
    .prepare(
      "INSERT OR REPLACE INTO projection_projects (project_id, workspace_root, default_model_selection_json, deleted_at) VALUES (?, ?, ?, ?)"
    )
    .run(
      thread.project_id || "proj-1",
      thread.workspace_root || "/workspace/demo",
      thread.project_default_model_selection_json || null,
      null
    );
  handle
    .prepare(
      "INSERT OR REPLACE INTO projection_thread_sessions (thread_id, status, provider_name, provider_session_id, active_turn_id, last_error) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(
      thread.thread_id,
      thread.runtime_status || null,
      thread.provider_name || null,
      thread.provider_session_id || null,
      thread.active_turn_id || null,
      thread.last_error || null
    );
  handle
    .prepare(
      "INSERT INTO orchestration_events (aggregate_kind, stream_id, sequence) VALUES ('thread', ?, ?)"
    )
    .run(thread.thread_id, thread.sequence ?? 1);
}

function seedMessage(handle, message) {
  handle
    .prepare(
      `INSERT OR REPLACE INTO projection_thread_messages
         (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.message_id,
      message.thread_id,
      message.turn_id || null,
      message.role,
      message.text,
      message.is_streaming ? 1 : 0,
      message.created_at || "2026-08-01T12:00:00.000Z",
      message.updated_at || message.created_at || "2026-08-01T12:00:00.000Z"
    );
}

function seedActivity(handle, activity) {
  handle
    .prepare(
      `INSERT OR REPLACE INTO projection_thread_activities
         (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      activity.activity_id,
      activity.thread_id,
      activity.turn_id || null,
      activity.tone || "normal",
      activity.kind,
      activity.summary || null,
      activity.payload_json || null,
      activity.created_at || "2026-08-01T12:00:00.000Z"
    );
}

function seedTurn(handle, rowId, turn) {
  handle
    .prepare(
      "INSERT INTO projection_turns (row_id, thread_id, turn_id, state, requested_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      rowId,
      turn.thread_id,
      turn.turn_id || `turn-${rowId}`,
      turn.state || "completed",
      turn.requested_at || null,
      turn.started_at || "2026-08-01T12:00:00.000Z",
      turn.completed_at || "2026-08-01T12:01:00.000Z"
    );
}

function eventCount(eventType) {
  return db.prepare("SELECT COUNT(*) AS c FROM events WHERE event_type = ?").get(eventType).c;
}

after(() => {
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("Helm Code ingestor", () => {
  it("materializes a thread on first sweep and is idempotent on the second", () => {
    const handle = openState();
    seedThread(handle, {
      thread_id: T1,
      title: "Track my Helm Code run",
      workspace_root: "/workspace/demo",
      model_selection_json: '{"model":"claude-opus-4-1"}',
      runtime_status: "running",
      active_turn_id: "turn-a",
      sequence: 5,
    });
    seedMessage(handle, {
      message_id: "m1",
      thread_id: T1,
      turn_id: "turn-a",
      role: "user",
      text: "Track my Helm Code run",
    });
    seedMessage(handle, {
      message_id: "m2",
      thread_id: T1,
      turn_id: "turn-a",
      role: "assistant",
      text: "Watching your thread now.",
    });
    seedActivity(handle, {
      activity_id: "a1",
      thread_id: T1,
      turn_id: "turn-a",
      kind: "tool.started",
      summary: "exec",
      payload_json: '{"detail":"rg helmcode"}',
    });
    seedActivity(handle, {
      activity_id: "a2",
      thread_id: T1,
      turn_id: "turn-a",
      kind: "context-window.updated",
      summary: null,
      payload_json: null,
    });
    seedTurn(handle, 1, { thread_id: T1, turn_id: "turn-a", state: "completed" });
    handle.close();

    const results = syncHelmcodeSessions();
    assert.equal(results.length, 1);
    assert.equal(results[0].created, true);

    const session = stmts.getSession.get(T1);
    assert.equal(session.provider, "helmcode");
    assert.equal(session.name, "Track my Helm Code run");
    assert.equal(session.status, "active");
    assert.equal(session.cwd, "/workspace/demo");
    const metadata = JSON.parse(session.metadata || "{}");
    assert.equal(metadata.provider, "helmcode");
    assert.equal(metadata.underlying_provider, null);

    const agent = stmts.getAgent.get(`helmcode:${T1}`);
    assert.equal(agent.name, "Helm Code");
    assert.equal(agent.type, "main");

    assert.equal(stmts.listHelmcodeMessages.all(T1).length, 2);
    assert.equal(eventCount("helmcode_tool_call"), 1);
    assert.equal(eventCount("helmcode_context_compacted"), 1);
    assert.equal(eventCount("helmcode_user_message"), 1);
    assert.equal(eventCount("helmcode_turn_start"), 1);
    assert.equal(eventCount("helmcode_turn_complete"), 1);

    // Same-state sweep: the orchestration cursor has not advanced, so the
    // thread is skipped with nothing re-emitted.
    const second = syncHelmcodeSessions();
    assert.deepEqual(second, []);
    assert.equal(eventCount("helmcode_user_message"), 1);
    assert.equal(stmts.getSession.get(T1).id, T1);
  });

  it("emits only the new activity once the cursor advances, without re-publishing user messages", () => {
    const handle = openState();
    handle
      .prepare(
        "INSERT INTO orchestration_events (aggregate_kind, stream_id, sequence) VALUES ('thread', ?, ?)"
      )
      .run(T1, 6);
    seedActivity(handle, {
      activity_id: "a3",
      thread_id: T1,
      turn_id: "turn-a",
      kind: "tool.updated",
      summary: "apply_patch",
      payload_json: null,
    });
    handle.close();

    const results = syncHelmcodeSessions();
    assert.equal(results.length, 1);
    assert.equal(results[0].created, false);
    assert.equal(eventCount("helmcode_tool_call"), 2);
    // Messages are untouched by the turn following the cursor; the human turn
    // was already surfaced once and must not double-emit.
    assert.equal(eventCount("helmcode_user_message"), 1);
    assert.equal(stmts.listHelmcodeMessages.all(T1).length, 2);
  });

  it("syncs the thread's latest context-window snapshot as its token bucket, high-water-mark style", () => {
    const handle = openState();
    seedThread(handle, {
      thread_id: T4,
      title: "Track token sync",
      workspace_root: "/workspace/tokens",
      model_selection_json: '{"model":"claude-sonnet-5"}',
      sequence: 1,
    });
    seedActivity(handle, {
      activity_id: "tok-a1",
      thread_id: T4,
      kind: "context-window.updated",
      created_at: "2026-08-01T12:00:00.000Z",
      payload_json: JSON.stringify({
        usedTokens: 1200,
        inputTokens: 1000,
        outputTokens: 200,
        maxTokens: 967000,
      }),
    });
    handle.close();

    syncHelmcodeSessions();
    let tokens = stmts.getTokensBySession.all(T4);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].model, "claude-sonnet-5");
    assert.equal(tokens[0].input_tokens, 1000);
    assert.equal(tokens[0].output_tokens, 200);

    // A later, larger cumulative snapshot replaces the bucket outright — Helm
    // Code's payload is a running total, not a delta.
    const handle2 = openState();
    handle2
      .prepare(
        "INSERT INTO orchestration_events (aggregate_kind, stream_id, sequence) VALUES ('thread', ?, ?)"
      )
      .run(T4, 2);
    seedActivity(handle2, {
      activity_id: "tok-a2",
      thread_id: T4,
      kind: "context-window.updated",
      created_at: "2026-08-01T12:05:00.000Z",
      payload_json: JSON.stringify({
        usedTokens: 4500,
        inputTokens: 4000,
        outputTokens: 500,
        maxTokens: 967000,
      }),
    });
    handle2.close();

    syncHelmcodeSessions();
    tokens = stmts.getTokensBySession.all(T4);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].input_tokens, 4000);
    assert.equal(tokens[0].output_tokens, 500);
  });

  it("skips the token sync (without crashing the sweep) when the snapshot has no input/output split or no model is known", () => {
    const noModelThread = "00000000-0000-4000-8000-000000000005";
    const handle = openState();
    seedThread(handle, {
      thread_id: noModelThread,
      title: "No model selected",
      workspace_root: "/workspace/no-model",
      sequence: 1,
    });
    seedActivity(handle, {
      activity_id: "tok-b1",
      thread_id: noModelThread,
      kind: "context-window.updated",
      // Older Helm Code shape: only the cumulative total, no input/output split.
      payload_json: JSON.stringify({ usedTokens: 500, maxTokens: 967000 }),
    });
    handle.close();

    const results = syncHelmcodeSessions();
    assert.ok(results.find((r) => r.id === noModelThread || r.session?.id === noModelThread));
    assert.equal(stmts.getTokensBySession.all(noModelThread).length, 0);
  });

  it("wipes a thread whose Helm Code row is deleted or archived", () => {
    const handle = openState();
    seedThread(handle, {
      thread_id: T2,
      title: "Will vanish",
      workspace_root: "/tmp/ghost",
      sequence: 2,
    });
    seedMessage(handle, {
      message_id: "m-ghost",
      thread_id: T2,
      role: "user",
      text: "Delete me",
    });
    handle.close();

    const created = syncHelmcodeSessions();
    assert.equal(created.length, 1);
    assert.ok(stmts.getSession.get(T2));

    const handle2 = openState();
    handle2
      .prepare("UPDATE projection_threads SET deleted_at = ? WHERE thread_id = ?")
      .run("2026-08-01T13:00:00.000Z", T2);
    handle2
      .prepare("UPDATE projection_threads SET archived_at = ? WHERE thread_id = ?")
      .run("2026-08-01T13:00:00.000Z", T1);
    handle2.close();

    const swept = syncHelmcodeSessions();
    const removedT2 = swept.find((r) => r.removed && r.id === T2);
    assert.ok(removedT2, "deleted thread removal is published");
    assert.equal(stmts.getSession.get(T2), undefined);

    // T1 was archived (not deleted) → also wiped: both mean "gone from Helm Code".
    const archivedT1 = swept.find((r) => r.removed && r.id === T1);
    assert.ok(archivedT1, "archived thread removal is published");
    assert.equal(stmts.getSession.get(T1), undefined);
    assert.equal(stmts.getHelmcodeCursor.get(T1), undefined);
    assert.equal(eventCount("helmcode_user_message"), 0, "wiped sessions' events cascade away");
  });

  it("wipes rows whose projection disappears between sweeps (liveness)", () => {
    const handle = openState();
    seedThread(handle, {
      thread_id: T3,
      title: "Ghost thread",
      workspace_root: "/tmp/ghost2",
      sequence: 1,
    });
    seedMessage(handle, { message_id: "m-ghost2", thread_id: T3, role: "user", text: "am I here" });
    handle.close();

    // T1/T2 remain archived/deleted in this state file from the wipe test, so
    // their no-op wipe results are also reported here; only T3 must exist.
    const swept = syncHelmcodeSessions();
    assert.equal(
      swept.some((r) => r.created === true),
      true,
      "T3 is materialized"
    );
    assert.ok(stmts.getSession.get(T3));
    assert.ok(stmts.getSession.get(T3));

    const handle2 = openState();
    handle2.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(T3);
    handle2.close();

    const liveness = reconcileHelmcodeLiveness();
    assert.equal(liveness.length, 1);
    assert.equal(liveness[0].removed, true);
    assert.equal(liveness[0].id, T3);
    assert.equal(stmts.getSession.get(T3), undefined);
  });

  it("serves the shared transcript DTO with total/first/last/has_more pagination", () => {
    const handle = openState();
    seedThread(handle, {
      thread_id: T1,
      title: "Track my Helm Code run",
      workspace_root: "/workspace/demo",
      runtime_status: "running",
      sequence: 8,
    });
    seedMessage(handle, {
      message_id: "m1",
      thread_id: T1,
      turn_id: "turn-a",
      role: "user",
      text: "Track my Helm Code run",
      created_at: "2026-08-01T12:00:00.000Z",
    });
    seedMessage(handle, {
      message_id: "m2",
      thread_id: T1,
      turn_id: "turn-a",
      role: "assistant",
      text: "Watching your thread now.",
      created_at: "2026-08-01T12:00:01.000Z",
    });
    handle.close();
    syncHelmcodeSessions();

    const all = readHelmcodeTranscript(T1, {
      limit: 50,
      afterLine: null,
      beforeLine: null,
      offset: 0,
    });
    assert.equal(all.total, 2);
    assert.equal(all.messages.length, 2);
    assert.equal(all.has_more, false);
    assert.equal(all.first_line, 1);
    assert.equal(all.last_line, 2);
    assert.deepEqual(
      all.messages.map((m) => m.sender),
      ["user", "assistant"]
    );
    assert.equal(all.messages[0].content[0].type, "text");

    const latest = readHelmcodeTranscript(T1, {
      limit: 1,
      afterLine: null,
      beforeLine: null,
      offset: 0,
    });
    assert.equal(latest.messages.length, 1, "latest-N window keeps the newest line");
    assert.equal(latest.first_line, 2);
    assert.equal(latest.last_line, 2);
    assert.equal(latest.has_more, true);

    const after = readHelmcodeTranscript(T1, {
      limit: 1,
      afterLine: 1,
      beforeLine: null,
      offset: 0,
    });
    assert.equal(after.first_line, 2);
    assert.equal(after.last_line, 2);
    assert.equal(after.messages[0].content[0].text, "Watching your thread now.");

    const before = readHelmcodeTranscript(T1, {
      limit: 5,
      afterLine: null,
      beforeLine: 2,
      offset: 0,
    });
    assert.equal(before.first_line, 1);
    assert.equal(before.last_line, 1);
    assert.equal(before.messages[0].sender, "user");
    assert.equal(before.messages[0].content[0].text, "Track my Helm Code run");
  });
});

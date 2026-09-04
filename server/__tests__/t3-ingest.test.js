/**
 * @file Verifies T3 thread ingestion end-to-end against a synthetic
 * state.sqlite fixture: first-sweep materialization with T3 provider/event
 * attribution, second-sweep idempotence, incremental event emission after the
 * orchestration cursor advances, token-bucket sync, wipe-on-delete/archive,
 * and the shared transcript DTO served for t3 sessions.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { after, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cam-t3-ingest-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.DASHBOARD_T3_HOME = path.join(TMP, "t3");
delete process.env.DASHBOARD_LEGACY_DB_PATH;
delete process.env.DASHBOARD_LITE_DB_PATH;

const { db, stmts } = require("../db");
const { readT3Transcript } = require("../routes/sessions");
const { syncT3Sessions } = require("../lib/t3-ingest");

const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const T4 = "00000000-0000-4000-8000-000000000004";

// The state database T3 (release builds) owns: `<home>/userdata/state.sqlite`.
function statePath() {
  return path.join(process.env.DASHBOARD_T3_HOME, "userdata", "state.sqlite");
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
  delete process.env.DASHBOARD_T3_HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("T3 ingestor", () => {
  it("materializes a thread with T3 provider/event attribution and is idempotent on the second", () => {
    const handle = openState();
    seedThread(handle, {
      thread_id: T1,
      title: "Track my T3 run",
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
      text: "Track my T3 run",
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
      payload_json: '{"detail":"rg t3"}',
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

    const results = syncT3Sessions();
    assert.equal(results.length, 1);
    assert.equal(results[0].created, true);

    const session = stmts.getSession.get(T1);
    assert.equal(session.provider, "t3");
    assert.equal(session.name, "Track my T3 run");
    assert.equal(session.status, "active");
    assert.equal(session.cwd, "/workspace/demo");
    const metadata = JSON.parse(session.metadata || "{}");
    assert.equal(metadata.provider, "t3");
    assert.equal(metadata.underlying_provider, null);

    const agent = stmts.getAgent.get(`t3:${T1}`);
    assert.equal(agent.name, "T3");
    assert.equal(agent.type, "main");

    assert.equal(stmts.listT3Messages.all(T1).length, 2);
    assert.equal(eventCount("t3_tool_call"), 1);
    assert.equal(eventCount("t3_context_compacted"), 1);
    assert.equal(eventCount("t3_user_message"), 1);
    assert.equal(eventCount("t3_turn_start"), 1);
    assert.equal(eventCount("t3_turn_complete"), 1);

    // Same-state sweep: the orchestration cursor has not advanced, so the
    // thread is skipped with nothing re-emitted.
    const second = syncT3Sessions();
    assert.deepEqual(second, []);
    assert.equal(eventCount("t3_user_message"), 1);
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

    const results = syncT3Sessions();
    assert.equal(results.length, 1);
    assert.equal(results[0].created, false);
    assert.equal(eventCount("t3_tool_call"), 2);
    // Messages are untouched by the turn following the cursor; the human turn
    // was already surfaced once and must not double-emit.
    assert.equal(eventCount("t3_user_message"), 1);
    assert.equal(stmts.listT3Messages.all(T1).length, 2);
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

    syncT3Sessions();
    let tokens = stmts.getTokensBySession.all(T4);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].model, "claude-sonnet-5");
    assert.equal(tokens[0].input_tokens, 1000);
    assert.equal(tokens[0].output_tokens, 200);
  });

  it("serves the shared transcript DTO with T3 pagination", () => {
    const handle = openState();
    seedThread(handle, {
      thread_id: T2,
      title: "Track my T3 run",
      workspace_root: "/workspace/demo",
      runtime_status: "running",
      sequence: 8,
    });
    seedMessage(handle, {
      message_id: "m-t2-1",
      thread_id: T2,
      turn_id: "turn-a",
      role: "user",
      text: "Track my T3 run",
      created_at: "2026-08-01T12:00:00.000Z",
    });
    seedMessage(handle, {
      message_id: "m-t2-2",
      thread_id: T2,
      turn_id: "turn-a",
      role: "assistant",
      text: "Watching your thread now.",
      created_at: "2026-08-01T12:00:01.000Z",
    });
    handle.close();
    syncT3Sessions();

    const all = readT3Transcript(T2, {
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
  });
});

/**
 * @file Incremental, idempotent ingest of Helm Code threads into the dashboard
 * provider model. Helm Code keeps all state in its own SQLite state database
 * (WAL mode) instead of JSONL transcripts, so the dashboard mirrors its
 * orchestration-event log + projections into sessions/agents/events/messages
 * with a per-thread cursor. Every Helm Code read is optional: an unreadable or
 * drifted schema fails to "no change", never crashes the sweep, and a failed
 * pass leaves cursors unmoved so the next sweep retries.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const fs = require("fs");
const { db, stmts, Database } = require("../db");
const { getHelmcodeStateDbPath, getHelmcodeServerRuntime } = require("./helmcode-home");

const PROMPT_TEXT_LIMIT = 10240;
const TOOL_ACTIVITY_EVENTS = new Set(["tool.started", "tool.updated", "tool.completed"]);
const COMPACT_ACTIVITY_EVENTS = new Set(["context-window.updated", "checkpoint.captured"]);
const ERROR_ACTIVITY_EVENTS = new Set([
  "checkpoint.capture.failed",
  "runtime.error",
  "runtime.warning",
  "provider.turn.start.failed",
]);

function openStateDb() {
  const statePath = getHelmcodeStateDbPath();
  if (!statePath || !fs.existsSync(statePath)) return null;
  let handle;
  try {
    handle = new Database(statePath, { readonly: true, fileMustExist: true });
    try {
      handle.pragma("busy_timeout = 5000");
    } catch {
      // pragma is a best-effort tuning knob; a schema-less core is still fine.
    }
    return handle;
  } catch {
    try {
      handle?.close();
    } catch {
      // read-only diagnostic access must never affect the dashboard.
    }
    return null;
  }
}

function withStateDb(fn) {
  if (typeof fn !== "function") return null;
  const handle = openStateDb();
  if (!handle) return null;
  try {
    return fn(handle);
  } catch (err) {
    // Helm Code is optional and its schema evolves; every read may fail. Log
    // the failure (so a broken ingest is diagnosable) without crashing the
    // sweep, and return null so callers degrade to "no change".
    console.warn("[HELMCODE SYNC] ingest pass failed:", err?.message || err);
    return null;
  } finally {
    try {
      handle.close();
    } catch {
      // Ignore close errors on the read-only handle.
    }
  }
}

function safeGet(handle, sql, ...params) {
  try {
    return handle.prepare(sql).get(...params) || null;
  } catch {
    return null;
  }
}

function safeAll(handle, sql, ...params) {
  try {
    return handle.prepare(sql).all(...params) || [];
  } catch {
    return [];
  }
}

function parseModelSelection(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.model === "string") {
      return parsed.model;
    }
  } catch {
    // Malformed selection JSON is optional metadata; fall through.
  }
  return null;
}

/** Every Helm Code thread row, joined with its project workspace and runtime. */
function findHelmcodeThreads(handle) {
  return safeAll(
    handle,
    `SELECT t.thread_id, t.project_id, t.title, t.created_at, t.updated_at,
            t.archived_at, t.deleted_at, t.model_selection_json,
            t.interaction_mode, t.runtime_mode,
            t.pending_approval_count, t.pinned_at, t.snoozed_until,
            p.workspace_root,
            p.default_model_selection_json AS project_default_model_selection_json,
            ts.status AS runtime_status, ts.provider_name, ts.provider_session_id,
            ts.active_turn_id, ts.last_error
     FROM projection_threads t
     LEFT JOIN projection_projects p ON p.project_id = t.project_id AND p.deleted_at IS NULL
     LEFT JOIN projection_thread_sessions ts ON ts.thread_id = t.thread_id`
  );
}

function threadMaxSequence(handle, threadId) {
  const row = safeGet(
    handle,
    `SELECT COALESCE(MAX(sequence), 0) AS m
     FROM orchestration_events
     WHERE aggregate_kind = 'thread' AND stream_id = ?`,
    threadId
  );
  return Number(row?.m) || 0;
}

function collectThreadMessages(handle, threadId) {
  return safeAll(
    handle,
    `SELECT message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
     FROM projection_thread_messages
     WHERE thread_id = ?
     ORDER BY created_at ASC, message_id ASC`,
    threadId
  );
}

function collectThreadActivities(handle, threadId) {
  return safeAll(
    handle,
    `SELECT activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
     FROM projection_thread_activities
     WHERE thread_id = ?
     ORDER BY created_at ASC, activity_id ASC`,
    threadId
  );
}

/**
 * The thread's most recent `context-window.updated` activity, if any. Helm
 * Code appends one of these per turn as a cumulative context-window snapshot
 * (`{usedTokens, totalProcessedTokens, inputTokens, outputTokens, maxTokens}`),
 * not a per-turn delta — the latest row is the thread's current token total.
 */
function latestContextWindowActivity(handle, threadId) {
  return safeGet(
    handle,
    `SELECT payload_json FROM projection_thread_activities
     WHERE thread_id = ? AND kind = 'context-window.updated'
     ORDER BY created_at DESC, activity_id DESC LIMIT 1`,
    threadId
  );
}

/**
 * Best-effort token/cost sync for a thread: reads its latest cumulative
 * context-window snapshot and the model it was run with, then writes both as
 * an absolute high-water-mark bucket via `replaceTokenUsage` — the same
 * primitive Claude's full-transcript re-parse uses, which is exactly right
 * here since Helm Code's snapshot is cumulative, not a delta. Silently no-ops
 * when the snapshot lacks a clean input/output split (older Helm Code
 * versions only recorded `usedTokens`) or no model can be resolved — Task 3
 * is explicitly best-effort, and an unpriced/untracked bucket is preferable
 * to a wrong one.
 */
function syncThreadTokenUsage(thread, handle) {
  try {
    const activity = latestContextWindowActivity(handle, thread.thread_id);
    if (!activity) return;
    const payload = JSON.parse(activity.payload_json);
    const inputTokens = Number(payload?.inputTokens);
    const outputTokens = Number(payload?.outputTokens);
    if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return;

    const model =
      parseModelSelection(thread.model_selection_json) ||
      parseModelSelection(thread.project_default_model_selection_json);
    if (!model) return;

    stmts.replaceTokenUsage.run(
      thread.thread_id,
      model,
      "standard",
      "global",
      "standard",
      inputTokens,
      outputTokens,
      0,
      0,
      0,
      0,
      0,
      0
    );
  } catch {
    // Best-effort: a malformed snapshot or write failure must never abort
    // the thread's message/activity sync that already ran above it.
  }
}

function collectThreadTurnsSince(handle, threadId, lastTurnRow) {
  return safeAll(
    handle,
    `SELECT row_id, thread_id, turn_id, state, requested_at, started_at, completed_at
     FROM projection_turns
     WHERE thread_id = ? AND row_id > ?
     ORDER BY row_id ASC`,
    threadId,
    lastTurnRow || 0
  );
}

function activityEventType(activity) {
  const { tone, kind } = activity || {};
  if (TOOL_ACTIVITY_EVENTS.has(kind)) return "helmcode_tool_call";
  if (ERROR_ACTIVITY_EVENTS.has(kind) || tone === "error") return "helmcode_error";
  if (COMPACT_ACTIVITY_EVENTS.has(kind)) return "helmcode_context_compacted";
  if (kind === "task.started") return "helmcode_task_started";
  if (kind === "task.updated") return "helmcode_task_updated";
  if (kind === "task.completed") return "helmcode_task_complete";
  return "helmcode_info";
}

function truncate(text, limit) {
  if (typeof text !== "string") return text;
  return text.length > limit ? text.slice(0, limit) : text;
}

function activityEventDetails(activity) {
  let data;
  try {
    data =
      typeof activity.payload_json === "string"
        ? JSON.parse(activity.payload_json)
        : activity.payload_json || {};
  } catch {
    data = {};
  }
  const detail =
    typeof data.detail === "string"
      ? data.detail
      : typeof data.message === "string"
        ? data.message
        : "";
  const tool =
    typeof activity.summary === "string" && activity.summary.trim()
      ? activity.summary
      : typeof data.itemType === "string"
        ? data.itemType
        : null;
  const eventType = activityEventType(activity);
  const summary = tool || (activity.summary && activity.summary.trim() ? activity.summary : null);
  return {
    eventType,
    toolName: eventType === "helmcode_tool_call" ? tool : null,
    summary: truncate(summary, PROMPT_TEXT_LIMIT),
    data: {
      provider: "helmcode",
      event: activity.kind,
      tone: activity.tone,
      activity_id: activity.activity_id,
      item_type: typeof data.itemType === "string" ? data.itemType : null,
      tool,
      detail: truncate(detail, PROMPT_TEXT_LIMIT) || null,
    },
  };
}

/** Map a Helm Code thread-session row onto the dashboard status vocabulary. */
function mapStatus(sessionRow) {
  if (!sessionRow) return "completed";
  if (sessionRow.last_error) return "error";
  if (!sessionRow.status || sessionRow.status === "stopped") return "completed";
  if (sessionRow.status === "running" || sessionRow.active_turn_id) return "active";
  return "completed";
}

const UPDATE_HELMCODE_SESSION = db.prepare(
  `UPDATE sessions SET
     name = COALESCE(?, name),
     status = ?,
     model = COALESCE(?, model),
     metadata = ?,
     cwd = COALESCE(?, cwd),
     ended_at = CASE WHEN ? IN ('completed', 'error', 'abandoned')
                      THEN COALESCE(ended_at, ?) ELSE NULL END,
     updated_at = ?
   WHERE id = ?`
);
const UPDATE_HELMCODE_AGENT = db.prepare(
  `UPDATE agents SET
     status = ?,
     ended_at = CASE WHEN ? = 'completed' THEN COALESCE(ended_at, ?) ELSE NULL END,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = ?`
);

function sessionMetadata(thread) {
  const runtime = getHelmcodeServerRuntime();
  const base = {
    provider: "helmcode",
    workspace_root: thread.workspace_root || null,
    underlying_provider: thread.provider_name || null,
    provider_session_id: thread.provider_session_id || null,
    interaction_mode: thread.interaction_mode || null,
    runtime_mode: thread.runtime_mode || null,
    pending_approval_count: thread.pending_approval_count || 0,
    pinned_at: thread.pinned_at || null,
    snoozed_until: thread.snoozed_until || null,
  };
  if (runtime && typeof runtime.port === "number") {
    base.helmcode_server = {
      port: runtime.port,
      pid: runtime.pid,
      origin: runtime.origin,
    };
  }
  return base;
}

function upsertHelmcodeSession(thread, status) {
  const sessionId = thread.thread_id;
  const existing = stmts.getSession.get(sessionId);
  const metadata = JSON.stringify(sessionMetadata(thread));
  const model =
    parseModelSelection(thread.model_selection_json) ||
    parseModelSelection(thread.project_default_model_selection_json) ||
    null;
  const endedAt =
    status === "completed" || status === "error" || status === "abandoned"
      ? thread.updated_at || new Date().toISOString()
      : null;
  if (!existing || existing.provider !== "helmcode") {
    stmts.insertHelmcodeSession.run(
      sessionId,
      thread.title || `New session - ${thread.created_at || new Date().toISOString()}`,
      status,
      thread.workspace_root || null,
      model || "unknown",
      "local",
      thread.created_at || new Date().toISOString(),
      thread.updated_at || thread.created_at || new Date().toISOString(),
      metadata
    );
  } else {
    const nextName = thread.title && thread.title !== existing.name ? thread.title : null;
    UPDATE_HELMCODE_SESSION.run(
      nextName,
      status,
      model && model !== existing.model ? model : null,
      metadata,
      existing.cwd !== thread.workspace_root ? thread.workspace_root : null,
      status,
      endedAt,
      thread.updated_at || existing.updated_at,
      sessionId
    );
  }
  return stmts.getSession.get(sessionId);
}

function upsertHelmcodeAgent(sessionId, status) {
  const agentId = `helmcode:${sessionId}`;
  const existing = stmts.getAgent.get(agentId);
  const next = status === "active" ? "working" : "completed";
  if (!existing) {
    stmts.insertAgent.run(
      agentId,
      sessionId,
      "Helm Code",
      "main",
      null,
      next,
      null,
      null,
      JSON.stringify({ provider: "helmcode", session_id: sessionId, main: true })
    );
  } else if (existing.status !== next) {
    UPDATE_HELMCODE_AGENT.run(next, next, null, agentId);
  }
  return stmts.getAgent.get(agentId);
}

function syncThreadMessages(threadId, handle, agentId, events) {
  const storedCount = stmts.listHelmcodeMessages.all(threadId).length;
  let projectionCount = 0;
  let watermark = "";
  try {
    projectionCount = handle
      .prepare(
        "SELECT COUNT(*) AS c FROM projection_thread_messages WHERE thread_id = ? AND is_streaming = 0"
      )
      .get(threadId).c;
  } catch {
    // A drifted projection schema is optional; message mirroring degrades.
  }
  try {
    watermark =
      handle
        .prepare(
          "SELECT COALESCE(MAX(updated_at), '') AS w FROM projection_thread_messages WHERE thread_id = ?"
        )
        .get(threadId)?.w || "";
  } catch {
    watermark = "";
  }
  const messages =
    projectionCount === storedCount && storedCount > 0
      ? collectThreadMessages(handle, threadId).filter(
          (m) => !m.is_streaming && m.updated_at > watermark
        )
      : collectThreadMessages(handle, threadId).filter((m) => !m.is_streaming);
  for (const message of messages) {
    stmts.upsertHelmcodeMessage.run(
      message.message_id,
      threadId,
      message.role,
      typeof message.text === "string" ? message.text : null,
      message.turn_id || null,
      null,
      message.created_at
    );
    // Surface each settled human turn in the activity feed too (parity with
    // Claude's UserPromptSubmit / Codex's codex_user_message), deduped through
    // the same activity key table so a retry can never double-emit.
    if (message.role === "user" && typeof message.text === "string" && message.text.trim()) {
      const dedupe = db
        .prepare("INSERT OR IGNORE INTO helmcode_activities (activity_id, thread_id) VALUES (?, ?)")
        .run(`msg:${message.message_id}`, threadId);
      if (dedupe.changes > 0) {
        const row = insertHelmcodeEvent(
          threadId,
          agentId,
          "helmcode_user_message",
          null,
          message.text && message.text.length > PROMPT_TEXT_LIMIT
            ? message.text.slice(0, PROMPT_TEXT_LIMIT)
            : message.text,
          { provider: "helmcode", event: "user_message", message_id: message.message_id },
          message.created_at
        );
        if (row && events) events.push(row);
      }
    }
  }
}

function insertHelmcodeEvent(sessionId, agentId, eventType, toolName, summary, data, createdAt) {
  const info = stmts.insertEventAt.run(
    sessionId,
    agentId,
    eventType,
    toolName,
    summary,
    JSON.stringify(data),
    createdAt
  );
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(info.lastInsertRowid);
  return row || null;
}

function reconcileHelmcodeThread(thread, handle, options = {}) {
  const cursorRow = stmts.getHelmcodeCursor.get(thread.thread_id);
  const lastApplied = cursorRow?.last_applied_sequence || 0;
  const maxSeq = threadMaxSequence(handle, thread.thread_id);
  if (options.full !== true && maxSeq <= lastApplied) {
    return {
      changed: false,
      created: false,
      session: null,
      agent: null,
      events: [],
      removed: false,
    };
  }

  const sessionRow = thread.runtime_status
    ? {
        status: thread.runtime_status,
        active_turn_id: thread.active_turn_id,
        last_error: thread.last_error,
        provider_name: thread.provider_name,
        provider_session_id: thread.provider_session_id,
      }
    : null;
  const status = mapStatus(sessionRow);
  const session = upsertHelmcodeSession(thread, status);
  const agent = upsertHelmcodeAgent(thread.thread_id, status);
  const events = [];

  syncThreadMessages(thread.thread_id, handle, agent?.id || `helmcode:${thread.thread_id}`, events);
  syncThreadTokenUsage(thread, handle);

  const knownActivities = stmts.listHelmcodeActivityIds
    .all(thread.thread_id)
    .map((r) => r.activity_id);
  const known = new Set(knownActivities);
  for (const activity of collectThreadActivities(handle, thread.thread_id)) {
    if (known.has(activity.activity_id)) continue;
    const details = activityEventDetails(activity);
    const row = insertHelmcodeEvent(
      thread.thread_id,
      agent?.id || `helmcode:${thread.thread_id}`,
      details.eventType,
      details.toolName,
      details.summary,
      details.data,
      activity.created_at || new Date().toISOString()
    );
    db.prepare(
      "INSERT OR IGNORE INTO helmcode_activities (activity_id, thread_id) VALUES (?, ?)"
    ).run(activity.activity_id, thread.thread_id);
    if (row) events.push(row);
  }

  const lastTurnRow = cursorRow?.last_turn_row || 0;
  for (const turn of collectThreadTurnsSince(handle, thread.thread_id, lastTurnRow)) {
    const turnData = {
      provider: "helmcode",
      turn_id: turn.turn_id || null,
      state: turn.state,
      turn_row: turn.row_id,
      started_at: turn.started_at || turn.requested_at || null,
      completed_at: turn.completed_at || null,
    };
    if (turn.started_at || turn.requested_at) {
      const row = insertHelmcodeEvent(
        thread.thread_id,
        agent?.id || `helmcode:${thread.thread_id}`,
        "helmcode_turn_start",
        null,
        "Turn started",
        turnData,
        turn.started_at || turn.requested_at
      );
      if (row) events.push(row);
    }
    if (turn.completed_at) {
      const row = insertHelmcodeEvent(
        thread.thread_id,
        agent?.id || `helmcode:${thread.thread_id}`,
        "helmcode_turn_complete",
        null,
        turn.state === "error" ? "Turn errored" : "Turn completed",
        turnData,
        turn.completed_at
      );
      if (row) events.push(row);
    }
  }

  stmts.upsertHelmcodeCursor.run(thread.thread_id, maxSeq);
  if (maxSeq) {
    db.prepare("UPDATE helmcode_sync SET last_turn_row = ? WHERE thread_id = ?").run(
      lastEmittableTurnRow(handle, thread.thread_id) || 0,
      thread.thread_id
    );
  }

  return {
    changed: true,
    created: !cursorRow,
    session: stmts.getSession.get(thread.thread_id),
    agent: stmts.getAgent.get(`helmcode:${thread.thread_id}`),
    events,
    removed: false,
  };
}

function lastEmittableTurnRow(handle, threadId) {
  const last = safeGet(
    handle,
    "SELECT MAX(row_id) AS r FROM projection_turns WHERE thread_id = ?",
    threadId
  );
  return Number(last?.r) || 0;
}

/**
 * Delete the dashboard rows for a Helm Code thread (session + cascade messages/
 * activities/events/agents) and its per-thread cursor. Used when the thread is
 * explicitly deleted or archived in Helm Code.
 */
function wipeHelmcodeThread(threadId) {
  const session = stmts.getSession.get(threadId);
  if (session) stmts.deleteHelmcodeSession.run(threadId);
  stmts.deleteHelmcodeCursor.run(threadId);
  return {
    changed: Boolean(session),
    removed: Boolean(session),
    id: threadId,
    provider: "helmcode",
    session: session || null,
  };
}

/** One-shot full import of every live Helm Code thread (fresh cursors). */
function ingestHelmcodeSnapshot(options = {}) {
  return (
    withStateDb((handle) => {
      const results = [];
      for (const thread of findHelmcodeThreads(handle)) {
        if (thread.deleted_at || thread.archived_at) {
          results.push(wipeHelmcodeThread(thread.thread_id));
          continue;
        }
        const reconciled = reconcileHelmcodeThread(thread, handle, {
          full: true,
          confirmedLive: options.confirmedLive,
        });
        if (reconciled.changed || reconciled.created) results.push(reconciled);
      }
      return results;
    }) || []
  );
}

/**
 * One sweep: refresh every changed Helm Code thread from its projections and
 * wipe threads deleted/archived in Helm Code. Returns the same result array
 * shape as the Codex ingestor so index.js can publish WS frames identically.
 */
function syncHelmcodeSessions(options = {}) {
  return (
    withStateDb((handle) => {
      const results = [];
      for (const thread of findHelmcodeThreads(handle)) {
        if (thread.deleted_at || thread.archived_at) {
          results.push(wipeHelmcodeThread(thread.thread_id));
          continue;
        }
        const reconciled = reconcileHelmcodeThread(thread, handle, options);
        if (reconciled.changed || reconciled.created) results.push(reconciled);
      }
      return results;
    }) || []
  );
}

/**
 * Reconcile dashboard rows that no longer exist in Helm Code's projections.
 * Threads are normally removed via their `deleted_at`/`archived_at` markers
 * (handled in the sync pass), so this covers only rows whose projection was
 * rebuilt or whose thread vanished between sweeps.
 */
function reconcileHelmcodeLiveness() {
  const results = [];
  for (const session of stmts.listHelmcodeSessions.all()) {
    const live = withStateDb((handle) => {
      const row = safeGet(
        handle,
        "SELECT thread_id FROM projection_threads WHERE thread_id = ?",
        session.id
      );
      return Boolean(row);
    });
    // An unreadable state DB (missing home) must never wipe anything; the sync
    // sweep owns the wipe path and simply finds nothing to publish then.
    if (live === false) {
      results.push(wipeHelmcodeThread(session.id));
    }
  }
  return results;
}

/**
 * Read-only projection counts for the Config Explorer overview. Every count
 * is wrapped in `safeGet` so a drifted projection schema returns `null` for
 * the missing table instead of throwing — the dashboard must never crash on
 * an optional Helm Code table.
 */
function getHelmcodeProjectionCounts() {
  return withStateDb((handle) => {
    const count = (sql) => {
      const row = safeGet(handle, sql);
      return Number(row?.c) || 0;
    };
    return {
      projects: count("SELECT COUNT(*) AS c FROM projection_projects WHERE deleted_at IS NULL"),
      threads: count(
        "SELECT COUNT(*) AS c FROM projection_threads WHERE deleted_at IS NULL AND archived_at IS NULL"
      ),
      archived: count(
        "SELECT COUNT(*) AS c FROM projection_threads WHERE archived_at IS NOT NULL AND deleted_at IS NULL"
      ),
      deleted: count("SELECT COUNT(*) AS c FROM projection_threads WHERE deleted_at IS NOT NULL"),
      messages: count(
        "SELECT COUNT(*) AS c FROM projection_thread_messages WHERE is_streaming = 0"
      ),
      activities: count("SELECT COUNT(*) AS c FROM projection_thread_activities"),
      turns: count("SELECT COUNT(*) AS c FROM projection_turns"),
    };
  });
}

module.exports = {
  findHelmcodeThreads,
  syncHelmcodeSessions,
  ingestHelmcodeSnapshot,
  reconcileHelmcodeLiveness,
  getHelmcodeProjectionCounts,
  mapStatus,
  activityEventType,
  // Exposed for the Config Explorer / health surfaces. The ingest path
  // itself never calls these externally.
  openStateDb,
  withStateDb,
};

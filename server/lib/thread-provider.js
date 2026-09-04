/**
 * @file Generic, parameterized ingest/home/pricing/sync engine for
 * "thread-based" read-only providers — Helm Code and its fork T3. Both store
 * all session state in an identical SQLite projection schema (threads,
 * messages, activities, turns, orchestration events) instead of JSONL
 * transcripts, so the dashboard mirrors their orchestration-event log +
 * projections into provider-neutral rows. Each provider is described by a
 * small config object; the existing Helm Code surface keeps its exact module
 * surface by re-exporting these factories, and T3 re-exports them with its own
 * config. Every provider read is optional: an unreadable or drifted schema
 * fails to "no change", never crashes a sweep, and a failed pass leaves
 * cursors unmoved so the next sweep retries.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { db, stmts, Database } = require("../db");
const { writeEnvFile } = require("./claude-home");
const { makeCoalescedRunner } = require("./sweep-coalescer");

const PROMPT_TEXT_LIMIT = 10240;
const TOOL_ACTIVITY_EVENTS = new Set(["tool.started", "tool.updated", "tool.completed"]);
const COMPACT_ACTIVITY_EVENTS = new Set(["context-window.updated", "checkpoint.captured"]);
const ERROR_ACTIVITY_EVENTS = new Set([
  "checkpoint.capture.failed",
  "runtime.error",
  "runtime.warning",
  "provider.turn.start.failed",
]);

/**
 * Lower-case camel of a provider name for prepared-statement lookups, e.g.
 * "helmcode" → "Helmcode", "t3" → "T3".
 */
function stmtPrefix(provider) {
  return provider === "t3" ? "T3" : provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Build the generic engine bound to one provider config. */
function createThreadProvider(config) {
  const { provider, displayName, homeEnvKey, fallbackHomeEnvKey, defaultHome, syncIntervalEnvKey } =
    config;
  const st = stmtPrefix(provider);
  const table = `${provider}_`;

  // ---------------------------------------------------------------------------
  // Home resolution
  // ---------------------------------------------------------------------------

  const homeChangeListeners = new Set();

  function getHome() {
    return path.resolve(
      process.env[homeEnvKey] ||
        process.env[fallbackHomeEnvKey] ||
        path.join(os.homedir(), defaultHome)
    );
  }

  function getUserDataDir() {
    const home = getHome();
    const userdata = path.join(home, "userdata");
    const dev = path.join(home, "dev");
    const candidates = [userdata, dev];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(path.join(candidate, "state.sqlite"))) return candidate;
      } catch {
        // Missing/odd home must not break path resolution; fall through.
      }
    }
    return userdata;
  }

  function getStateDbPath() {
    return path.join(getUserDataDir(), "state.sqlite");
  }

  function getServerRuntime() {
    try {
      const raw = fs.readFileSync(path.join(getUserDataDir(), "server-runtime.json"), "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        version: typeof parsed.version === "number" ? parsed.version : null,
        pid: typeof parsed.pid === "number" ? parsed.pid : null,
        host: typeof parsed.host === "string" ? parsed.host : null,
        port: typeof parsed.port === "number" ? parsed.port : null,
        origin: typeof parsed.origin === "string" ? parsed.origin : null,
        started_at: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
      };
    } catch {
      return null;
    }
  }

  function getUsageModelRatesPath() {
    return path.join(getUserDataDir(), "usage-model-rates.json");
  }

  function getSyncIntervalMs() {
    const raw = process.env[syncIntervalEnvKey];
    if (raw == null || raw.trim() === "") return 4_000;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 4_000;
    return Math.floor(parsed);
  }

  function onHomeChanged(listener) {
    homeChangeListeners.add(listener);
    return () => homeChangeListeners.delete(listener);
  }

  function setHome(newPath) {
    const expanded = newPath.replace(/^~(?=\/)/, os.homedir());
    if (!path.isAbsolute(expanded)) {
      throw new Error(`${displayName} home must be an absolute path`);
    }
    const resolved = path.resolve(expanded);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }

    process.env[homeEnvKey] = resolved;
    writeEnvFile(homeEnvKey, resolved);
    for (const listener of homeChangeListeners) {
      try {
        listener(resolved);
      } catch {
        // A listener failure must never make a valid path update fail.
      }
    }
    return resolved;
  }

  // ---------------------------------------------------------------------------
  // Ingest engine
  // ---------------------------------------------------------------------------

  function openStateDb() {
    const statePath = getStateDbPath();
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
      console.warn(`[${provider.toUpperCase()} SYNC] ingest pass failed:`, err?.message || err);
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

  function findThreads(handle) {
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
   * an absolute high-water-mark bucket via `replaceTokenUsage`. Silently
   * no-ops when the snapshot lacks a clean input/output split or no model can
   * be resolved.
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
    if (TOOL_ACTIVITY_EVENTS.has(kind)) return `${provider}_tool_call`;
    if (ERROR_ACTIVITY_EVENTS.has(kind) || tone === "error") return `${provider}_error`;
    if (COMPACT_ACTIVITY_EVENTS.has(kind)) return `${provider}_context_compacted`;
    if (kind === "task.started") return `${provider}_task_started`;
    if (kind === "task.updated") return `${provider}_task_updated`;
    if (kind === "task.completed") return `${provider}_task_complete`;
    return `${provider}_info`;
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
      toolName: eventType === `${provider}_tool_call` ? tool : null,
      summary: truncate(summary, PROMPT_TEXT_LIMIT),
      data: {
        provider,
        event: activity.kind,
        tone: activity.tone,
        activity_id: activity.activity_id,
        item_type: typeof data.itemType === "string" ? data.itemType : null,
        tool,
        detail: truncate(detail, PROMPT_TEXT_LIMIT) || null,
      },
    };
  }

  function mapStatus(sessionRow) {
    if (!sessionRow) return "completed";
    if (sessionRow.last_error) return "error";
    if (!sessionRow.status || sessionRow.status === "stopped") return "completed";
    if (sessionRow.status === "running" || sessionRow.active_turn_id) return "active";
    return "completed";
  }

  const UPDATE_SESSION = db.prepare(
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
  const UPDATE_AGENT = db.prepare(
    `UPDATE agents SET
       status = ?,
       ended_at = CASE WHEN ? = 'completed' THEN COALESCE(ended_at, ?) ELSE NULL END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  );

  function sessionMetadata(thread) {
    const runtime = getServerRuntime();
    const base = {
      provider,
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
      base.source_server = {
        port: runtime.port,
        pid: runtime.pid,
        origin: runtime.origin,
      };
    }
    return base;
  }

  const insertSessionStmt = stmts[`insert${st}Session`];
  const getCursorStmt = stmts[`get${st}Cursor`];
  const upsertCursorStmt = stmts[`upsert${st}Cursor`];
  const upsertMessageStmt = stmts[`upsert${st}Message`];
  const listMessagesStmt = stmts[`list${st}Messages`];
  const deleteSessionStmt = stmts[`delete${st}Session`];
  const listSessionsStmt = stmts[`list${st}Sessions`];
  const listActivityIdsStmt = stmts[`list${st}ActivityIds`];
  const deleteCursorStmt = stmts[`delete${st}Cursor`];

  function upsertSession(thread, status) {
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
    if (!existing) {
      insertSessionStmt.run(
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
      UPDATE_SESSION.run(
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

  function upsertAgent(sessionId, status) {
    const agentId = `${provider}:${sessionId}`;
    const existing = stmts.getAgent.get(agentId);
    const next = status === "active" ? "working" : "completed";
    if (!existing) {
      stmts.insertAgent.run(
        agentId,
        sessionId,
        displayName,
        "main",
        null,
        next,
        null,
        null,
        JSON.stringify({ provider, session_id: sessionId, main: true })
      );
    } else if (existing.status !== next) {
      UPDATE_AGENT.run(next, next, null, agentId);
    }
    return stmts.getAgent.get(agentId);
  }

  function syncThreadMessages(threadId, handle, agentId, events) {
    const storedCount = listMessagesStmt.all(threadId).length;
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
      upsertMessageStmt.run(
        message.message_id,
        threadId,
        message.role,
        typeof message.text === "string" ? message.text : null,
        message.turn_id || null,
        null,
        message.created_at
      );
      if (message.role === "user" && typeof message.text === "string" && message.text.trim()) {
        const dedupe = db
          .prepare(
            `INSERT OR IGNORE INTO ${table}activities (activity_id, thread_id) VALUES (?, ?)`
          )
          .run(`msg:${message.message_id}`, threadId);
        if (dedupe.changes > 0) {
          const row = insertEvent(
            threadId,
            agentId,
            `${provider}_user_message`,
            null,
            message.text && message.text.length > PROMPT_TEXT_LIMIT
              ? message.text.slice(0, PROMPT_TEXT_LIMIT)
              : message.text,
            { provider, event: "user_message", message_id: message.message_id },
            message.created_at
          );
          if (row && events) events.push(row);
        }
      }
    }
  }

  function insertEvent(sessionId, agentId, eventType, toolName, summary, data, createdAt) {
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

  function lastEmittableTurnRow(handle, threadId) {
    const last = safeGet(
      handle,
      "SELECT MAX(row_id) AS r FROM projection_turns WHERE thread_id = ?",
      threadId
    );
    return Number(last?.r) || 0;
  }

  function providerCollision(threadId) {
    const existingSession = stmts.getSession.get(threadId);
    if (!existingSession || existingSession.provider === provider) return null;
    return {
      changed: false,
      created: false,
      skipped: true,
      collision: true,
      id: threadId,
      provider,
      existing_provider: existingSession.provider || "claude",
      session: existingSession,
      agent: null,
      events: [],
      removed: false,
    };
  }

  function reconcileThread(thread, handle, options = {}) {
    const collision = providerCollision(thread.thread_id);
    if (collision) return collision;
    const cursorRow = getCursorStmt.get(thread.thread_id);
    const lastApplied = cursorRow?.last_applied_sequence || 0;
    const maxSeq = threadMaxSequence(handle, thread.thread_id);
    if (options.full !== true && cursorRow && maxSeq <= lastApplied) {
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
    const session = upsertSession(thread, status);
    const agent = upsertAgent(thread.thread_id, status);
    const events = [];

    syncThreadMessages(
      thread.thread_id,
      handle,
      agent?.id || `${provider}:${thread.thread_id}`,
      events
    );
    syncThreadTokenUsage(thread, handle);

    const knownActivities = listActivityIdsStmt.all(thread.thread_id).map((r) => r.activity_id);
    const known = new Set(knownActivities);
    for (const activity of collectThreadActivities(handle, thread.thread_id)) {
      if (known.has(activity.activity_id)) continue;
      const details = activityEventDetails(activity);
      const row = insertEvent(
        thread.thread_id,
        agent?.id || `${provider}:${thread.thread_id}`,
        details.eventType,
        details.toolName,
        details.summary,
        details.data,
        activity.created_at || new Date().toISOString()
      );
      db.prepare(
        `INSERT OR IGNORE INTO ${table}activities (activity_id, thread_id) VALUES (?, ?)`
      ).run(activity.activity_id, thread.thread_id);
      if (row) events.push(row);
    }

    const lastTurnRow = cursorRow?.last_turn_row || 0;
    for (const turn of collectThreadTurnsSince(handle, thread.thread_id, lastTurnRow)) {
      const turnData = {
        provider,
        turn_id: turn.turn_id || null,
        state: turn.state,
        turn_row: turn.row_id,
        started_at: turn.started_at || turn.requested_at || null,
        completed_at: turn.completed_at || null,
      };
      if (turn.started_at || turn.requested_at) {
        const row = insertEvent(
          thread.thread_id,
          agent?.id || `${provider}:${thread.thread_id}`,
          `${provider}_turn_start`,
          null,
          "Turn started",
          turnData,
          turn.started_at || turn.requested_at
        );
        if (row) events.push(row);
      }
      if (turn.completed_at) {
        const row = insertEvent(
          thread.thread_id,
          agent?.id || `${provider}:${thread.thread_id}`,
          `${provider}_turn_complete`,
          null,
          turn.state === "error" ? "Turn errored" : "Turn completed",
          turnData,
          turn.completed_at
        );
        if (row) events.push(row);
      }
    }

    upsertCursorStmt.run(thread.thread_id, maxSeq);
    db.prepare(`UPDATE ${table}sync SET last_turn_row = ? WHERE thread_id = ?`).run(
      lastEmittableTurnRow(handle, thread.thread_id) || 0,
      thread.thread_id
    );

    return {
      changed: true,
      created: !cursorRow,
      session: stmts.getSession.get(thread.thread_id),
      agent: stmts.getAgent.get(`${provider}:${thread.thread_id}`),
      events,
      removed: false,
    };
  }

  function wipeThread(threadId) {
    const collision = providerCollision(threadId);
    if (collision) return collision;
    const session = stmts.getSession.get(threadId);
    if (session) deleteSessionStmt.run(threadId);
    deleteCursorStmt.run(threadId);
    return {
      changed: Boolean(session),
      removed: Boolean(session),
      id: threadId,
      provider,
      session: session || null,
    };
  }

  function ingestSnapshot(options = {}) {
    return (
      withStateDb((handle) => {
        const results = [];
        for (const thread of findThreads(handle)) {
          if (thread.deleted_at || thread.archived_at) {
            results.push(wipeThread(thread.thread_id));
            continue;
          }
          const reconciled = reconcileThread(thread, handle, {
            full: true,
            confirmedLive: options.confirmedLive,
          });
          if (reconciled.changed || reconciled.created || reconciled.skipped) {
            results.push(reconciled);
          }
        }
        return results;
      }) || []
    );
  }

  function syncSessions(options = {}) {
    return (
      withStateDb((handle) => {
        const results = [];
        for (const thread of findThreads(handle)) {
          if (thread.deleted_at || thread.archived_at) {
            results.push(wipeThread(thread.thread_id));
            continue;
          }
          const reconciled = reconcileThread(thread, handle, options);
          if (reconciled.changed || reconciled.created || reconciled.skipped) {
            results.push(reconciled);
          }
        }
        return results;
      }) || []
    );
  }

  function reconcileLiveness() {
    const results = [];
    for (const session of listSessionsStmt.all()) {
      const live = withStateDb((handle) => {
        const row = safeGet(
          handle,
          "SELECT thread_id FROM projection_threads WHERE thread_id = ?",
          session.id
        );
        return Boolean(row);
      });
      if (live === false) {
        results.push(wipeThread(session.id));
      }
    }
    return results;
  }

  function getProjectionCounts() {
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

  // ---------------------------------------------------------------------------
  // Pricing engine
  // ---------------------------------------------------------------------------

  const round4 = (n) => Math.round(n * 10000) / 10000;

  const MODEL_ID_PREFIXES = [
    "us-gov.anthropic.",
    "global.anthropic.",
    "anthropic.",
    "us.anthropic.",
    "eu.anthropic.",
    "au.anthropic.",
    "jp.anthropic.",
    "bedrock/us-gov-east-1/anthropic.",
    "bedrock/us-gov-east-1/",
    "bedrock/us-gov-west-1/anthropic.",
    "bedrock/us-gov-west-1/",
    "vertex_ai/",
    "azure_ai/",
    "openrouter/anthropic/",
    "databricks/databricks-",
    "perplexity/anthropic/",
    "snowflake/",
  ].sort((a, b) => b.length - a.length);

  let ratesCache = null;

  function loadModelRates() {
    const ratesPath = getUsageModelRatesPath();
    let stat;
    try {
      stat = fs.statSync(ratesPath);
    } catch {
      return null;
    }
    if (ratesCache && ratesCache.path === ratesPath && ratesCache.mtimeMs === stat.mtimeMs) {
      return ratesCache.rates;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(ratesPath, "utf8"));
    } catch {
      return null;
    }
    const document = parsed && typeof parsed === "object" ? parsed.document : null;
    if (!document || typeof document !== "object") return null;

    const rates = new Map();
    for (const [modelId, entry] of Object.entries(document)) {
      if (!entry || typeof entry !== "object") continue;
      const input = Number(entry.input_cost_per_token) || 0;
      const output = Number(entry.output_cost_per_token) || 0;
      if (input <= 0 && output <= 0) continue;
      rates.set(modelId, { input, output });
    }
    ratesCache = { mtimeMs: stat.mtimeMs, path: ratesPath, rates };
    return rates;
  }

  function resolveModelRate(rates, model) {
    if (!rates || !model) return null;
    if (rates.has(model)) return rates.get(model);
    for (const prefix of MODEL_ID_PREFIXES) {
      if (model.startsWith(prefix)) {
        const stripped = model.slice(prefix.length);
        if (rates.has(stripped)) return rates.get(stripped);
      }
    }
    return null;
  }

  function calculateCost(tokenRows) {
    const rates = loadModelRates();
    const breakdownMap = new Map();
    const unpriced = new Map();
    let total = 0;

    for (const row of tokenRows || []) {
      const rate = resolveModelRate(rates, row.model);
      const inputs = Number(row.input_tokens) || 0;
      const outputs = Number(row.output_tokens) || 0;
      const bucketCost = rate ? inputs * rate.input + outputs * rate.output : 0;
      total += bucketCost;

      if (!rate) {
        const key = row.model || "unknown";
        const entry = unpriced.get(key) || {
          model: row.model,
          speed: "standard",
          context_size: row.context_size || "short",
          reason: rates
            ? `No ${provider} rate entry matches this model`
            : `${displayName} has not fetched usage-model-rates.json yet`,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        };
        entry.input_tokens += inputs;
        entry.output_tokens += outputs;
        unpriced.set(key, entry);
        continue;
      }

      const key = row.model;
      const entry = breakdownMap.get(key) || {
        provider,
        model: row.model,
        speed: "standard",
        context_size: row.context_size || "short",
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cache_write_1h_tokens: 0,
        web_search_requests: 0,
        web_fetch_requests: 0,
        code_execution_requests: 0,
        matched_rule: null,
        _cost: 0,
      };
      entry.input_tokens += inputs;
      entry.output_tokens += outputs;
      entry._cost += bucketCost;
      breakdownMap.set(key, entry);
    }

    return {
      total_cost: round4(total),
      breakdown: [...breakdownMap.values()].map(({ _cost, ...entry }) => ({
        ...entry,
        cost: round4(_cost),
      })),
      feature_costs: {
        web_search_cost: 0,
        web_fetch_cost: 0,
        code_execution_cost: 0,
        code_execution_hours_estimated: 0,
        code_execution_free_hours: 0,
      },
      unpriced_models: [...unpriced.values()],
    };
  }

  // ---------------------------------------------------------------------------
  // Sync loop
  // ---------------------------------------------------------------------------

  function startSync({ broadcast }) {
    let watcher = null;
    let watchedStateDir = null;

    function publish(result) {
      if (!result?.changed) return;
      if (result.removed) {
        broadcast("session_removed", { id: result.id, provider: result.provider });
        return;
      }
      if (!result.session) return;
      broadcast(result.created ? "session_created" : "session_updated", result.session);
      if (result.agent) broadcast(result.created ? "agent_created" : "agent_updated", result.agent);
      for (const event of result.events || []) broadcast("new_event", event);
    }

    const runSweep = makeCoalescedRunner(async () => {
      try {
        watchStateDir();
        for (const result of reconcileLiveness()) publish(result);
        for (const result of syncSessions()) publish(result);
      } catch {
        // The provider is optional; an unreadable/missing home must not affect
        // startup or the Claude/Codex sync paths.
      }
    });

    const initial = setTimeout(() => void runSweep(), 300);
    if (initial.unref) initial.unref();

    const pollMs = getSyncIntervalMs();
    if (pollMs > 0) {
      const timer = setInterval(() => void runSweep(), pollMs);
      if (timer.unref) timer.unref();
    }

    let debounce;
    const schedule = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        void runSweep();
      }, 500);
      if (debounce.unref) debounce.unref();
    };

    function changeTriggersSweep(filename) {
      const name = filename && path.basename(String(filename));
      if (!name) return true;
      return name === "state.sqlite" || name === "state.sqlite-wal";
    }

    function watchStateDir() {
      const stateDir = getUserDataDir();
      if (stateDir !== watchedStateDir) {
        try {
          watcher?.close();
        } catch {
          // Polling remains the real-time safety net if a watcher cannot close.
        }
        watcher = null;
        watchedStateDir = stateDir;
      }
      if (watcher || !fs.existsSync(stateDir)) return;
      try {
        const nextWatcher = fs.watch(stateDir, { recursive: false }, (_event, filename) => {
          if (changeTriggersSweep(filename)) schedule();
        });
        watcher = nextWatcher;
        nextWatcher.on("error", () => {
          if (watcher !== nextWatcher) return;
          try {
            nextWatcher.close();
          } catch {
            // The polling sweep retries optional attachment.
          }
          watcher = null;
        });
        if (nextWatcher.unref) nextWatcher.unref();
      } catch {
        // The poll remains the sweep safety net.
      }
    }
    watchStateDir();

    onHomeChanged(() => {
      watchStateDir();
      setImmediate(() => void runSweep());
    });
  }

  // ---------------------------------------------------------------------------
  // Read-only transcript DTO (mirrors JSONL readers, minus file-growth drift)
  // ---------------------------------------------------------------------------

  function readTranscript(
    sessionId,
    { limit = 50, afterLine = null, beforeLine = null, offset = 0 } = {}
  ) {
    const rows = listMessagesStmt.all(sessionId);
    const candidates = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const text = typeof row.text === "string" ? row.text : "";
      candidates.push({
        type: row.role === "assistant" ? "assistant" : "user",
        sender: row.role === "assistant" ? "assistant" : "user",
        timestamp: row.created_at || null,
        content: [{ type: "text", text: truncate(text, 10240) }],
        line: index + 1,
      });
    }
    const total = candidates.length;
    const messages = [];
    let hasMore = false;
    for (const message of candidates) {
      if (beforeLine !== null && message.line >= beforeLine) break;
      if (afterLine !== null && message.line <= afterLine) continue;
      if (offset > 0 && message.line <= offset) continue;
      messages.push(message);
      if (afterLine !== null || offset > 0) {
        if (messages.length >= limit) {
          hasMore = true;
          break;
        }
      } else if (messages.length > limit) {
        messages.shift();
        hasMore = true;
      }
    }
    const firstLine = messages[0]?.line || 0;
    const lastLine = messages[messages.length - 1]?.line || 0;
    for (const message of messages) {
      delete message.line;
    }
    return { messages, total, has_more: hasMore, first_line: firstLine, last_line: lastLine };
  }

  return {
    // home
    getHome,
    getUserDataDir,
    getStateDbPath,
    getServerRuntime,
    getSyncIntervalMs,
    getUsageModelRatesPath,
    onHomeChanged,
    setHome,
    // ingest
    openStateDb,
    withStateDb,
    findThreads,
    mapStatus,
    activityEventType,
    syncSessions,
    ingestSnapshot,
    reconcileLiveness,
    getProjectionCounts,
    readTranscript,
    // pricing
    loadModelRates,
    resolveModelRate,
    calculateCost,
    // sync
    startSync,
  };
}

module.exports = {
  createThreadProvider,
  stmtPrefix,
};

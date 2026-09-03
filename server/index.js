/**
 * @file Sets up the Express server, API routes, WebSocket, production client,
 * and non-blocking Claude/Codex transcript synchronizers and maintenance jobs.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

// Load .env file (simple key=value, no external dependency needed)
(function loadDotEnv() {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const envPath = path.resolve(
    process.env.DASHBOARD_ENV_PATH || path.resolve(__dirname, "..", ".env")
  );
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (single or double)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val.replace(/^~(?=\/)/, os.homedir());
    }
  }
})();

const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const swaggerUi = require("swagger-ui-express");
const { initWebSocket } = require("./websocket");
const { createOpenApiSpec } = require("./openapi");
const { redocBundlePath, renderRedocHtml } = require("./lib/redoc");
const { writeServerInfo, removeServerInfo, peersSharingDataDir } = require("./lib/server-info");
const { getDataDir } = require("./lib/claude-home");
const {
  resolveHost,
  isLoopbackHostname,
  corsOptions,
  hostGuard,
  tokenGuard,
  hookGuard,
  getDashboardToken,
} = require("./lib/security");

const sessionsRouter = require("./routes/sessions");
const agentsRouter = require("./routes/agents");
const eventsRouter = require("./routes/events");
const statsRouter = require("./routes/stats");
const hooksRouter = require("./routes/hooks");
const analyticsRouter = require("./routes/analytics");
const pricingRouter = require("./routes/pricing");
const settingsRouter = require("./routes/settings");
const workflowsRouter = require("./routes/workflows");
const pushRouter = require("./routes/push");
const importRouter = require("./routes/import");
const updatesRouter = require("./routes/updates");
const ccConfigRouter = require("./routes/cc-config");
const codexConfigRouter = require("./routes/codex-config");
const helmcodeConfigRouter = require("./routes/helmcode-config");
const runRouter = require("./routes/run");
const alertsRouter = require("./routes/alerts");
const webhooksRouter = require("./routes/webhooks");
const remoteSourcesRouter = require("./routes/remote-sources");
const metricsRouter = require("./routes/metrics");
const linearRouter = require("./routes/linear");

const APP_VERSION = (() => {
  try {
    return require("../package.json").version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// API reference pages are served by Express even in development, while the
// dashboard favicon normally comes from Vite's public directory. Keep one
// explicit server route so Swagger and ReDoc always share the app identity.
const DASHBOARD_FAVICON_PATH = path.join(__dirname, "..", "client", "public", "favicon.svg");

function createApp() {
  const app = express();
  const openApiSpec = createOpenApiSpec();

  // Security hardening (GHSA-gr74-4xfh-6jw9): loopback-only CORS, a Host-header
  // allowlist (anti DNS-rebinding), and an optional bearer-token gate on /api/*.
  app.use(cors(corsOptions()));
  app.use(hostGuard);
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", tokenGuard);
  app.use("/api/hooks", hookGuard);

  app.use("/api/sessions", sessionsRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/hooks", hooksRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/pricing", pricingRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/workflows", workflowsRouter);
  app.use("/api/push", pushRouter);
  app.use("/api/import", importRouter);
  app.use("/api/updates", updatesRouter);
  app.use("/api/cc-config", ccConfigRouter);
  app.use("/api/codex-config", codexConfigRouter);
  app.use("/api/helmcode-config", helmcodeConfigRouter);
  app.use("/api/run", runRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/webhooks", webhooksRouter);
  app.use("/api/remote-sources", remoteSourcesRouter);
  app.use("/api/metrics", metricsRouter);
  app.use("/api/linear", linearRouter);
  app.get("/favicon.svg", (_req, res) => {
    res.type("image/svg+xml").sendFile(DASHBOARD_FAVICON_PATH);
  });
  app.get("/api/openapi.json", (_req, res) => {
    res.json(openApiSpec);
  });
  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: "Code Agent Monitor API Docs",
      customfavIcon: "/favicon.svg",
    })
  );

  // ReDoc — a read-optimized, three-panel rendering of the same OpenAPI spec
  // (complements Swagger UI's interactive console at /api/docs). The bundle is
  // served from node_modules, never a CDN, so the reference works offline.
  app.get("/api/redoc/redoc.standalone.js", (_req, res) => {
    res.sendFile(redocBundlePath(), (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  });
  app.get("/api/redoc", (_req, res) => {
    res
      .type("html")
      .send(
        renderRedocHtml(
          "/api/openapi.json",
          "/api/redoc/redoc.standalone.js",
          "Code Agent Monitor API Reference",
          "/favicon.svg"
        )
      );
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: APP_VERSION, timestamp: new Date().toISOString() });
  });

  return app;
}

function startServer(app, port) {
  const server = http.createServer(app);
  initWebSocket(server);

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    const clientDist = path.join(__dirname, "..", "client", "dist");
    // Cache policy designed to survive client rebuilds without forcing a hard
    // refresh:
    //   - Hashed bundles under /assets/ never change for a given URL, so cache
    //     them aggressively (immutable).
    //   - index.html, /sw.js, and /manifest.json *are* the cache-bust signal,
    //     so they must revalidate every load — without this the browser's
    //     heuristic cache happily serves a stale index.html that references
    //     asset hashes that no longer exist on disk.
    app.use(
      express.static(clientDist, {
        etag: true,
        lastModified: true,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            return;
          }
          const base = path.basename(filePath);
          if (base === "index.html" || base === "sw.js" || base === "manifest.json") {
            res.setHeader("Cache-Control", "no-cache, must-revalidate");
            return;
          }
          // Other static files (favicon, og-image, etc.): short revalidation
          // window — long enough to be friendly, short enough to recover from
          // a typo without telling users to hard-refresh.
          res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
        },
      })
    );
    // API handlers (including Swagger and ReDoc) are registered above. Never
    // let an unrecognised `/api/*` request fall through to the React shell:
    // otherwise a typo or stale reference asset can mount the dashboard's
    // first-run overlay over API documentation instead of returning a useful
    // API-shaped 404 response.
    app.use("/api", (req, res) => {
      res.status(404).json({
        error: {
          code: "ENOTFOUND",
          message: `API route not found: ${req.method} ${req.originalUrl}`,
        },
      });
    });
    app.get("/*splat", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  // Bind to loopback by default so the dashboard is not network-reachable out
  // of the box (GHSA-gr74-4xfh-6jw9). Operators opt into a wider bind with
  // DASHBOARD_HOST=0.0.0.0 — and are warned to set DASHBOARD_TOKEN when they do.
  const host = resolveHost();
  const boundLoopback = isLoopbackHostname(host);

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      // Publish the live port so the Claude Code hook handler can find this
      // server even when it bound a non-default port (the desktop app falls
      // back off 4820 when that port is already taken).
      writeServerInfo(port);
      const sharedDbPeers = peersSharingDataDir();
      if (sharedDbPeers.length > 0) {
        const peerPorts = sharedDbPeers.map((p) => p.port).join(", ");
        const ingestPort = Math.min(port, ...sharedDbPeers.map((p) => p.port));
        console.warn(
          `⚠️  Another dashboard is running on port(s) ${peerPorts} using the same database ` +
            `(${getDataDir()}). Hooks ingest through port ${ingestPort} only to avoid duplicate events. ` +
            `Stop extra instances if you do not need them.`
        );
      }
      const mode = isProduction ? "production" : "development";
      const shown = boundLoopback ? "localhost" : host;
      console.log(`Code Agent Monitor server running on http://${shown}:${port} (${mode})`);
      if (!boundLoopback) {
        console.warn(
          `⚠️  Dashboard bound to ${host} — reachable from the network. ` +
            (getDashboardToken()
              ? "DASHBOARD_TOKEN is set (API + WebSocket require it)."
              : "Set DASHBOARD_TOKEN to require auth, or it is OPEN to anyone who can reach this port.")
        );
      }
      if (!isProduction) {
        console.log(`Client dev server expected at http://localhost:5173`);
      }
      resolve(server);
    });
  });
}

/**
 * One-time bootstrap import of legacy Claude Code sessions from `~/.claude/`.
 *
 * Runs at most once per data directory, tracked by a `.legacy-import.done`
 * marker file written next to the database. A marker — rather than an "is the
 * DB empty?" check — is essential: the desktop app captures a live session via
 * hooks before the user ever thinks about history, so an emptiness check would
 * see a non-empty DB and skip the backfill forever, leaving every pre-existing
 * session missing from the dashboard. The import itself is idempotent
 * (per-session dedup), so running it against a DB that already holds some
 * sessions simply adds the missing ones.
 *
 * Fire-and-forget — the server does not await it. It lives in its own function
 * (rather than inline in the `require.main` block, where it used to sit) so
 * embedded hosts that call `startBackgroundServices()` — notably the desktop
 * app — get the same first-launch backfill instead of an empty dashboard.
 */
function autoImportLegacySessions() {
  try {
    const fs = require("fs");
    const dbModule = require("./db");
    const markerPath = path.join(path.dirname(dbModule.DB_PATH), ".legacy-import.done");
    if (fs.existsSync(markerPath)) return;

    const { importAllSessions, backfillCompactions } = require("../scripts/import-history");
    importAllSessions(dbModule)
      .then(({ imported, errors }) => {
        if (imported > 0) console.log(`Imported ${imported} legacy sessions from ~/.claude/`);
        if (errors > 0) console.log(`${errors} session files had errors during import`);
      })
      .then(() => backfillCompactions(dbModule))
      .then(({ backfilled }) => {
        if (backfilled > 0)
          console.log(`Backfilled ${backfilled} compaction events from ~/.claude/`);
      })
      // Backfill Workflow-tool run journals (issue #167) for all imported
      // sessions. Inner agents emit no hooks, so this on-disk scan is the only
      // way historical workflows surface.
      .then(() => require("./lib/workflow-ingest").ingestAllWorkflows(dbModule))
      .then(({ workflows }) => {
        if (workflows > 0) console.log(`Backfilled ${workflows} workflow run(s) from ~/.claude/`);
      })
      // Write the marker only after the import completes, so a crash mid-import
      // retries on the next start instead of being skipped forever.
      .then(() => {
        try {
          fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`);
        } catch {
          /* non-fatal — worst case the (idempotent) import re-runs next start */
        }
      })
      .catch(() => {});
  } catch (err) {
    console.warn("legacy session auto-import failed:", err.message);
  }
}

/**
 * One-time repair of token totals inflated before usage was reconciled per
 * `message.id` (issue #293).
 *
 * Why this cannot be left to the parser fix alone: `replaceTokenUsage` is a
 * monotonic high-water mark, so when the corrected parser re-reads a transcript
 * and produces a LOWER total, the difference is folded into `baseline_*` and the
 * effective number never drops. Every session that existed before the upgrade
 * would keep its inflated cost forever while new sessions priced correctly.
 *
 * Guards, in order:
 *   - a `.token-repair-v1.done` marker next to the database, written only after
 *     a completed pass, so a crash mid-repair retries instead of being skipped;
 *   - `DASHBOARD_TOKEN_REPAIR=0` opts out entirely;
 *   - skipped (without writing the marker) while another dashboard shares this
 *     data directory, since two concurrent repairs would race each other;
 *   - deferred off the boot path so a large corpus never delays the UI.
 *
 * The sweep clears and rewrites non-workflow `token_usage` rows, so it first
 * copies the table to `token_usage_pre_repair` — one snapshot, kept so the
 * pre-repair numbers stay recoverable with plain SQL. It is safe to drop.
 *
 * A hook that lands mid-repair can lose one write (the sweep parses outside its
 * transaction), but that self-heals: with baselines zeroed, the very next event
 * for that session re-parses the whole transcript and `replaceTokenUsage`
 * writes the true total.
 */
function repairInflatedTokenTotals() {
  try {
    const fs = require("fs");
    if (process.env.DASHBOARD_TOKEN_REPAIR === "0") return;

    const dbModule = require("./db");
    const markerPath = path.join(path.dirname(dbModule.DB_PATH), ".token-repair-v1.done");
    if (fs.existsSync(markerPath)) return;

    // Another dashboard on the same database would race this sweep. Skip
    // WITHOUT the marker so the instance that ends up alone still repairs.
    let peers = [];
    try {
      peers = peersSharingDataDir() || [];
    } catch {
      /* discovery is best-effort; treat an unreadable peer list as "alone" */
    }
    if (peers.length > 0) {
      console.log("Token repair deferred: another dashboard shares this database.");
      return;
    }

    const timer = setTimeout(() => {
      (async () => {
        try {
          dbModule.db.exec(
            "CREATE TABLE IF NOT EXISTS token_usage_pre_repair AS SELECT * FROM token_usage"
          );
          const { reconcileTokens } = require("../scripts/import-history");
          const result = await reconcileTokens(dbModule, { all: true, resetBaselines: true });
          if (result.sessionsTouched > 0) {
            console.log(
              `Repaired token totals for ${result.sessionsTouched} session(s) ` +
                `(issue #293). Pre-repair values kept in token_usage_pre_repair.`
            );
          }
          try {
            fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`);
          } catch {
            /* non-fatal — the (idempotent) repair simply re-runs next start */
          }
        } catch (err) {
          console.warn("token total repair failed:", err.message);
        }
      })();
    }, 8_000);
    if (timer.unref) timer.unref();
  } catch (err) {
    console.warn("token total repair could not start:", err.message);
  }
}

/**
 * Start the background services the dashboard relies on once the HTTP server
 * is listening: a one-time legacy-session import, the upstream update
 * scheduler, the Claude Code config watcher, and a one-time reconciliation of
 * orphaned run rows.
 *
 * Exported so alternative hosts can bring up the same services the standalone
 * `node server/index.js` path does. The desktop Electron shell `require()`s
 * this module instead of running it as the main entry, so the
 * `require.main === module` block below never executes for it.
 */
function startBackgroundServices() {
  // One-time legacy-session backfill (a no-op once its marker file exists).
  autoImportLegacySessions();

  // One-time repair of token totals inflated by the pre-reconciliation parser
  // (issue #293). Marker-gated and deferred; see the function for why the
  // parser fix alone cannot heal historical rows.
  repairInflatedTokenTotals();

  // Boot liveness reap. When the user quit Claude Code while the dashboard
  // was DOWN, the SessionEnd hook was lost and only the process probe can
  // tell the session is dead — without this, such sessions sit in Waiting
  // until a watchdog tick. Two passes, both fail-safe and off the startup
  // critical path:
  //   1. Immediately (next tick): reaps dead sessions ALREADY in the DB from
  //      a previous dashboard run — the common "app was up, app stopped,
  //      session quit, app starts" flow — so they never render as Waiting at
  //      all.
  //   2. ~5 s later: reaps sessions the startup project sync just IMPORTED
  //      (rows that didn't exist at boot). The 15 s watchdog remains the
  //      safety net for anything later (kill -9 / crashes fire no SessionEnd
  //      either), and its probe is skipped whenever no active session
  //      qualifies, so the steady-state cost is nil.
  // Both boot passes run with ignoreIdleGate: at boot the probe alone is the
  // truth — a session quit even ONE second before launch must clear
  // immediately, not after the LIVENESS_IDLE_SECONDS gate ages out (the gate
  // exists to protect long-running steady-state work on watchdog ticks, and
  // there is no in-flight work at boot).
  {
    const bootReap = (label) => {
      try {
        const { livenessReap } = require("./routes/hooks");
        livenessReap({ ignoreIdleGate: true });
        livenessReap({ ignoreIdleGate: true, provider: "codex" });
      } catch (err) {
        console.warn(`${label} liveness reap failed:`, err?.message || err);
      }
    };
    setImmediate(() => bootReap("boot"));
    const t = setTimeout(() => bootReap("post-import"), 5_000);
    if (t.unref) t.unref();
  }

  // Backfill per-agent token metadata onto subagent rows that predate per-agent
  // cost tracking, so their cards show their own cost instead of nothing. Runs
  // deferred and non-blocking; self-limiting (rows with a tokens key are
  // skipped), and metadata-only (never touches session token_usage).
  {
    const dbModule = require("./db");
    const { backfillSubagentTokenMetadata } = require("../scripts/import-history");
    const t = setTimeout(() => {
      Promise.resolve()
        .then(() => backfillSubagentTokenMetadata(dbModule))
        .then((r) => {
          if (r && r.stamped > 0)
            console.log(
              `Backfilled per-agent token cost for ${r.stamped} subagent(s) across ${r.sessions} session(s)`
            );
        })
        .catch((err) => console.warn("subagent token backfill failed:", err?.message || err));
    }, 500);
    if (t.unref) t.unref();
  }

  const { startUpdateScheduler } = require("./update-scheduler");
  const { broadcast } = require("./websocket");
  startUpdateScheduler({ broadcast });
  try {
    const { startCcWatcher } = require("./lib/cc-watcher");
    startCcWatcher({ broadcast });
  } catch (err) {
    console.warn("cc-watcher failed to start:", err.message);
  }
  try {
    const { startCodexConfigWatcher } = require("./lib/codex-config-watcher");
    startCodexConfigWatcher({ broadcast });
  } catch (err) {
    console.warn("codex-config-watcher failed to start:", err.message);
  }
  // Near-real-time Workflow-tool run ingestion. The run journal is written when
  // a workflow finishes — which may not coincide with a hook — so a fast,
  // change-fingerprinted poll over active sessions keeps the UI fresh without
  // waiting for the next Stop or the slow maintenance sweep.
  try {
    const { startWorkflowPoll } = require("./lib/workflow-poll");
    startWorkflowPoll({ broadcast });
  } catch (err) {
    console.warn("workflow poll failed to start:", err.message);
  }
  // Continuous discovery of sessions under ~/.claude/projects. The one-time
  // legacy backfill above runs only once (marker-gated), so a project added
  // later whose sessions never flow through hooks would otherwise stay invisible
  // until a manual rescan. This incremental, mtime-fingerprinted poll keeps the
  // default folder in sync without re-parsing unchanged files.
  try {
    const { startSessionSync } = require("./lib/session-sync");
    startSessionSync({ broadcast });
  } catch (err) {
    console.warn("session sync failed to start:", err.message);
  }
  // Codex rollouts are append-only JSONL files under ~/.codex/sessions. Hooks
  // nudge this path immediately; this watcher + short poll closes the gap when
  // a hook is unavailable, untrusted, or fired while the dashboard was down.
  try {
    const { startCodexSessionSync } = require("./lib/codex-session-sync");
    startCodexSessionSync({ broadcast });
  } catch (err) {
    console.warn("Codex session sync failed to start:", err.message);
  }
  // Helm Code persists its own orchestration events, so monitoring needs no
  // hook instrumentation — a short poll + debounced watcher over its state DB
  // mirrors new sessions/events and wipes cards for deleted threads.
  try {
    const { startHelmcodeSync } = require("./lib/helmcode-sync");
    startHelmcodeSync({ broadcast });
  } catch (err) {
    console.warn("Helm Code session sync failed to start:", err.message);
  }
  // A new Codex TUI has no provider session id until its first prompt. Keep a
  // process-only card in memory for that brief window. Durable rollout/state
  // ingestion remains unchanged and takes over as soon as Codex exposes an id.
  try {
    const { startCodexProcessOverlay } = require("./lib/codex-process-overlay");
    startCodexProcessOverlay({ broadcast });
  } catch (err) {
    console.warn("Codex startup overlay failed to start:", err.message);
  }
  // Pull Claude Code history from enabled remote (SSH) sources on an interval so
  // usage collected on other machines shows up here in near real time. Off by
  // default cost-wise: the loop only does work when the user has configured at
  // least one enabled source. Disable entirely with DASHBOARD_REMOTE_SYNC_MS=0.
  try {
    const { startRemoteSourceSync } = require("./lib/remote-source-sync");
    startRemoteSourceSync({ broadcast });
  } catch (err) {
    console.warn("remote source sync failed to start:", err.message);
  }
  // Flip any dashboard_runs rows the previous process left flagged
  // running/spawning — those handles died with the previous server, so
  // there's no way to attach to them anymore. Marking them abandoned
  // keeps the Run history honest and unblocks Resume on conversation rows.
  try {
    const { reconcileOrphans } = require("./lib/dashboard-runs");
    const reconciled = reconcileOrphans();
    if (reconciled > 0) {
      console.log(`[runs] reconciled ${reconciled} orphan run(s) → abandoned`);
    }
  } catch (err) {
    console.warn("dashboard-runs reconciliation failed:", err.message);
  }
}

/**
 * Resolve true when a healthy dashboard already answers `/api/health` on
 * `port`. Used by the standalone entry point to avoid starting a SECOND server
 * on the now-shared database — two live servers would each persist the
 * fanned-out hook events and double-count them. Never rejects; any
 * error/timeout (nothing listening, or a non-dashboard process) resolves false.
 */
function probeDashboardHealth(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf)?.status === "ok");
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

if (require.main === module) {
  const PORT = parseInt(process.env.DASHBOARD_PORT || "4820", 10);
  let httpServer = null;

  // Single-server guard: if a healthy dashboard already owns this port, don't
  // start a second one — both would write the fanned-out hook events into the
  // shared database, double-counting them. Point the user at the running
  // instance and exit. (`npm run dev` binds a free fallback port via
  // scripts/dev.js, so this only trips when the conventional port is already
  // serving a healthy dashboard — e.g. the desktop app, or another `npm start`.)
  //
  // Skip the guard under `node --watch` (dev:server): a watch restart briefly
  // races the old process on the same port, and adopting there would wedge
  // hot-reload. Dev already runs its own isolated server by design.
  const isWatchMode = process.execArgv.some((a) => a.startsWith("--watch"));
  probeDashboardHealth(PORT).then((alreadyRunning) => {
    if (alreadyRunning && !isWatchMode) {
      console.log(
        `Code Agent Monitor is already running on http://localhost:${PORT} — not starting a ` +
          `second instance. Open that URL, or stop the other dashboard first.`
      );
      process.exit(0);
      return;
    }
    const app = createApp();
    startServer(app, PORT).then((server) => {
      httpServer = server;
      startBackgroundServices();
    });
  });

  // Graceful shutdown — close connections and DB cleanly
  let shutdownInProgress = false;
  const shutdown = (signal) => {
    if (shutdownInProgress) {
      console.log(`\n${signal} received again — forcing immediate exit.`);
      process.exit(1);
    }
    shutdownInProgress = true;
    console.log(`\n${signal} received — shutting down gracefully… (hit Ctrl+C again to force)`);

    // Drop realtime clients first — open WS sockets otherwise hold the HTTP
    // server open and stall the shutdown until the force-exit backstop fires.
    try {
      require("./websocket").closeWebSocket();
    } catch {
      /* websocket may not be initialised */
    }

    const closeDb = () => {
      try {
        require("./db").db.close();
      } catch {
        /* already closed */
      }
    };

    if (httpServer) {
      // Close the DB only AFTER the HTTP server has fully drained. Closing it
      // while requests are still in flight makes handlers throw "The database
      // connection is not open" (e.g. server/routes/agents.js).
      httpServer.close(() => {
        console.log("HTTP server closed.");
        closeDb();
        process.exit(0);
      });
      // Drop lingering IDLE keep-alive sockets so close() fires promptly (under
      // `node --watch` this turns a multi-second "waiting for graceful
      // termination" stall into a near-instant restart) while letting in-flight
      // requests finish and drain — the whole point of closing the DB in the
      // close() callback. closeAllConnections() would kill in-flight requests
      // too, so use it only as a fallback on runtimes without
      // closeIdleConnections; the 5s backstop below covers a genuinely stuck
      // request either way.
      if (typeof httpServer.closeIdleConnections === "function") {
        httpServer.closeIdleConnections();
      } else if (typeof httpServer.closeAllConnections === "function") {
        httpServer.closeAllConnections();
      }
    } else {
      closeDb();
      process.exit(0);
    }

    // Drop the port discovery file so a later run on a different port is not
    // shadowed by a stale entry. (A crash skips this — the PID-liveness check
    // in resolveDashboardPort() is the backstop for that case.)
    removeServerInfo();
    // Backstop: force exit if something still holds the event loop open. Close
    // the DB here too — if close() never drained (a stuck in-flight request),
    // the callback above never ran, so this is the only path that flushes
    // SQLite before exit (closeDb is idempotent, so a normal drain is fine).
    setTimeout(() => {
      closeDb();
      process.exit(0);
    }, 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Auto-install Claude Code hooks on every startup so users don't have to.
  // Skipped inside containers (issue #193): a container-internal handler path
  // would poison a bind-mounted host ~/.claude and break every host hook, so
  // hooks must be installed on the host (`npm run install-hooks`).
  try {
    const { installHooks, isInsideContainer } = require("../scripts/install-hooks");
    if (installHooks(true)) {
      console.log("Claude Code hooks auto-configured.");
    } else if (isInsideContainer()) {
      console.log(
        "Claude Code hooks NOT auto-configured: running inside a container. " +
          "Run `npm run install-hooks` on the host so hooks point at a host path and " +
          "POST to http://localhost:4820 (this container's published port)."
      );
    }
  } catch {
    // Non-fatal — user can run npm run install-hooks manually
  }

  // Periodic maintenance sweep — abandoned-session cleanup, compaction scanner,
  // and workflow-journal scanner. Extracted to server/lib/maintenance-sweep.js;
  // runs only on this standalone path, not in the embedded desktop shell.
  const { startMaintenanceSweep } = require("./lib/maintenance-sweep");
  const { broadcast } = require("./websocket");
  startMaintenanceSweep({ broadcast });
}

module.exports = {
  createApp,
  startServer,
  startBackgroundServices,
  // Re-exported from lib/codex-session-sync.js so the watcher trigger filter
  // stays directly testable (see server/__tests__/codex-sweep-perf.test.js).
  codexHomeChangeTriggersSweep: require("./lib/codex-session-sync").codexHomeChangeTriggersSweep,
  repairInflatedTokenTotals,
};

/**
 * @file OpenAPI fragments for the Helm Code Config Explorer at
 * `/api/helmcode-config`. The dashboard never writes to Helm Code's own
 * state database; configuration discovery is limited to inspecting the
 * resolved home, the live `server-runtime.json` descriptor, the env
 * override chain, the watcher / poller state, and a snapshot of the
 * projection counts. The only mutation is `POST /resync`, which re-runs
 * the idempotent `ingestHelmcodeSnapshot` pass against the dashboard's
 * own mirror. This mirrors the Codex Config Explorer read-only shape
 * without exposing any text-file edits — Helm Code configuration lives
 * in SQLite which the dashboard treats as read-only.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const tags = [
  {
    name: "HelmcodeConfig",
    description:
      "Read-only Config Explorer for the local Helm Code integration plus a non-destructive Resync trigger. The dashboard never writes to Helm Code's state database; the only mutation re-runs the idempotent ingest pass against the dashboard mirror.",
  },
];

const schemas = {
  HelmcodeConfigOverview: {
    type: "object",
    description:
      "Read-only snapshot of the resolved Helm Code home, the live server runtime descriptor, the env override chain, the sync poll cadence, and the current projection counts.",
    required: [
      "home",
      "userdata_dir",
      "state_db_path",
      "state_db",
      "server_runtime",
      "env",
      "sync",
      "projection_counts",
    ],
    properties: {
      home: {
        type: "string",
        description:
          "Resolved Helm Code home directory (DASHBOARD_HELMCODE_HOME -> HELMCODE_HOME -> ~/.helmcode).",
        example: "/Users/dev/.helmcode",
      },
      userdata_dir: {
        type: "string",
        description:
          "Discovered userdata directory (release builds use <home>/userdata, dev builds use <home>/dev).",
        example: "/Users/dev/.helmcode/userdata",
      },
      state_db_path: {
        type: "string",
        description: "Absolute path to the Helm Code state.sqlite (the read-only mirror source).",
        example: "/Users/dev/.helmcode/userdata/state.sqlite",
      },
      state_db: {
        type: "object",
        required: ["exists"],
        properties: {
          exists: { type: "boolean" },
          size_bytes: { type: "integer", nullable: true },
          mtime: { type: "string", format: "date-time", nullable: true },
        },
      },
      server_runtime: {
        type: "object",
        nullable: true,
        description:
          "Parsed contents of <home>/userdata/server-runtime.json when present, otherwise null.",
        required: ["version", "pid", "host", "port", "origin", "started_at"],
        properties: {
          version: { type: "integer", nullable: true },
          pid: { type: "integer", nullable: true },
          host: { type: "string", nullable: true },
          port: { type: "integer", nullable: true },
          origin: { type: "string", nullable: true },
          started_at: { type: "string", nullable: true },
        },
      },
      env: {
        type: "object",
        description: "Active env override chain (null when the variable is unset).",
        required: ["DASHBOARD_HELMCODE_HOME", "HELMCODE_HOME", "DASHBOARD_HELMCODE_SYNC_MS"],
        properties: {
          DASHBOARD_HELMCODE_HOME: { type: "string", nullable: true },
          HELMCODE_HOME: { type: "string", nullable: true },
          DASHBOARD_HELMCODE_SYNC_MS: { type: "integer", nullable: true },
        },
      },
      sync: {
        type: "object",
        required: ["poll_ms"],
        properties: {
          poll_ms: {
            type: "integer",
            description: "Active safety-net poll interval in milliseconds (0 disables polling).",
            example: 4000,
          },
        },
      },
      projection_counts: {
        type: "object",
        nullable: true,
        description: "Live counts from projection_* tables; null when the state DB is unreadable.",
        required: ["projects", "threads", "archived", "deleted", "messages", "activities", "turns"],
        properties: {
          projects: { type: "integer" },
          threads: { type: "integer" },
          archived: { type: "integer" },
          deleted: { type: "integer" },
          messages: { type: "integer" },
          activities: { type: "integer" },
          turns: { type: "integer" },
        },
      },
    },
  },
  HelmcodeConfigResyncResult: {
    type: "object",
    required: ["ok", "summary"],
    properties: {
      ok: { type: "boolean", example: true },
      summary: {
        type: "object",
        required: ["scanned", "changed", "created", "removed"],
        properties: {
          scanned: { type: "integer" },
          changed: { type: "integer" },
          created: { type: "integer" },
          removed: { type: "integer" },
        },
      },
    },
  },
};

const paths = {
  "/api/helmcode-config/overview": {
    get: {
      tags: ["HelmcodeConfig"],
      summary: "Read the Helm Code Config Explorer overview",
      description:
        "Returns the resolved Helm Code home, the live server-runtime descriptor, the env override chain, the sync poll cadence, and the current projection counts. The endpoint is read-only and never modifies Helm Code's state database; it fails gracefully (projection_counts: null) when the state DB is absent or unreadable.",
      operationId: "helmcodeConfigOverview",
      responses: {
        200: {
          description: "Read-only Helm Code configuration overview.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/HelmcodeConfigOverview" } },
          },
        },
      },
    },
  },
  "/api/helmcode-config/resync": {
    post: {
      tags: ["HelmcodeConfig"],
      summary: "Re-run the Helm Code ingest pass now",
      description:
        'Re-runs `ingestHelmcodeSnapshot` against the dashboard\'s own mirror. Helm Code itself is not modified. Requires the body `{ "confirmed": true }` so a stray UI event cannot trigger a sweep. The pass is idempotent and safe to repeat.',
      operationId: "helmcodeConfigResync",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["confirmed"],
              properties: { confirmed: { type: "boolean", example: true } },
            },
          },
        },
      },
      responses: {
        200: {
          description: "The resync pass completed.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HelmcodeConfigResyncResult" },
            },
          },
        },
        400: {
          description: "ENOTCONFIRMED — the request body did not include confirmed: true.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
          },
        },
      },
    },
  },
};

module.exports = { tags, schemas, paths };

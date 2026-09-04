/**
 * @file OpenAPI fragments for the T3 Config Explorer at `/api/t3-config`.
 * T3 is a Helm Code fork, so this mirrors the Helm Code Config Explorer
 * read-only shape: the dashboard never writes to T3's own state database; the
 * only mutation is `POST /resync`, which re-runs the idempotent
 * `ingestT3Snapshot` pass against the dashboard's own mirror.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const tags = [
  {
    name: "T3Config",
    description:
      "Read-only Config Explorer for the local T3 integration plus a non-destructive Resync trigger. The dashboard never writes to T3's state database; the only mutation re-runs the idempotent ingest pass against the dashboard mirror.",
  },
];

const schemas = {
  T3ConfigOverview: {
    type: "object",
    description:
      "Read-only snapshot of the resolved T3 home, the live server runtime descriptor, the env override chain, the sync poll cadence, and the current projection counts.",
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
        description: "Resolved T3 home directory (DASHBOARD_T3_HOME -> T3_HOME -> ~/.t3).",
        example: "/Users/dev/.t3",
      },
      userdata_dir: {
        type: "string",
        description:
          "Discovered userdata directory (release builds use <home>/userdata, dev builds use <home>/dev).",
        example: "/Users/dev/.t3/userdata",
      },
      state_db_path: {
        type: "string",
        description: "Absolute path to the T3 state.sqlite (the read-only mirror source).",
        example: "/Users/dev/.t3/userdata/state.sqlite",
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
        required: ["DASHBOARD_T3_HOME", "T3_HOME", "DASHBOARD_T3_SYNC_MS"],
        properties: {
          DASHBOARD_T3_HOME: { type: "string", nullable: true },
          T3_HOME: { type: "string", nullable: true },
          DASHBOARD_T3_SYNC_MS: { type: "integer", nullable: true },
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
  T3ConfigResyncResult: {
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
  "/api/t3-config/overview": {
    get: {
      tags: ["T3Config"],
      summary: "Read the T3 Config Explorer overview",
      description:
        "Returns the resolved T3 home, the live server-runtime descriptor, the env override chain, the sync poll cadence, and the current projection counts. The endpoint is read-only and never modifies T3's state database; it fails gracefully (projection_counts: null) when the state DB is absent or unreadable.",
      operationId: "t3ConfigOverview",
      responses: {
        200: {
          description: "Read-only T3 configuration overview.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/T3ConfigOverview" } },
          },
        },
      },
    },
  },
  "/api/t3-config/resync": {
    post: {
      tags: ["T3Config"],
      summary: "Re-run the T3 ingest pass now",
      description:
        'Re-runs `ingestT3Snapshot` against the dashboard\'s own mirror. T3 itself is not modified. Requires the body `{ "confirmed": true }` so a stray UI event cannot trigger a sweep. The pass is idempotent and safe to repeat.',
      operationId: "t3ConfigResync",
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
              schema: { $ref: "#/components/schemas/T3ConfigResyncResult" },
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

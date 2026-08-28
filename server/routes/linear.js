/**
 * @file Express router for Linear ticket linking — the dashboard's read-only
 * integration with Linear (see server/lib/linear-client.js). Scoped to Linear
 * only; no Jira or GitHub Issues support.
 *
 *   GET    /api/linear/config              — whether an API key is configured
 *   PUT    /api/linear/config               — set the API key
 *   DELETE /api/linear/config               — clear the API key
 *   GET    /api/linear/sessions/:id/link    — the session's linked issue, if any
 *   POST   /api/linear/sessions/:id/link    — link a session to an issue, by
 *                                              pasted URL ({url}) or by
 *                                              auto-detecting the session's git
 *                                              branch ({auto: true})
 *   DELETE /api/linear/sessions/:id/link    — unlink
 *
 * The API key itself lives in a file (server/lib/linear-config.js), never in
 * SQLite; only the resolved issue snapshot (title/state/url) is persisted, in
 * `linear_links`.
 *
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { Router } = require("express");
const { execFile } = require("child_process");
const { stmts } = require("../db");
const linearConfig = require("../lib/linear-config");
const {
  parseIdentifierFromUrl,
  parseIdentifierFromBranch,
  fetchIssueByIdentifier,
  LinearApiError,
} = require("../lib/linear-client");

const router = Router();

router.get("/config", (req, res) => {
  res.json({ configured: linearConfig.isConfigured() });
});

router.put("/config", (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey) {
    return res.status(400).json({ error: { message: "apiKey is required" } });
  }
  linearConfig.setApiKey(apiKey);
  res.json({ configured: true });
});

router.delete("/config", (req, res) => {
  linearConfig.clearApiKey();
  res.json({ configured: false });
});

router.get("/sessions/:id/link", (req, res) => {
  const link = stmts.getLinearLink.get(req.params.id);
  res.json({ link: link || null });
});

/** Best-effort: reads the current branch of the session's working directory.
 *  Returns null on any failure (not a git repo, dir gone, git missing) — the
 *  caller treats that as "auto-detect found nothing" rather than an error. */
function currentBranch(cwd) {
  return new Promise((resolve) => {
    if (!cwd) return resolve(null);
    execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, timeout: 3000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const branch = stdout.trim();
        resolve(branch && branch !== "HEAD" ? branch : null);
      }
    );
  });
}

router.post("/sessions/:id/link", async (req, res) => {
  const session = stmts.getSession.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: { message: "Session not found" } });
  }
  if (!linearConfig.isConfigured()) {
    return res.status(400).json({ error: { message: "Linear API key is not configured" } });
  }

  let identifier = null;
  let source = "url";
  if (typeof req.body?.url === "string" && req.body.url.trim()) {
    identifier = parseIdentifierFromUrl(req.body.url);
    if (!identifier) {
      return res
        .status(400)
        .json({ error: { message: "That doesn't look like a Linear issue URL" } });
    }
  } else if (req.body?.auto) {
    source = "branch";
    const branch = await currentBranch(session.cwd);
    identifier = branch ? parseIdentifierFromBranch(branch) : null;
    if (!identifier) {
      return res.status(404).json({
        error: { message: "Could not detect a Linear issue identifier from the git branch" },
      });
    }
  } else {
    return res.status(400).json({ error: { message: "Provide either url or auto: true" } });
  }

  try {
    const issue = await fetchIssueByIdentifier(linearConfig.getApiKey(), identifier);
    if (!issue) {
      return res.status(404).json({ error: { message: `Linear issue ${identifier} not found` } });
    }
    stmts.upsertLinearLink.run(
      session.id,
      issue.id,
      issue.identifier,
      issue.title,
      issue.url,
      issue.state,
      source
    );
    const link = stmts.getLinearLink.get(session.id);
    res.json({ link });
  } catch (err) {
    if (err instanceof LinearApiError) {
      return res.status(err.status || 502).json({ error: { message: err.message } });
    }
    res.status(502).json({ error: { message: err.message || "Linear lookup failed" } });
  }
});

router.delete("/sessions/:id/link", (req, res) => {
  stmts.deleteLinearLink.run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

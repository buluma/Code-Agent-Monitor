/**
 * @file Minimal read-only Linear client: parses a Linear issue identifier out
 * of a pasted issue URL or a git branch name, then resolves it to
 * title/state/url via Linear's GraphQL API. Used to link a dashboard session
 * to a Linear issue (server/routes/linear.js) — nothing here writes to
 * Linear, so a leaked/misconfigured API key can only read.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

// Linear issue identifiers are TEAMKEY-NUMBER, e.g. "ENG-123" or "DASH-42".
// Team keys are 2-10 uppercase letters/digits by Linear's own convention.
const IDENTIFIER_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/i;

/**
 * Extracts a Linear issue identifier from a pasted URL, e.g.
 * `https://linear.app/acme/issue/ENG-123/fix-the-thing` -> `"ENG-123"`.
 * Returns null if the URL doesn't look like a Linear issue link.
 */
function parseIdentifierFromUrl(input) {
  if (typeof input !== "string" || !input.trim()) return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)linear\.app$/i.test(url.hostname)) return null;
  const match = url.pathname.match(IDENTIFIER_RE);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extracts a Linear issue identifier from a git branch name, e.g.
 * `"buluma/eng-123-fix-the-thing"` -> `"ENG-123"`. Best-effort: branch naming
 * is a convention, not a contract, so this is a heuristic match, not a guarantee.
 */
function parseIdentifierFromBranch(branch) {
  if (typeof branch !== "string" || !branch.trim()) return null;
  const match = branch.toUpperCase().match(IDENTIFIER_RE);
  return match ? match[1] : null;
}

class LinearApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "LinearApiError";
    this.status = status;
  }
}

/**
 * Resolves an issue identifier (e.g. "ENG-123") to its title/state/url via
 * Linear's GraphQL API. Throws {@link LinearApiError} on an auth failure or
 * unexpected response shape; returns null if the identifier doesn't exist.
 */
async function fetchIssueByIdentifier(apiKey, identifier) {
  if (!apiKey) throw new LinearApiError("Linear API key is not configured", 401);
  const query = `
    query IssueByIdentifier($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        url
        state { name }
      }
    }
  `;
  let res;
  try {
    res = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables: { id: identifier } }),
    });
  } catch (err) {
    throw new LinearApiError(`Could not reach Linear: ${err.message}`, 502);
  }
  if (res.status === 401 || res.status === 403) {
    throw new LinearApiError("Linear rejected the configured API key", res.status);
  }
  if (!res.ok) {
    throw new LinearApiError(`Linear API returned HTTP ${res.status}`, res.status);
  }
  const body = await res.json();
  if (body.errors?.length) {
    throw new LinearApiError(body.errors[0].message || "Linear API error", 502);
  }
  const issue = body.data?.issue;
  if (!issue) return null;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    state: issue.state?.name || null,
  };
}

module.exports = {
  parseIdentifierFromUrl,
  parseIdentifierFromBranch,
  fetchIssueByIdentifier,
  LinearApiError,
};

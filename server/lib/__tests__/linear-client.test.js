/**
 * @file Unit tests for the Linear client's URL/branch identifier parsing and
 * its GraphQL issue-fetch error handling. `fetchIssueByIdentifier` is tested
 * against a stubbed `global.fetch` so no network access is required.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseIdentifierFromUrl,
  parseIdentifierFromBranch,
  fetchIssueByIdentifier,
  LinearApiError,
} = require("../linear-client");

describe("parseIdentifierFromUrl", () => {
  it("extracts the identifier from a standard issue URL", () => {
    assert.equal(
      parseIdentifierFromUrl("https://linear.app/acme/issue/ENG-123/fix-the-thing"),
      "ENG-123"
    );
  });

  it("is case-insensitive and normalizes to uppercase", () => {
    assert.equal(parseIdentifierFromUrl("https://linear.app/acme/issue/eng-42/x"), "ENG-42");
  });

  it("returns null for a non-Linear URL", () => {
    assert.equal(parseIdentifierFromUrl("https://github.com/acme/repo/issues/1"), null);
  });

  it("returns null for garbage input", () => {
    assert.equal(parseIdentifierFromUrl("not a url"), null);
    assert.equal(parseIdentifierFromUrl(""), null);
    assert.equal(parseIdentifierFromUrl(undefined), null);
  });
});

describe("parseIdentifierFromBranch", () => {
  it("extracts the identifier from a prefixed branch name", () => {
    assert.equal(parseIdentifierFromBranch("buluma/eng-123-fix-the-thing"), "ENG-123");
  });

  it("extracts from a bare branch name", () => {
    assert.equal(parseIdentifierFromBranch("dash-42-add-command-palette"), "DASH-42");
  });

  it("returns null when no identifier pattern is present", () => {
    assert.equal(parseIdentifierFromBranch("main"), null);
    assert.equal(parseIdentifierFromBranch("feature/refactor-widgets"), null);
    assert.equal(parseIdentifierFromBranch(""), null);
  });
});

describe("fetchIssueByIdentifier", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws when no API key is provided", async () => {
    await assert.rejects(() => fetchIssueByIdentifier(null, "ENG-1"), LinearApiError);
  });

  it("returns the resolved issue on success", async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          issue: {
            id: "abc123",
            identifier: "ENG-1",
            title: "Fix the thing",
            url: "https://linear.app/acme/issue/ENG-1/fix-the-thing",
            state: { name: "In Progress" },
          },
        },
      }),
    });
    const issue = await fetchIssueByIdentifier("fake-key", "ENG-1");
    assert.deepEqual(issue, {
      id: "abc123",
      identifier: "ENG-1",
      title: "Fix the thing",
      url: "https://linear.app/acme/issue/ENG-1/fix-the-thing",
      state: "In Progress",
    });
  });

  it("returns null when the issue doesn't exist", async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { issue: null } }),
    });
    const issue = await fetchIssueByIdentifier("fake-key", "ENG-999");
    assert.equal(issue, null);
  });

  it("throws LinearApiError on a 401", async () => {
    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await assert.rejects(
      () => fetchIssueByIdentifier("bad-key", "ENG-1"),
      (err) => {
        assert.ok(err instanceof LinearApiError);
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it("throws LinearApiError when fetch itself fails", async () => {
    global.fetch = async () => {
      throw new Error("network down");
    };
    await assert.rejects(() => fetchIssueByIdentifier("fake-key", "ENG-1"), LinearApiError);
  });
});

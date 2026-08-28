/**
 * @file Verifies Helm Code's best-effort cost attribution: reading and
 * flattening `usage-model-rates.json`, resolving a thread's model id through
 * Helm Code's region/provider routing aliases, mtime-based rate-file caching,
 * and costing token buckets against the resolved rates.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-helmcode-pricing-"));
process.env.DASHBOARD_HELMCODE_HOME = TMP;

const {
  loadHelmcodeModelRates,
  resolveHelmcodeModelRate,
  calculateHelmcodeCost,
} = require("../lib/helmcode-pricing");

function ratesFilePath() {
  return path.join(TMP, "userdata", "usage-model-rates.json");
}

function writeRates(document) {
  const filePath = ratesFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ fetchedAtMs: Date.now(), document }));
}

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("Helm Code pricing", () => {
  beforeEach(() => {
    fs.rmSync(ratesFilePath(), { force: true });
  });

  it("returns null when the rate file has not been fetched yet", () => {
    assert.equal(loadHelmcodeModelRates(), null);
  });

  it("ignores non-chat entries with no input/output cost", () => {
    writeRates({
      "1024-x-1024/dall-e-2": { mode: "image_generation", input_cost_per_token: 0 },
      "claude-sonnet-5": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 },
    });
    const rates = loadHelmcodeModelRates();
    assert.equal(rates.has("1024-x-1024/dall-e-2"), false);
    assert.deepEqual(rates.get("claude-sonnet-5"), { input: 2e-6, output: 1e-5 });
  });

  it("resolves an exact model id before trying any prefix", () => {
    writeRates({ "claude-sonnet-5": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 } });
    const rates = loadHelmcodeModelRates();
    assert.deepEqual(resolveHelmcodeModelRate(rates, "claude-sonnet-5"), {
      input: 2e-6,
      output: 1e-5,
    });
  });

  it("resolves a region/provider-routed model id by stripping the known prefix", () => {
    writeRates({ "claude-sonnet-5": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 } });
    const rates = loadHelmcodeModelRates();
    assert.deepEqual(resolveHelmcodeModelRate(rates, "us.anthropic.claude-sonnet-5"), {
      input: 2e-6,
      output: 1e-5,
    });
    assert.deepEqual(resolveHelmcodeModelRate(rates, "vertex_ai/claude-sonnet-5"), {
      input: 2e-6,
      output: 1e-5,
    });
  });

  it("returns null for a model with no matching entry under any known prefix", () => {
    writeRates({ "claude-sonnet-5": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 } });
    const rates = loadHelmcodeModelRates();
    assert.equal(resolveHelmcodeModelRate(rates, "some-unknown-model"), null);
  });

  it("re-reads the file once its mtime changes", () => {
    writeRates({ "claude-sonnet-5": { input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 } });
    const first = loadHelmcodeModelRates();
    assert.deepEqual(first.get("claude-sonnet-5"), { input: 1e-6, output: 1e-6 });

    // Force a distinct mtime — same-millisecond writes could otherwise hide the change.
    fs.utimesSync(ratesFilePath(), new Date(Date.now() + 2000), new Date(Date.now() + 2000));
    writeRates({ "claude-sonnet-5": { input_cost_per_token: 5e-6, output_cost_per_token: 5e-6 } });
    fs.utimesSync(ratesFilePath(), new Date(Date.now() + 4000), new Date(Date.now() + 4000));

    const second = loadHelmcodeModelRates();
    assert.deepEqual(second.get("claude-sonnet-5"), { input: 5e-6, output: 5e-6 });
  });

  it("costs a priced bucket and leaves an unpriced one at zero with a reason", () => {
    writeRates({ "claude-sonnet-5": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 } });
    const result = calculateHelmcodeCost([
      { model: "claude-sonnet-5", input_tokens: 1_000_000, output_tokens: 500_000 },
      { model: "some-unknown-model", input_tokens: 100, output_tokens: 50 },
    ]);
    // 1,000,000 * 2e-6 + 500,000 * 1e-5 = 2 + 5 = 7
    assert.equal(result.total_cost, 7);
    assert.equal(result.breakdown.length, 1);
    assert.equal(result.breakdown[0].provider, "helmcode");
    assert.equal(result.breakdown[0].cost, 7);
    assert.equal(result.unpriced_models.length, 1);
    assert.equal(result.unpriced_models[0].model, "some-unknown-model");
    assert.match(result.unpriced_models[0].reason, /No Helm Code rate entry/);
  });

  it("marks every bucket unpriced with a distinct reason when the rate file itself is missing", () => {
    const result = calculateHelmcodeCost([
      { model: "claude-sonnet-5", input_tokens: 100, output_tokens: 50 },
    ]);
    assert.equal(result.total_cost, 0);
    assert.equal(result.breakdown.length, 0);
    assert.match(result.unpriced_models[0].reason, /has not fetched/);
  });

  it("returns zero cost for an empty row set", () => {
    const result = calculateHelmcodeCost([]);
    assert.equal(result.total_cost, 0);
    assert.deepEqual(result.breakdown, []);
    assert.deepEqual(result.unpriced_models, []);
  });
});

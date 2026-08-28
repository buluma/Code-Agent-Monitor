/**
 * @file Best-effort cost attribution for Helm Code sessions. Helm Code can run
 * any model any provider it wraps supports (Claude, GPT, and others), so unlike
 * Claude/Codex — which price against the dashboard's own curated
 * `model_pricing`/`gpt_model_pricing` tables — Helm Code sessions price against
 * Helm Code's OWN bundled litellm rate table (`usage-model-rates.json`), read
 * directly rather than duplicated into a table this dashboard would have to
 * maintain for every model Helm Code might launch. Every Helm Code read here
 * degrades to "unpriced" rather than throwing: the file is optional, refreshed
 * by Helm Code on its own schedule, and its schema is outside this project's
 * control.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const fs = require("fs");
const { getHelmcodeUsageModelRatesPath } = require("./helmcode-home");

const round4 = (n) => Math.round(n * 10000) / 10000;

// Prefixes litellm/Helm Code route model ids through (region + provider
// aliasing) that don't change the underlying rate. Tried longest-first so a
// more specific prefix (e.g. "us-gov.anthropic.") is stripped before a looser
// one ("anthropic.") would otherwise short-circuit the match.
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

let cache = null; // { mtimeMs, path, rates: Map<string, {input, output}> }

/**
 * Reads and flattens `usage-model-rates.json`'s `document` map into
 * `{input_cost_per_token, output_cost_per_token}` pairs, cached by the file's
 * mtime so a live refresh (Helm Code re-fetches this periodically) is picked
 * up without re-parsing a multi-MB file on every ingest sweep.
 */
function loadHelmcodeModelRates() {
  const ratesPath = getHelmcodeUsageModelRatesPath();
  let stat;
  try {
    stat = fs.statSync(ratesPath);
  } catch {
    return null; // Helm Code hasn't fetched rates yet, or isn't installed.
  }
  if (cache && cache.path === ratesPath && cache.mtimeMs === stat.mtimeMs) {
    return cache.rates;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(ratesPath, "utf8"));
  } catch {
    return null; // Malformed/partially-written file; retry next sweep.
  }
  const document = parsed && typeof parsed === "object" ? parsed.document : null;
  if (!document || typeof document !== "object") return null;

  const rates = new Map();
  for (const [modelId, entry] of Object.entries(document)) {
    if (!entry || typeof entry !== "object") continue;
    const input = Number(entry.input_cost_per_token) || 0;
    const output = Number(entry.output_cost_per_token) || 0;
    if (input <= 0 && output <= 0) continue; // Not a priced chat-completion model.
    rates.set(modelId, { input, output });
  }
  cache = { mtimeMs: stat.mtimeMs, path: ratesPath, rates };
  return rates;
}

/**
 * Resolves a Helm Code thread's model id to a rate, trying the exact id first
 * and then progressively stripping known region/provider routing prefixes —
 * Helm Code's rate table keys the same model under many aliases
 * (`claude-sonnet-5`, `anthropic.claude-sonnet-5`, `us.anthropic.claude-sonnet-5`, ...).
 */
function resolveHelmcodeModelRate(rates, model) {
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

/**
 * Costs a set of Helm Code token buckets against Helm Code's own rate table.
 * Mirrors `calculateGptCost`'s return shape (`server/routes/pricing.js`) so
 * callers can merge Claude/Codex/Helm Code totals uniformly. Helm Code only
 * exposes cumulative input/output token snapshots (see `helmcode-ingest.js`),
 * so cache-read/write and server-tool costs are always 0 here — best-effort,
 * not exact.
 */
function calculateHelmcodeCost(tokenRows) {
  const rates = loadHelmcodeModelRates();
  const breakdownMap = new Map();
  const unpriced = new Map();
  let total = 0;

  for (const row of tokenRows || []) {
    const rate = resolveHelmcodeModelRate(rates, row.model);
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
          ? "No Helm Code rate entry matches this model"
          : "Helm Code has not fetched usage-model-rates.json yet",
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
      provider: "helmcode",
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

module.exports = {
  loadHelmcodeModelRates,
  resolveHelmcodeModelRate,
  calculateHelmcodeCost,
};

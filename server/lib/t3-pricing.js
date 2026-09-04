/**
 * @file Best-effort cost attribution for T3 sessions. T3 is a fork of Helm
 * Code and prices against its own bundled litellm rate table,
 * `usage-model-rates.json`, read directly rather than duplicated. This module
 * reuses the generic thread-provider pricing engine bound to the T3 config.
 * Every T3 read here degrades to "unpriced" rather than throwing.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { engine } = require("./t3-home");

module.exports = {
  loadT3ModelRates: engine.loadModelRates,
  resolveT3ModelRate: engine.resolveModelRate,
  calculateT3Cost: engine.calculateCost,
};

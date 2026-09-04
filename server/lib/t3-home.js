/**
 * @file T3 home resolution, mirroring Helm Code's. T3 is a fork of Helm Code
 * with an identical `state.sqlite` projection layout under `~/.t3/userdata`
 * (release) or `~/.t3/dev` (dev builds). It reuses the generic thread-provider
 * engine with a T3 config; this module is the thin public surface the rest of
 * the dashboard imports.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { createThreadProvider } = require("./thread-provider");

const T3_CONFIG = {
  provider: "t3",
  displayName: "T3",
  homeEnvKey: "DASHBOARD_T3_HOME",
  fallbackHomeEnvKey: "T3_HOME",
  defaultHome: ".t3",
  syncIntervalEnvKey: "DASHBOARD_T3_SYNC_MS",
};

const engine = createThreadProvider(T3_CONFIG);

module.exports = {
  config: T3_CONFIG,
  getT3Home: engine.getHome,
  getT3UserDataDir: engine.getUserDataDir,
  getT3StateDbPath: engine.getStateDbPath,
  getT3ServerRuntime: engine.getServerRuntime,
  getT3UsageModelRatesPath: engine.getUsageModelRatesPath,
  onT3HomeChanged: engine.onHomeChanged,
  setT3Home: engine.setHome,
};

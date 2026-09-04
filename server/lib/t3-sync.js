/**
 * @file Keep T3's `~/.t3/userdata/state.sqlite` projection in sync. T3 is a
 * read-only, thread-based provider (a Helm Code fork) whose own server
 * persists durable orchestration events; this pipeline mirrors those
 * projections into dashboard rows instead of relying on script-instrumented
 * hooks. Every sweep is cursor-gated and dedupe-keyed, so an unchanged state
 * DB performs no writes and emits no websocket frames. Unref'd so it never
 * blocks shutdown.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { createThreadProvider } = require("./thread-provider");
const { config: T3_CONFIG } = require("./t3-home");

const engine = createThreadProvider(T3_CONFIG);

module.exports = { startT3Sync: engine.startSync };

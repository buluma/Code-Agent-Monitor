/**
 * @file Shared single-flight sweep coalescer, factored out of the sync-loop
 * duplication across session-sync.js, codex-session-sync.js, helmcode-sync.js,
 * and remote-source-sync.js. Turns any async sweep function into a `run()`
 * trigger safe to call from multiple event sources (timers, watchers,
 * startup) without ever running two sweeps concurrently: a trigger that
 * arrives mid-sweep sets a `queued` flag instead of starting a second sweep,
 * and the in-flight sweep re-runs itself exactly once more when it finishes.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

function makeCoalescedRunner(sweepFn) {
  let running = false;
  let queued = false;

  async function run() {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      // Consume the queued rerun inline, under the same `running = true`
      // window, instead of clearing `running` and rescheduling via
      // setImmediate — that left a gap where a trigger arriving between the
      // sweep finishing and the deferred rerun starting saw `running: false`
      // and kicked off its own concurrent sweep, doubling the filesystem/DB
      // work the coalescer exists to prevent.
      do {
        queued = false;
        await sweepFn();
      } while (queued);
    } finally {
      running = false;
    }
  }

  return run;
}

module.exports = { makeCoalescedRunner };

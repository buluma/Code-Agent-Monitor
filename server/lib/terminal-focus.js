/**
 * @file Best-effort "raise the terminal running this session" for live
 * sessions. macOS-only (Ghostty and iTerm2); a no-op everywhere else.
 *
 * There is no pid tracked per session, so this matches by working directory.
 * iTerm2 exposes a scriptable `tty` property per session, so that path finds
 * the exact process tree via lsof/ps and matches on cwd. Ghostty has no rich
 * AppleScript dictionary (no per-tab tty/cwd introspection), so its path goes
 * through System Events/accessibility instead: it reads each window's title
 * (Ghostty's title bar shows the running command and, often, the leaf
 * directory name) and matches the session's cwd basename against it — a
 * weaker heuristic than the iTerm2 path, but the best available without a
 * scriptable API.
 *
 * Never throws — every failure mode (no match, AppleScript denied, app not
 * running) resolves to `{focused: false}` so the caller can render a friendly
 * "couldn't find it" instead of an error.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { execFile } = require("child_process");
const os = require("os");
const path = require("path");

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000, ...opts }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

/** cwd of a single pid, or null if it can't be determined (process gone,
 *  permission denied, unsupported platform). */
async function cwdOfPid(pid) {
  const out = await run("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"]);
  if (!out) return null;
  const line = out.split("\n").find((l) => l.startsWith("n"));
  return line ? line.slice(1) : null;
}

/** pids of the process group attached to a tty (e.g. "ttys003"). */
async function pidsForTty(tty) {
  const short = tty.replace(/^\/dev\//, "");
  const out = await run("ps", ["-t", short, "-o", "pid="]);
  if (!out) return [];
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(Number);
}

/** Whether any process attached to `tty` has `cwd` (or a subdirectory of it)
 *  as its current working directory. */
async function ttyMatchesCwd(tty, cwd) {
  const pids = await pidsForTty(tty);
  for (const pid of pids) {
    const pidCwd = await cwdOfPid(pid);
    if (pidCwd && (pidCwd === cwd || pidCwd.startsWith(`${cwd}/`))) return true;
  }
  return false;
}

/** Finds the index (1-based, AppleScript-style) of the first Ghostty window
 *  whose title mentions the session's working directory, or null. Ghostty has
 *  no per-window cwd/tty introspection, so this is a title-substring match on
 *  the directory's basename rather than an exact process match. */
async function findGhosttyWindowForCwd(cwd) {
  const script = `
    tell application "System Events"
      if not (exists process "Ghostty") then return ""
      tell process "Ghostty"
        set titleList to {}
        repeat with w in windows
          try
            copy (name of w) to end of titleList
          on error
            copy "" to end of titleList
          end try
        end repeat
        return titleList
      end tell
    end tell
  `;
  const out = await run("osascript", ["-e", script]);
  if (!out) return null;
  const titles = out.split(",").map((s) => s.trim());
  const needle = path.basename(cwd).toLowerCase();
  if (!needle) return null;
  for (let i = 0; i < titles.length; i++) {
    if (titles[i].toLowerCase().includes(needle)) return i + 1; // AppleScript windows are 1-indexed.
  }
  return null;
}

/** Raises the Ghostty window at the given 1-based index via the accessibility
 *  API (Ghostty has no AppleScript "activate this window" verb of its own). */
async function raiseGhosttyWindow(index) {
  await run("osascript", [
    "-e",
    `tell application "Ghostty" to activate
     tell application "System Events"
       tell process "Ghostty"
         set frontWindow to window ${index}
         perform action "AXRaise" of frontWindow
       end tell
     end tell`,
  ]);
}

/** Finds the tty of the first iTerm2 session matching `cwd`, or null. iTerm2's
 *  AppleScript dictionary has no bulk "tty of every tab" shortcut, so this
 *  walks window/tab/session directly. `probe === null` means iTerm2 isn't
 *  running or isn't scriptable, distinct from "ran but found no match". */
async function findITermTtyForCwd(cwd) {
  const listScript = `
    tell application "iTerm2"
      set ttyList to {}
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            try
              copy (tty of s) to end of ttyList
            end try
          end repeat
        end repeat
      end repeat
      return ttyList
    end tell
  `;
  const out = await run("osascript", ["-e", listScript]);
  if (out === null) return null;
  const ttys = out
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const tty of ttys) {
    if (await ttyMatchesCwd(tty, cwd)) return tty;
  }
  return null;
}

/** Raises the iTerm2 window/tab whose session has the given tty. */
async function raiseITermTab(tty) {
  await run("osascript", [
    "-e",
    `tell application "iTerm2"
       repeat with w in windows
         repeat with t in tabs of w
           repeat with s in sessions of t
             try
               if (tty of s) is "${tty}" then
                 select t
                 set frontmost of w to true
                 activate
                 return
               end if
             end try
           end repeat
         end repeat
       end repeat
     end tell`,
  ]);
}

/**
 * Attempts to raise the terminal window/tab running the given session's
 * process. Returns `{focused: boolean, app: string|null, reason?: string}` —
 * never throws.
 */
async function focusTerminalForSession(session) {
  if (os.platform() !== "darwin") {
    return { focused: false, app: null, reason: "unsupported_platform" };
  }
  const cwd = session?.cwd;
  if (!cwd) {
    return { focused: false, app: null, reason: "no_cwd" };
  }

  try {
    const index = await findGhosttyWindowForCwd(cwd);
    if (index) {
      await raiseGhosttyWindow(index);
      return { focused: true, app: "Ghostty" };
    }
  } catch {
    // Ghostty not running/scriptable — fall through to iTerm2.
  }

  try {
    const tty = await findITermTtyForCwd(cwd);
    if (tty) {
      await raiseITermTab(tty);
      return { focused: true, app: "iTerm2" };
    }
  } catch {
    // no scriptable terminal found a match — fall through to "not found"
  }

  return { focused: false, app: null, reason: "no_matching_window" };
}

module.exports = { focusTerminalForSession };

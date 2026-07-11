/**
 * Automated screenshot + window-state validation probe.
 *
 * Re-validates the editor/runtime screenshot remediation contract that the
 * 41o-duodecies interactive session had to drive by hand (E1/E4/E5/E6 on the
 * editor viewport; R1–R4 on the running-game window). Where that session needed
 * a human to minimize/unfocus windows on cue, this probe drives window state
 * **programmatically** through a PowerShell/user32.dll helper
 * ({@link ./window-control.ps1}) and asserts the structured tool responses
 * empirically.
 *
 * @remarks
 * It reuses the smoke harness's proven driver: {@link createBridge} for the WS
 * connection (editor channel + lazy runtime channel), {@link discoverProjectPath}
 * for registry-based port/token discovery, and {@link probePort}/{@link printUnreachable}
 * for the graceful editor-down skip. The bridge's `callRuntime` reaches the game
 * runtime directly, so the probe sees the RAW toolkit payload (width/height/bytes/
 * `remediation`/`hint`/`code`) rather than the server's MCP-shaped multi-content.
 *
 * **The embed-aware matrix (reconciled expectations).** On Godot 4.4+ a playtest
 * launched with embedding on (the desktop default) is an owner-linked top-level
 * popup that keeps compositing and never reports MINIMIZED, so backgrounding it
 * (by minimizing the *editor*) still yields a fresh frame and `force_foreground_game`
 * is a truthful no-op (embedded hint, no `foregrounded_game`). A *floating* game
 * (embed off / 4.2–4.3 / macOS) genuinely suspends on minimize and the foreground
 * lever really raises it. The probe reads which case applies from the game
 * window's owner (an embedded game is an owner-linked popup; a floating game is a
 * plain top-level) — not `execute_code`, whose sandbox blocks the `Engine`
 * singleton — and asserts the matching expectations. Embed mode is an
 * **editor-only** setting (not a `project.godot` key), so the floating-game legs
 * can't be forced from a WS-driven probe — they
 * run only under `MCP_MANUAL_ASSIST=1` (human sets Game → Embed off before launch)
 * and green-skip otherwise, exactly like the smoke suite's manual-assist legs.
 *
 * Windows-only (the window-control helper is user32.dll); green-skips on other
 * platforms. Standalone — prints its own pass/fail report to stdout and exits
 * non-zero on a real FAIL (0 on all-pass/skip, 2 on editor unreachable).
 *
 * Run: `npm run probe:screenshot` (optionally `MCP_MANUAL_ASSIST=1` for the
 * floating-game legs). It does NOT launch Godot — the editor must already be
 * running with the toolkit plugin active.
 *
 * @module
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

import { createBridge } from "../src/transport/bridge.js";
import { lookupProject } from "../src/registry.js";
import { BridgeError } from "../src/shared/errors.js";

import {
  HOST,
  PORT,
  RUNTIME_PORT,
  PROBE_TIMEOUT_MS,
  SCREENSHOT_TIMEOUT,
  CALL_TIMEOUT,
  MANUAL_ASSIST,
  probePort,
  printUnreachable,
  manualCue,
  callRetryOnTimeout,
} from "./helpers.js";
import { discoverProjectPath } from "./harness.js";

// ── Constants ────────────────────────────────────────────────────────────

/** Minimum pixel dimension for a frame to count as a usable capture (a
 *  collapsed/2x2 viewport is the failure this whole contract guards against). */
const USABLE_MIN_DIM = 100;
/** Minimum base64 length for a usable PNG — a ~81-byte collapsed frame is far
 *  below this; a real KB-scale capture clears it easily. */
const USABLE_MIN_BASE64 = 500;
/** How long to let a freshly restored/backgrounded window settle before the
 *  editor re-renders and the capture reflects the new state. */
const WINDOW_SETTLE_MS = 1200;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const WINDOW_CONTROL_PS1 = join(scriptDir, "window-control.ps1");

// ── Result model ─────────────────────────────────────────────────────────

type Outcome = "PASS" | "FAIL" | "SKIP";

interface LegResult {
  leg: string;
  expected: string;
  actual: string;
  outcome: Outcome;
}

const results: LegResult[] = [];

function record(leg: string, expected: string, actual: string, outcome: Outcome): void {
  results.push({ leg, expected, actual, outcome });
  const tag = outcome === "PASS" ? "PASS " : outcome === "FAIL" ? "FAIL " : "SKIP ";
  const line = `[probe] ${tag} ${leg} — ${actual}`;
  if (outcome === "FAIL") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

// ── Window control (PowerShell/user32.dll bridge) ──────────────────────────

interface WindowState {
  ok: boolean;
  found?: boolean;
  minimized?: boolean;
  visible?: boolean;
  foreground?: boolean;
  hwnd?: number;
  /** GW_OWNER of the window: nonzero for an editor-embedded game (owner-linked
   *  top-level popup), 0 for a floating top-level. The ground-truth embed signal. */
  owner_hwnd?: number;
  error?: string;
}

/**
 * Drive one top-level window (identified by its owning process id) via the
 * user32.dll helper. Inputs are passed as environment variables and the script
 * body is piped to `powershell -Command -` on stdin — this avoids a script-file
 * ExecutionPolicy gate and any argv-quoting hazard. Returns the window's state
 * *after* the action (minimized / visible / foreground), or `{ ok: false }` on
 * any failure (helper missing, no window for the pid, PowerShell error).
 *
 * @param action    query | minimize | restore | foreground | unfocus
 * @param pid       owning process id whose main window is acted on
 * @param desktopPid (unfocus only) a pid whose window receives focus instead,
 *                   stealing foreground away from `pid`
 */
function windowControl(
  action: "query" | "minimize" | "restore" | "foreground" | "unfocus",
  pid: number,
  desktopPid?: number,
): WindowState {
  let script: string;
  try {
    script = readFileSync(WINDOW_CONTROL_PS1, "utf-8");
  } catch {
    return { ok: false, error: `window-control.ps1 not readable at ${WINDOW_CONTROL_PS1}` };
  }
  try {
    const stdout = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
      input: script,
      encoding: "utf-8",
      timeout: 20_000,
      env: {
        ...process.env,
        WCTL_ACTION: action,
        WCTL_PID: String(pid),
        WCTL_DESKTOP: desktopPid != null ? String(desktopPid) : "",
      },
    });
    // The helper prints exactly one compressed JSON line; tolerate any leading
    // Add-Type/compiler noise by taking the last non-empty line.
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"));
    const last = lines[lines.length - 1];
    if (!last) return { ok: false, error: `no JSON from helper (stdout: ${stdout.slice(0, 200)})` };
    return JSON.parse(last) as WindowState;
  } catch (err) {
    // execFileSync throws on non-zero exit; the helper still prints its JSON to
    // stdout in that case, so try to recover it before giving up.
    const e = err as { stdout?: string; message?: string };
    if (typeof e.stdout === "string") {
      const line = e.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{"))
        .pop();
      if (line) {
        try {
          return JSON.parse(line) as WindowState;
        } catch {
          /* fall through to the generic error */
        }
      }
    }
    return { ok: false, error: e.message ?? "powershell invocation failed" };
  }
}

/** True when the window-control helper can operate a window for `pid` at all —
 *  used as a precondition so a leg SKIPs (not FAILs) when window control is
 *  unavailable (non-Windows, helper missing, or the pid owns no visible window). */
function windowControlAvailable(pid: number): boolean {
  const state = windowControl("query", pid);
  return state.ok === true && state.found === true;
}

// ── Screenshot response shapes ─────────────────────────────────────────────
// The probe calls the tools over the bridge (editor.screenshot via `call`,
// runtime.screenshot via `callRuntime`), so it sees the RAW toolkit payload:
// success shape { image_base64, width, height, bytes, remediation?, hint? } or
// an error envelope { success:false, code, error, hint? }.

interface ShotResult {
  image_base64?: string;
  width?: number;
  height?: number;
  bytes?: number;
  code?: string;
  error?: string;
  hint?: string;
  remediation?: string[];
}

function isUsableFrame(shot: ShotResult): boolean {
  return (
    typeof shot.image_base64 === "string" &&
    shot.image_base64.length >= USABLE_MIN_BASE64 &&
    (shot.width ?? 0) > USABLE_MIN_DIM &&
    (shot.height ?? 0) > USABLE_MIN_DIM
  );
}

function frameDesc(shot: ShotResult): string {
  if (shot.code) return `code=${shot.code}`;
  return `${shot.width}x${shot.height} base64=${shot.image_base64?.length ?? 0}${
    shot.remediation ? ` remediation=[${shot.remediation.join(",")}]` : ""
  }${shot.hint ? " hint=present" : ""}`;
}

// ── Bridge type alias ──────────────────────────────────────────────────────

type Bridge = ReturnType<typeof createBridge>;

// ── Editor legs (E1/E4/E5/E6) ──────────────────────────────────────────────

async function runEditorLegs(bridge: Bridge, editorPid: number): Promise<void> {
  // E1 — baseline: usable frame, NO remediation. Uses the current main-screen
  // viewport with no window manipulation.
  {
    const shot = (await bridge.call("editor.screenshot", {}, SCREENSHOT_TIMEOUT)) as ShotResult;
    if (isUsableFrame(shot) && shot.remediation === undefined) {
      record("E1 editor baseline", "usable frame, no remediation", frameDesc(shot), "PASS");
    } else {
      record("E1 editor baseline", "usable frame, no remediation", frameDesc(shot), "FAIL");
    }
  }

  // E4 — minimized editor, no force: EDITOR_VIEWPORT_UNAVAILABLE. Minimize the
  // editor window via user32.dll, then capture. Restored in the finally.
  const min = windowControl("minimize", editorPid);
  if (!min.ok || min.minimized !== true) {
    record(
      "E4 editor minimized -> error",
      "EDITOR_VIEWPORT_UNAVAILABLE",
      `could not minimize editor (${min.error ?? JSON.stringify(min)})`,
      "SKIP",
    );
    record("E5 editor force_foreground", "usable + foregrounded_editor", "editor not minimized (E4 skipped)", "SKIP");
  } else {
    try {
      await new Promise((r) => setTimeout(r, WINDOW_SETTLE_MS));
      const shot = (await bridge.call("editor.screenshot", {}, SCREENSHOT_TIMEOUT)) as ShotResult;
      if (shot.code === "EDITOR_VIEWPORT_UNAVAILABLE") {
        record("E4 editor minimized -> error", "EDITOR_VIEWPORT_UNAVAILABLE", frameDesc(shot), "PASS");
      } else {
        record("E4 editor minimized -> error", "EDITOR_VIEWPORT_UNAVAILABLE", frameDesc(shot), "FAIL");
      }

      // E5 — force_foreground_editor:true on the still-minimized editor:
      // un-minimizes + captures a usable frame + remediation:["foregrounded_editor"].
      const forced = (await bridge.call(
        "editor.screenshot",
        { force_foreground_editor: true },
        SCREENSHOT_TIMEOUT,
      )) as ShotResult;
      if (isUsableFrame(forced) && forced.remediation?.includes("foregrounded_editor")) {
        record("E5 editor force_foreground", "usable + foregrounded_editor", frameDesc(forced), "PASS");
      } else {
        record("E5 editor force_foreground", "usable + foregrounded_editor", frameDesc(forced), "FAIL");
      }
    } finally {
      // Always leave the editor visible and foregrounded, whatever E4/E5 did.
      windowControl("restore", editorPid);
      await new Promise((r) => setTimeout(r, WINDOW_SETTLE_MS));
    }
  }

  // E6 — unfocused editor: a fresh, full-size frame (SubViewport renders
  // regardless of OS focus). Steal foreground to this Node process's window
  // isn't possible, so unfocus by foregrounding the shell's own console via its
  // pid; if that can't move focus, fall back to asserting a usable frame only.
  {
    const unfocused = windowControl("unfocus", editorPid, process.pid);
    await new Promise((r) => setTimeout(r, WINDOW_SETTLE_MS));
    const shot = (await bridge.call("editor.screenshot", {}, SCREENSHOT_TIMEOUT)) as ShotResult;
    // Whether or not focus actually moved, the contract is "fresh usable frame,
    // no collapse." If we DID unfocus (foreground=false), that's the stronger
    // assertion; either way a usable full-size frame is the pass condition.
    const focusMoved = unfocused.ok && unfocused.foreground === false;
    if (isUsableFrame(shot)) {
      record(
        "E6 editor unfocused",
        "fresh full-size frame",
        `${frameDesc(shot)}${focusMoved ? " (focus moved away)" : " (focus unchanged)"}`,
        "PASS",
      );
    } else {
      record("E6 editor unfocused", "fresh full-size frame", frameDesc(shot), "FAIL");
    }
    // Restore editor focus so the user finds it as they left it.
    windowControl("foreground", editorPid);
  }
}

// ── Runtime legs (R1/R2 + embedded R3/R4, floating R3/R4 manual-assist) ─────

/**
 * Whether the running game is embedded in the editor Game view — determined from
 * the game window's owner via user32.dll, NOT from `execute_code`. The obvious
 * `Engine.is_embedded_in_editor()` is unreachable: the toolkit's `execute_code`
 * runs a sandboxed `Expression` that blocks every engine singleton (`Engine`,
 * `OS`, `RenderingServer`, …), so it returns a hint, never the value. The window
 * owner is the deterministic ground truth on Windows: an editor-embedded game is
 * an owner-linked top-level popup (GW_OWNER → the editor's HWND), a floating game
 * is a plain top-level (GW_OWNER → 0). Returns `undefined` when the game window
 * can't be located (can't tell — caller decides).
 */
function gameIsEmbedded(gamePid: number | undefined): boolean | undefined {
  if (gamePid == null) return undefined;
  const state = windowControl("query", gamePid);
  if (!state.ok || state.found !== true) return undefined;
  return (state.owner_hwnd ?? 0) !== 0;
}

/** Read the game process id (the embedded/floating game window owner) from the
 *  registry entry's `runtime_pid`. No WS command exposes it — the toolkit only
 *  writes it to the registry, which the server reads via {@link lookupProject}. */
function gameRuntimePid(projectPath: string | undefined): number | undefined {
  if (!projectPath) return undefined;
  const entry = lookupProject(projectPath);
  const pid = entry?.runtime_pid;
  return pid != null && pid > 0 ? pid : undefined;
}

async function runRuntimeLegs(bridge: Bridge, projectPath: string | undefined, editorPid: number): Promise<void> {
  // Launch a playtest of the current scene. wait_for_runtime lets game.start
  // absorb the cold-start gap; a transport timeout is retried (a coded error
  // surfaces on the first response).
  const started = (await callRetryOnTimeout(
    bridge,
    "game.start",
    { scene_path: "current", wait_for_runtime: true },
    SCREENSHOT_TIMEOUT,
  )) as { success?: boolean; code?: string };
  if (started?.success !== true) {
    const detail = `game.start failed (${started?.code ?? "no success"})`;
    for (const leg of ["R1 runtime baseline", "R3 embedded no-force", "R4 embedded force_foreground"]) {
      record(leg, "n/a", detail, "SKIP");
    }
    return;
  }

  // Poll the runtime port so a cold first-play (import + shader compile) doesn't
  // race the first runtime call.
  let runtimeUp = false;
  for (let i = 0; i < 15; i++) {
    if (await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS)) {
      runtimeUp = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!runtimeUp) {
    record("R1 runtime baseline", "usable fresh frame", "runtime WS never came up after game.start", "SKIP");
    await bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);
    return;
  }

  try {
    const gamePid = gameRuntimePid(projectPath);
    const embedded = gameIsEmbedded(gamePid);

    // R1 — baseline runtime capture: a usable fresh PNG of the game window.
    {
      const shot = (await bridge.callRuntime("runtime.screenshot", {}, SCREENSHOT_TIMEOUT)) as ShotResult;
      if (isUsableFrame(shot)) {
        record(
          "R1 runtime baseline",
          "usable fresh frame",
          `${frameDesc(shot)} (game ${embedded === true ? "embedded" : embedded === false ? "floating" : "embed-unknown"})`,
          "PASS",
        );
      } else {
        record("R1 runtime baseline", "usable fresh frame", frameDesc(shot), "FAIL");
      }
    }

    // R2 — liveness: two consecutive captures are both usable full-size frames
    // (the pipeline serves a current frame each call, not a one-shot buffer).
    // A pixel-level mutation would need either a blocked engine singleton
    // (RenderingServer, via execute_code) or scene-specific knowledge, so this
    // asserts repeatable usability rather than a forced byte delta — the deep
    // stale-vs-fresh proof lives in the 41o-duodecies interactive record.
    {
      const first = (await bridge.callRuntime("runtime.screenshot", {}, SCREENSHOT_TIMEOUT)) as ShotResult;
      await new Promise((r) => setTimeout(r, 400));
      const second = (await bridge.callRuntime("runtime.screenshot", {}, SCREENSHOT_TIMEOUT)) as ShotResult;
      if (isUsableFrame(first) && isUsableFrame(second)) {
        record(
          "R2 runtime liveness",
          "two consecutive usable frames",
          `first=${first.bytes}B second=${second.bytes}B`,
          "PASS",
        );
      } else {
        record(
          "R2 runtime liveness",
          "two consecutive usable frames",
          `first=${frameDesc(first)} second=${frameDesc(second)}`,
          "FAIL",
        );
      }
    }

    // embed === undefined (game window not locatable) defaults to the embedded
    // matrix: it's the desktop default on 4.4+ where this Windows probe runs, and
    // the embedded legs are the ones that run unattended (floating is manual-gated).
    if (embedded === false) {
      await runFloatingRuntimeLegs(bridge, gamePid, editorPid);
    } else {
      await runEmbeddedRuntimeLegs(bridge, editorPid);
    }
  } finally {
    await bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);
  }
}

/**
 * Embedded (default 4.4+) matrix. The game is an owner-linked popup that keeps
 * compositing when the editor is minimized, so:
 *  - R3: background the game by minimizing the EDITOR → `runtime.screenshot`
 *    still returns a fresh frame with NO RUNTIME_WINDOW_MINIMIZED (capability-
 *    based: `window_can_draw` stays true).
 *  - R4: `force_foreground_game:true` → fresh frame + a truthful embedded hint +
 *    NO `foregrounded_game` remediation (the lever is a no-op on an embedded
 *    child; claiming a raise would be a lie).
 */
async function runEmbeddedRuntimeLegs(bridge: Bridge, editorPid: number): Promise<void> {
  const min = windowControl("minimize", editorPid);
  if (!min.ok || min.minimized !== true) {
    record(
      "R3 embedded no-force",
      "fresh frame, no RUNTIME_WINDOW_MINIMIZED",
      `could not minimize editor (${min.error ?? "n/a"})`,
      "SKIP",
    );
    record(
      "R4 embedded force_foreground",
      "fresh frame + embedded hint, no foregrounded_game",
      "editor not minimized",
      "SKIP",
    );
    return;
  }
  try {
    await new Promise((r) => setTimeout(r, WINDOW_SETTLE_MS));

    // R3 — no force: fresh frame, NO minimized error.
    const shot = (await bridge.callRuntime("runtime.screenshot", {}, SCREENSHOT_TIMEOUT)) as ShotResult;
    if (isUsableFrame(shot) && shot.code === undefined) {
      record("R3 embedded no-force", "fresh frame, no RUNTIME_WINDOW_MINIMIZED", frameDesc(shot), "PASS");
    } else {
      record("R3 embedded no-force", "fresh frame, no RUNTIME_WINDOW_MINIMIZED", frameDesc(shot), "FAIL");
    }

    // R4 — force_foreground_game:true: fresh frame, truthful embedded hint, and
    // crucially NO foregrounded_game remediation.
    const forced = (await bridge.callRuntime(
      "runtime.screenshot",
      { force_foreground_game: true },
      SCREENSHOT_TIMEOUT,
    )) as ShotResult;
    const hasHint = typeof forced.hint === "string" && forced.hint.length > 0;
    const noBadRemediation = !forced.remediation?.includes("foregrounded_game");
    if (isUsableFrame(forced) && hasHint && noBadRemediation) {
      record(
        "R4 embedded force_foreground",
        "fresh frame + embedded hint, no foregrounded_game",
        `${frameDesc(forced)} hint="${forced.hint?.slice(0, 60)}..."`,
        "PASS",
      );
    } else {
      record(
        "R4 embedded force_foreground",
        "fresh frame + embedded hint, no foregrounded_game",
        `${frameDesc(forced)} hint=${JSON.stringify(forced.hint)?.slice(0, 80)} remediation=${JSON.stringify(forced.remediation)}`,
        "FAIL",
      );
    }
  } finally {
    windowControl("restore", editorPid);
    await new Promise((r) => setTimeout(r, WINDOW_SETTLE_MS));
  }
}

/**
 * Floating (embed off / 4.2–4.3 / macOS) matrix. Here the game IS a real
 * top-level window that suspends render on minimize, so:
 *  - R3: minimize the GAME window → `runtime.screenshot` (no force) →
 *    RUNTIME_WINDOW_MINIMIZED.
 *  - R4: `force_foreground_game:true` → un-minimized fresh frame +
 *    remediation:["foregrounded_game"].
 *
 * Embed mode is EDITOR-only (not a `project.godot` key), so a WS-driven probe
 * cannot force floating deterministically. These legs run only under
 * MCP_MANUAL_ASSIST=1 (a human sets Game → Embed off before launch); otherwise
 * they green-skip. Even under manual-assist they SKIP (not FAIL) if the game
 * turns out to still be embedded or its window can't be driven.
 */
async function runFloatingRuntimeLegs(bridge: Bridge, gamePid: number | undefined, editorPid: number): Promise<void> {
  if (!MANUAL_ASSIST) {
    record(
      "R3 floating no-force",
      "RUNTIME_WINDOW_MINIMIZED",
      "game not embedded, but floating legs need MCP_MANUAL_ASSIST=1 (embed is editor-only, can't be forced)",
      "SKIP",
    );
    record(
      "R4 floating force_foreground",
      "un-minimized frame + foregrounded_game",
      "MCP_MANUAL_ASSIST not set",
      "SKIP",
    );
    return;
  }
  if (gamePid == null || !windowControlAvailable(gamePid)) {
    record(
      "R3 floating no-force",
      "RUNTIME_WINDOW_MINIMIZED",
      `no controllable game window (runtime_pid=${gamePid ?? "unknown"})`,
      "SKIP",
    );
    record(
      "R4 floating force_foreground",
      "un-minimized frame + foregrounded_game",
      "no controllable game window",
      "SKIP",
    );
    return;
  }

  const min = windowControl("minimize", gamePid);
  if (!min.ok || min.minimized !== true) {
    record(
      "R3 floating no-force",
      "RUNTIME_WINDOW_MINIMIZED",
      `could not minimize game (${min.error ?? "n/a"})`,
      "SKIP",
    );
    record("R4 floating force_foreground", "un-minimized frame + foregrounded_game", "game not minimized", "SKIP");
    return;
  }
  try {
    await new Promise((r) => setTimeout(r, WINDOW_SETTLE_MS));

    // R3 — floating minimized, no force: RUNTIME_WINDOW_MINIMIZED.
    const shot = (await bridge.callRuntime("runtime.screenshot", {}, SCREENSHOT_TIMEOUT)) as ShotResult;
    if (shot.code === "RUNTIME_WINDOW_MINIMIZED") {
      record("R3 floating no-force", "RUNTIME_WINDOW_MINIMIZED", frameDesc(shot), "PASS");
    } else {
      record("R3 floating no-force", "RUNTIME_WINDOW_MINIMIZED", frameDesc(shot), "FAIL");
    }

    // R4 — force_foreground_game:true: un-minimized fresh frame + foregrounded_game.
    const forced = (await bridge.callRuntime(
      "runtime.screenshot",
      { force_foreground_game: true },
      SCREENSHOT_TIMEOUT,
    )) as ShotResult;
    if (isUsableFrame(forced) && forced.remediation?.includes("foregrounded_game")) {
      record("R4 floating force_foreground", "un-minimized frame + foregrounded_game", frameDesc(forced), "PASS");
    } else {
      record("R4 floating force_foreground", "un-minimized frame + foregrounded_game", frameDesc(forced), "FAIL");
    }
  } finally {
    // Restore the game window, then re-foreground the editor.
    windowControl("restore", gamePid);
    await new Promise((r) => setTimeout(r, 400));
    windowControl("foreground", editorPid);
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

function printReport(): number {
  const pass = results.filter((r) => r.outcome === "PASS").length;
  const fail = results.filter((r) => r.outcome === "FAIL").length;
  const skip = results.filter((r) => r.outcome === "SKIP").length;

  const bar = "=".repeat(78);
  process.stdout.write(`\n${bar}\n`);
  process.stdout.write("Screenshot / window-state probe — results\n");
  process.stdout.write(`${bar}\n`);
  for (const r of results) {
    process.stdout.write(`  ${r.outcome.padEnd(4)} | ${r.leg}\n`);
    process.stdout.write(`         expected: ${r.expected}\n`);
    process.stdout.write(`         actual:   ${r.actual}\n`);
  }
  process.stdout.write(`${bar}\n`);
  process.stdout.write(`${pass} passed, ${fail} failed, ${skip} skipped, ${results.length} total\n`);
  process.stdout.write(`${bar}\n`);
  return fail > 0 ? 1 : 0;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    process.stdout.write(
      "[probe] SKIP — window-state control is Windows-only (user32.dll). Nothing to assert on this platform.\n",
    );
    process.exit(0);
  }

  const reachable = await probePort(HOST, PORT, PROBE_TIMEOUT_MS);
  if (!reachable) {
    printUnreachable("probe:screenshot");
    process.exit(2);
  }

  const projectPath = discoverProjectPath();
  const entry = projectPath ? lookupProject(projectPath) : null;
  const editorPid = entry?.pid ?? 0;
  if (!editorPid || editorPid <= 0) {
    process.stdout.write(
      "[probe] SKIP — editor is reachable but its PID is not in the registry, so window state can't be driven. " +
        "Ensure the toolkit plugin is active (it publishes the editor PID).\n",
    );
    process.exit(0);
  }
  if (!windowControlAvailable(editorPid)) {
    process.stdout.write(
      `[probe] SKIP — no controllable top-level window found for the editor PID ${editorPid} ` +
        "(headless editor, or the window-control helper is unavailable).\n",
    );
    process.exit(0);
  }

  process.stdout.write(
    `[probe] editor PID ${editorPid}; manual-assist ${MANUAL_ASSIST ? "ON" : "off"} ` +
      "(floating-game legs run only with MCP_MANUAL_ASSIST=1).\n",
  );
  if (MANUAL_ASSIST) {
    await manualCue(
      "For the FLOATING-game legs: open Game menu → set Embed to OFF (Make Floating on Play) BEFORE the probe launches the game",
    );
  }

  const bridge = createBridge(`ws://${HOST}:${PORT}`, {
    projectPath,
    explicitRuntimePort: String(RUNTIME_PORT),
  });

  try {
    await runEditorLegs(bridge, editorPid);
    await runRuntimeLegs(bridge, projectPath, editorPid);
  } catch (err) {
    const code = err instanceof BridgeError ? err.code : "INTERNAL";
    record("probe execution", "no unhandled error", `threw ${code}: ${(err as Error).message}`, "FAIL");
  } finally {
    // Belt-and-suspenders: make sure the editor is visible/foregrounded and no
    // game is left running, whatever happened above.
    windowControl("restore", editorPid);
    await bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);
    await bridge.close();
  }

  const exitCode = printReport();
  process.exit(exitCode);
}

void main().catch((err) => {
  process.stderr.write(`[probe] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});

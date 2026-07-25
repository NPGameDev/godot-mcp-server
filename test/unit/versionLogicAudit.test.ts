/**
 * Version-logic auditor — the server-side analogue of the toolkit's
 * manifest-diff gate. Enumerates every version-dependent
 * decision the server ships — hardcoded `godotMinVersion`/`godotMaxVersion`
 * gates, version-tailored tool-description hints, behavioral `getGodotVersion()`
 * branches, and the version-aware `tools/list` annotation pass-through — and
 * asserts each threshold/claim equals the gated symbol's TRUE introduction
 * version.
 *
 * A version boundary is not always a floor. Behavior that exists on one release
 * and is gone from the next is modelled as a WINDOW (`GODOT_INTRO` +
 * `GODOT_REMOVED`), and its user-facing label is rendered through `windowLabel`
 * so a closed window can never be described as an open-ended "X+".
 *
 * SELF-CONTAINED TO RUN. The authoritative intros are VENDORED below (the
 * `GODOT_INTRO` table), each constant stating what it anchors. The auditor
 * never reads the toolkit repo or the compat map at runtime — it is pure
 * server-repo TypeScript, so it runs under the existing `npm run test:unit`
 * (auto-discovered by the `.test.ts` suffix in run-all.ts) with ZERO CI-yaml
 * change. The provenance TRAIL behind the vendored values (the cross-version
 * source audit + compat map) lives in the planning repo — external material,
 * not needed to run or maintain this gate.
 *
 * REGRESSION SEMANTICS. Every assertion interpolates a vendored intro into the
 * expected value, so the gate FAILS LOUDLY when server code drifts from the
 * vendored truth — e.g. someone edits scene_close's gate to "4.4", or rewords
 * a "4.5+" description hint to the wrong version. Fixing such a failure means
 * re-running the cross-version threshold audit and updating BOTH the code and
 * the vendored constant together (a deliberate, reviewed act), exactly like
 * bumping the toolkit sweep-coverage manifest.
 *
 * The audit that produced these values found ZERO mismatches across the
 * enumerated sites; this file locks that clean state.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_TOOL_DEFS } from "../../src/registration/catalogue.js";
import { compareGodotVer, parseGodotVer } from "../../src/shared/version.js";
import type { ToolDef } from "../../src/shared/types.js";

// ── Vendored Godot-API / behavioral intro table ──────────────────────
//
// "intro" = the FIRST Godot minor release on which the gated symbol/behavior
// exists. API rows are ClassDB-presence facts (verifiable against the engine
// source per version); behavioral rows gate engine BEHAVIOR (not ClassDB
// presence) and rest on documented empirical characterization. Change a value
// ONLY alongside a re-audit — it is the anchor the whole gate compares
// against.

const GODOT_INTRO = {
  // ── ClassDB API introductions (compat-map-verifiable) ──
  /** `EditorInterface.close_scene` — present 4.5+. Gates scene_close AND the
   *  four "auto-closes tab on 4.5+" delete-tool hints. */
  close_scene: "4.5",
  /** `Logger` class — editor parse-error capture, present 4.5+.
   *  Co-varies with os_add_logger. */
  logger_class: "4.5",
  /** `OS.add_logger` — parse-error sink behind script_check's real-line hint,
   *  present 4.5+. */
  os_add_logger: "4.5",
  /** `TileMapLayer` node — introduced 4.3; TileMap deprecated after. */
  tilemaplayer: "4.3",

  // ── Behavioral boundaries (engine behavior, not API presence) ──
  /** LSP auto-rebind on port contention — added 4.5; 4.2-4.4 have no bind retry
   *  and need a manual editor restart. WINDOWED: see GODOT_REMOVED for the far
   *  end, and never phrase this one as "4.5+". */
  lsp_bind_retry: "4.5",
  /** LSP `window/showMessage` protocol support — shipped 4.5 (PR #104401),
   *  absent 4.2-4.4. Engine-verified against gdscript_language_protocol.cpp. */
  lsp_show_message: "4.5",
  /** LSP rootUri root-mismatch warning during initialize — 4.5+ behavior. */
  lsp_rooturi_mismatch: "4.5",
  /** gdshader `languageId:"gdshader"` honored 4.6+ only (shader-diagnostic
   *  suppression); 4.2-4.5 ignore it. */
  gdshader_language_id: "4.6",
  /** Headless stale-instance hot-reload hint applies 4.4+ (hot-reload boundary
   *  4.3→4.4, empirically characterized 4.2.0–4.6.2). */
  headless_stale_instance: "4.4",

  // ── Range / policy anchors ──
  /** Supported floor — 4.2 is the baseline; a tool omits godotMinVersion when it
   *  works on 4.2+. */
  supported_floor: "4.2",
  /** Tested maximum — GODOT_TESTED_MAX_VERSION "4.7.0"; bump on a 4.8 adoption
   *  pass. */
  tested_max: "4.7",
} as const;

// ── Vendored removal table — the far end of a WINDOWED behavior ───────
//
// A GODOT_INTRO row on its own reads as "and every version after", which is how a
// behavior that existed on exactly one release came to be advertised for all its
// successors. A name listed here names the first Godot minor on which the behavior
// is GONE again, so intro + removal define the half-open window [intro, removal):
// present from intro, absent from removal onward. Same rule as GODOT_INTRO — change
// a value only alongside a re-audit.

const GODOT_REMOVED = {
  /** LSP bind retry, removed in 4.6. On 4.5 NOTIFICATION_INTERNAL_PROCESS re-runs
   *  start() on every frame the bind has not succeeded (`if (!started && …)`), so
   *  the LSP takes the port as soon as the other editor frees it. 4.6 moved the
   *  guard to a `start_attempted` flag set BEFORE the call, making the bind
   *  one-shot; 4.7 keeps the latch. Engine-verified in
   *  modules/gdscript/language_server/gdscript_language_server.cpp on 4.5/4.6/4.7. */
  lsp_bind_retry: "4.6",
} as const;

// ── Helpers ──────────────────────────────────────────────────────────

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** Read a server source file (relative to src/) as text — for behavioral sites
 *  that live in code/comments, not in a ToolDef. */
function readSrc(rel: string): string {
  return readFileSync(join(srcDir, rel), "utf-8");
}

/** Look up a ToolDef by name; fail loudly (rename/removal → revisit the audit). */
function defByName(name: string): ToolDef {
  const def = ALL_TOOL_DEFS.find((t) => t.name === name);
  assert.ok(def, `audited tool "${name}" not found in ALL_TOOL_DEFS — rename/removal? re-run the version-logic audit`);
  return def;
}

/** Assert a tool's description carries the expected version-bearing fragment. */
function assertDescHas(name: string, fragment: string, site: string): void {
  const desc = defByName(name).description;
  assert.ok(
    desc.includes(fragment),
    `[${site}] ${name} description must contain ${JSON.stringify(fragment)} (drift from vendored intro?)\n  got: ${JSON.stringify(desc)}`,
  );
}

/** Assert a source file contains the expected version-bearing fragment. */
function assertSrcHas(rel: string, fragment: string, site: string): void {
  assert.ok(
    readSrc(rel).includes(fragment),
    `[${site}] ${rel} must contain ${JSON.stringify(fragment)} (behavioral threshold drift from vendored intro?)`,
  );
}

/** Assert a source file does NOT contain a fragment.
 *
 *  BELT-AND-BRACES ONLY. It bans one literal spelling of a wrong claim, so a
 *  paraphrase ("4.5 or newer rebinds automatically") sails straight past it. The
 *  actual lock is the positive `assertSrcHas` pair whose expected text is
 *  interpolated from the vendored model — that one cannot be satisfied by prose
 *  the model does not license. Use this to make the specific regression that
 *  already happened once impossible to reintroduce verbatim, never as the only
 *  guard on a claim. */
function assertSrcLacks(rel: string, fragment: string, site: string): void {
  assert.ok(
    !readSrc(rel).includes(fragment),
    `[${site}] ${rel} must NOT contain ${JSON.stringify(fragment)} — that phrasing claims the behavior for versions the vendored model excludes`,
  );
}

/** The Godot minor immediately below `version`: "4.6" → "4.5". */
function minorBelow(version: string): string {
  const [major, minor] = version.split(".").map(Number);
  assert.ok(Number.isInteger(major) && Number.isInteger(minor) && minor > 0, `cannot step below Godot "${version}"`);
  return `${major}.${minor - 1}`;
}

/** The last Godot minor a windowed behavior still exists on — the inclusive upper
 *  bound the gate and the prose label must both use. */
function windowMax(name: keyof typeof GODOT_REMOVED): string {
  const intro: string = GODOT_INTRO[name];
  const lastIncluded = minorBelow(GODOT_REMOVED[name]);
  // Numeric compare via the production comparator: a lexicographic `<=` would call
  // the window [4.9, 4.11) empty, because "4.9" > "4.10" as strings.
  assert.ok(
    compareGodotVer(parseGodotVer(intro), parseGodotVer(lastIncluded)) <= 0,
    `${name}: window [${intro}, ${GODOT_REMOVED[name]}) is empty — re-audit`,
  );
  return lastIncluded;
}

/** The prose label for a windowed behavior: the intro alone when the window spans
 *  one minor ("4.5"), otherwise an inclusive range ("4.5-4.6"). Never an
 *  open-ended "X+" — that is precisely the claim a closed window cannot make, and
 *  building every user-facing label through here is what keeps the wording and the
 *  vendored window from drifting apart. */
function windowLabel(name: keyof typeof GODOT_REMOVED): string {
  const intro: string = GODOT_INTRO[name];
  const lastIncluded = windowMax(name);
  return intro === lastIncluded ? intro : `${intro}-${lastIncluded}`;
}

let sites = 0;

// ── Block A — hardcoded godotMinVersion/godotMaxVersion catalogue gates ──
//
// Exactly one built-in tool carries a hardcoded version gate: scene_close, min
// 4.5 = close_scene intro. Enumerate the whole catalogue so a NEW gate (or a
// drifted one, or one with an unvetted value) trips here loudly.

{
  const gated = ALL_TOOL_DEFS.filter((t) => t.godotMinVersion != null || t.godotMaxVersion != null).map((t) => ({
    name: t.name,
    min: t.godotMinVersion,
    max: t.godotMaxVersion,
  }));

  // The complete, audited set of hardcoded catalogue gates (exactly one).
  assert.deepEqual(
    gated,
    [{ name: "scene_close", min: GODOT_INTRO.close_scene, max: undefined }],
    "hardcoded godotMinVersion/godotMaxVersion catalogue gates drifted from the audited set — re-run the version-logic audit",
  );
  sites += 1; // editor.ts:73

  // Any gate value that exists must come from a vendored, audited table. The guard
  // is against an UNVETTED version literal, not against which table a value came
  // from: both are merged into one allowlist, so a removal value would satisfy a
  // godotMinVersion check and vice versa. Deliberately permissive — a value cannot
  // be here without having been audited, and every real version anchor doubles as
  // both a floor for the behavior after it and a ceiling for the behavior before it.
  const knownVersions = new Set<string>([...Object.values(GODOT_INTRO), ...Object.values(GODOT_REMOVED)]);
  for (const g of gated) {
    if (g.min != null)
      assert.ok(
        knownVersions.has(g.min),
        `${g.name}: godotMinVersion "${g.min}" is not a vendored version anchor — vet + vendor it`,
      );
    if (g.max != null)
      assert.ok(
        knownVersions.has(g.max),
        `${g.name}: godotMaxVersion "${g.max}" is not a vendored version anchor — vet + vendor it`,
      );
  }

  // Mechanism lock: the gate must pass through into the tools/list annotation
  // (toolRegistry.ts) — otherwise the version gate would be invisible to clients.
  assertSrcHas("registration/toolRegistry.ts", "godotMinVersion: tool.godotMinVersion", "toolRegistry annotation");
  assertSrcHas("registration/toolRegistry.ts", "godotMaxVersion: tool.godotMaxVersion", "toolRegistry annotation");
  sites += 1;
}

// ── Block B — version-tailored tool-description hints ─────────────────
//
// Each delete-family hint and the tilemap/script/inherited hints encode a
// version threshold in user-facing description text. Assert the version-bearing
// fragment, built from the vendored intro, so a reworded/wrong-version hint fails.

assertDescHas("scene_close", `Requires Godot ${GODOT_INTRO.close_scene}+`, "editor.ts:70");
sites += 1;
assertDescHas("scene_delete", `on ${GODOT_INTRO.close_scene}+ (tab_closed`, "scene.ts:81");
sites += 1;
assertDescHas("folder_delete", `On ${GODOT_INTRO.close_scene}+ closes`, "folder.ts:22");
sites += 1;
assertDescHas("file_delete", `tabs on ${GODOT_INTRO.close_scene}+ (tab_closed`, "file.ts:14");
sites += 1;
assertDescHas("script_check", `On ${GODOT_INTRO.os_add_logger}+ the error diagnostic`, "script.ts:54");
sites += 1;
assertDescHas("tilemap_read_cells", `TileMapLayer (${GODOT_INTRO.tilemaplayer}+)`, "tilemap.ts:13");
sites += 1;
assertDescHas(
  "scene_create_inherited",
  `all ${GODOT_INTRO.supported_floor}-${GODOT_INTRO.tested_max}`,
  "sceneInheritance.ts:12",
);
sites += 1;

// ── Block C — behavioral thresholds in getGodotVersion() branches / comments ──
//
// These live in LSP code + shared type-doc comments (not ToolDefs). Assert the
// version-bearing fragment, built from the vendored behavioral boundary.

// LSP bind-retry family — a WINDOWED behavior, so the gate is checked against BOTH
// bounds and every description is labelled through windowLabel. The banned-phrasing
// loop at the end is belt-and-braces over those positive checks, not a substitute.
{
  // A removal row without an intro row describes no window at all.
  for (const name of Object.keys(GODOT_REMOVED)) {
    assert.ok(name in GODOT_INTRO, `GODOT_REMOVED.${name} has no GODOT_INTRO row — a window needs both ends`);
  }
  const bindRetry = windowLabel("lsp_bind_retry");

  // The gate carries BOTH bounds of the window in one bounded call, so drift at
  // either end fails here. Asserting only an opening bound is what let an "at least
  // 4.5" gate pass while the advice it selected was false on 4.6 and 4.7.
  assertSrcHas(
    "lsp/lspClient.ts",
    `isVersionCompatible(v, "${GODOT_INTRO.lsp_bind_retry}", "${windowMax("lsp_bind_retry")}")`,
    "hint gate — the closed window, both bounds",
  );
  sites += 1;

  // User-facing + explanatory text, all labelled through windowLabel.
  assertSrcHas("lsp/lspClient.ts", `only Godot ${bindRetry} rebinds automatically`, "version-unknown hint text");
  sites += 1;
  assertSrcHas("lsp/lspStatusReporter.ts", `${bindRetry} auto-rebind vs`, "status-reporter module + wiring comments");
  sites += 1;
  assertSrcHas("lsp/lspSession.ts", `rebinds (${bindRetry} only)`, "verified-verdict comment");
  sites += 1;

  // The open-ended form claims the retry for every later release, which the engine
  // does not do. Banning the exact spelling that shipped once stops a verbatim
  // relapse; a paraphrase would slip past, which is why the positive asserts above
  // are the real lock.
  for (const rel of ["lsp/lspClient.ts", "lsp/lspSession.ts", "lsp/lspStatusReporter.ts"]) {
    assertSrcLacks(rel, `${GODOT_INTRO.lsp_bind_retry}+ rebind`, "no open-ended bind-retry claim");
    assertSrcLacks(rel, `${GODOT_INTRO.lsp_bind_retry}+ auto-rebind`, "no open-ended bind-retry claim");
  }
  sites += 1;
}

// LSP 4.5 showMessage protocol (PR #104401).
assertSrcHas("lsp/lspClient.ts", `Godot ${GODOT_INTRO.lsp_show_message}+ (PR #104401)`, "lspClient.ts:25");
sites += 1;

// LSP 4.5 rootUri root-mismatch warning.
assertSrcHas("lsp/lspClient.ts", `${GODOT_INTRO.lsp_rooturi_mismatch}+ root-mismatch`, "lspClient.ts:231");
sites += 1;
assertSrcHas("registry.ts", `rootUri on ${GODOT_INTRO.lsp_rooturi_mismatch}+`, "registry.ts:173");
sites += 1;

// LSP result uniform across the whole supported range.
assertSrcHas(
  "lsp/lspClient.ts",
  `uniform across ${GODOT_INTRO.supported_floor}-${GODOT_INTRO.tested_max}`,
  "lspClient.ts:387",
);
sites += 1;

// gdshader languageId honored 4.6+.
assertSrcHas(
  "tools/lsp.ts",
  `${GODOT_INTRO.gdshader_language_id}/${GODOT_INTRO.tested_max} languageId`,
  "tools/lsp.ts:167",
);
sites += 1;

// Headless stale-instance hint 4.4+ + baseline-floor schema doc.
assertSrcHas(
  "shared/types.ts",
  `${GODOT_INTRO.headless_stale_instance}+ headless stale-instance`,
  "shared/types.ts:34",
);
sites += 1;
assertSrcHas("shared/types.ts", `Omit for ${GODOT_INTRO.supported_floor}+ (baseline)`, "shared/types.ts:144");
sites += 1;

// toolRegistry doc-example gate (illustrative — locks the documented value too).
assertSrcHas("registration/toolRegistry.ts", `godotMinVersion: "${GODOT_INTRO.close_scene}"`, "toolRegistry.ts:119");
sites += 1;

console.log(
  `All version-logic audit assertions passed — ${sites} server version-logic sites asserted against ` +
    `${Object.keys(GODOT_INTRO).length} vendored intros and ${Object.keys(GODOT_REMOVED).length} vendored removal(s).`,
);

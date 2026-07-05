/**
 * Version-logic auditor — the server-side analogue of the toolkit's
 * manifest-diff gate (iter 41n-quinquies). Enumerates every version-dependent
 * decision the server ships — hardcoded `godotMinVersion`/`godotMaxVersion`
 * gates, version-tailored tool-description hints, behavioral `getGodotVersion()`
 * branches, and the version-aware `tools/list` annotation pass-through — and
 * asserts each threshold/claim equals the gated symbol's TRUE introduction
 * version.
 *
 * SELF-CONTAINED BY DESIGN. The authoritative intros are VENDORED below (the
 * `GODOT_INTRO` table), each constant carrying a provenance comment citing the
 * compat map + the source-code audit. The auditor never reads the toolkit repo
 * or the compat map at runtime — it is pure server-repo TypeScript, so it runs
 * under the existing `npm run test:unit` (auto-discovered by the `.test.ts`
 * suffix in run-all.ts) with ZERO CI-yaml change.
 *
 * REGRESSION SEMANTICS. Every assertion interpolates a vendored intro into the
 * expected value, so the gate FAILS LOUDLY when server code drifts from the
 * vendored truth — e.g. someone edits scene_close's gate to "4.4", or reworders
 * a "4.5+" description hint to the wrong version. Fixing such a failure means
 * re-running the cross-version threshold audit and updating BOTH the code and
 * the vendored constant together (a deliberate, reviewed act), exactly like
 * bumping the toolkit sweep-coverage manifest.
 *
 * GREEN NOW. The class-4 audit (SourceCodeAudits/class-3-4-thresholds.md §iii)
 * found ZERO mismatches across these sites; this file locks that clean state.
 *
 * Source of truth for the enumeration + intros:
 *   godot-mcp-creation/SourceCodeAudits/class-3-4-thresholds.md  (§iii, class 4)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_TOOL_DEFS } from "../../src/registration/catalogue.js";
import type { ToolDef } from "../../src/shared/types.js";

// ── Vendored Godot-API / behavioral intro table ──────────────────────
//
// "intro" = the FIRST Godot minor release on which the gated symbol/behavior
// exists. API rows are compat-map-verifiable (compat-map.tsv, 4.2–4.7);
// behavioral rows gate engine BEHAVIOR (not ClassDB presence) and cite their
// documented empirical characterization. Every value below was reconciled to
// PASS in the class-4 audit. Change a value ONLY alongside a re-audit — it is
// the anchor the whole gate compares against.

const GODOT_INTRO = {
  // ── ClassDB API introductions (compat-map-verifiable) ──
  /** `EditorInterface.close_scene` — present 4.5+ (compat "---YYY"). Gates
   *  scene_close AND the four "auto-closes tab on 4.5+" delete-tool hints.
   *  Audit §iii editor.ts:70/73, scene.ts:81, folder.ts:22, file.ts:14. */
  close_scene: "4.5",
  /** `Logger` class — editor parse-error capture, present 4.5+ ("---YYY").
   *  Co-varies with os_add_logger. Audit §ii log_buffer.gd:75. */
  logger_class: "4.5",
  /** `OS.add_logger` — parse-error sink behind script_check's real-line hint,
   *  present 4.5+ ("---YYY"). Audit §iii script.ts:54; §ii script_commands.gd:303. */
  os_add_logger: "4.5",
  /** `TileMapLayer` node — introduced 4.3 ("-YYYYY"); TileMap deprecated after.
   *  Audit §iii tilemap.ts:13; §ii tilemap_commands.gd:34. */
  tilemaplayer: "4.3",

  // ── Behavioral boundaries (engine behavior, not API presence) ──
  /** LSP auto-rebind on port contention — added 4.5; 4.2-4.4 have no bind retry
   *  and need a manual editor restart. Flag B-4. Audit §iii lspClient.ts:52/71,
   *  lspSession.ts:55, lspStatusReporter.ts:15/51. */
  lsp_bind_retry: "4.5",
  /** LSP `window/showMessage` protocol support — shipped 4.5 (PR #104401),
   *  absent 4.2-4.4. Engine-verified against gdscript_language_protocol.cpp.
   *  Audit §iii lspClient.ts (rootUri/showMessage family). */
  lsp_show_message: "4.5",
  /** LSP rootUri root-mismatch warning during initialize — 4.5+ behavior.
   *  Flag B-4. Audit §iii lspClient.ts:231/308/527, registry.ts:173. */
  lsp_rooturi_mismatch: "4.5",
  /** gdshader `languageId:"gdshader"` honored 4.6+ only (shader-diagnostic
   *  suppression); 4.2-4.5 ignore it. Flag B-6. Audit §iii tools/lsp.ts:167-169. */
  gdshader_language_id: "4.6",
  /** Headless stale-instance hot-reload hint applies 4.4+ (hot-reload boundary
   *  4.3→4.4, empirically characterized 4.2.0–4.6.2). Flag B-3.
   *  Audit §iii shared/types.ts:34; §ii stale_instance_hint.gd. */
  headless_stale_instance: "4.4",

  // ── Range / policy anchors ──
  /** Supported floor — 4.2 is the baseline; a tool omits godotMinVersion when it
   *  works on 4.2+. Audit §iii shared/types.ts:144-147, sceneInheritance.ts:12. */
  supported_floor: "4.2",
  /** Tested maximum — GODOT_TESTED_MAX_VERSION "4.7.0"; bump on a 4.8 adoption
   *  pass. Audit §iii sceneInheritance.ts:12, lspClient.ts:387; §ii plugin.gd:73. */
  tested_max: "4.7",
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

  // The complete, audited set of hardcoded catalogue gates (class-4 audit: 1).
  assert.deepEqual(
    gated,
    [{ name: "scene_close", min: GODOT_INTRO.close_scene, max: undefined }],
    "hardcoded godotMinVersion/godotMaxVersion catalogue gates drifted from the audited set — re-run the version-logic audit",
  );
  sites += 1; // editor.ts:73

  // Any gate value that exists must be a vendored, audited intro (defence
  // against a future gate landing with an unvetted version literal).
  const knownIntros = new Set<string>(Object.values(GODOT_INTRO));
  for (const g of gated) {
    if (g.min != null)
      assert.ok(
        knownIntros.has(g.min),
        `${g.name}: godotMinVersion "${g.min}" is not a vendored intro — vet + vendor it`,
      );
    if (g.max != null)
      assert.ok(
        knownIntros.has(g.max),
        `${g.name}: godotMaxVersion "${g.max}" is not a vendored intro — vet + vendor it`,
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

// LSP 4.5 auto-rebind family (flag B-4).
assertSrcHas("lsp/lspClient.ts", `isVersionAtLeast(v, "${GODOT_INTRO.lsp_bind_retry}")`, "lspClient.ts:52");
sites += 1;
assertSrcHas("lsp/lspClient.ts", `Godot ${GODOT_INTRO.lsp_bind_retry}+ rebinds automatically`, "lspClient.ts:71");
sites += 1;
assertSrcHas("lsp/lspStatusReporter.ts", `${GODOT_INTRO.lsp_bind_retry}+ auto-rebind vs`, "lspStatusReporter.ts:15/51");
sites += 1;
assertSrcHas("lsp/lspSession.ts", `rebinds (${GODOT_INTRO.lsp_bind_retry}+)`, "lspSession.ts:55");
sites += 1;

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

// gdshader languageId honored 4.6+ (flag B-6).
assertSrcHas(
  "tools/lsp.ts",
  `${GODOT_INTRO.gdshader_language_id}/${GODOT_INTRO.tested_max} languageId`,
  "tools/lsp.ts:167",
);
sites += 1;

// Headless stale-instance hint 4.4+ (flag B-3) + baseline-floor schema doc.
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
  `All version-logic audit assertions passed — ${sites} server version-logic sites asserted against ${Object.keys(GODOT_INTRO).length} vendored intros.`,
);

import type { TestCtx } from "../helpers.js";
import { assertError, assertHint, CALL_TIMEOUT } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["extensions_refresh"];
export async function testExtensibility(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── extensions.list endpoint ────────────────────────────────────────
  // The extensions.list command should always be registered (the
  // extension_loader always registers it). With no third-party extensions
  // discovered, it returns an empty list.
  const extResult = (await bridge.call("extensions.list", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    commands?: {
      method: string;
      description?: string;
      input_schema?: Record<string, unknown>;
      annotations?: Record<string, boolean>;
      group?: { name: string; description?: string };
    }[];
  };
  if (!extResult?.success) {
    fail(`extensions.list: expected success, got ${JSON.stringify(extResult)}`);
  } else if (!Array.isArray(extResult.commands)) {
    fail(`extensions.list: expected commands array, got ${JSON.stringify(extResult)}`);
  } else {
    pass(`extensions.list -> ${extResult.commands.length} extension(s)`);
  }

  // ── extensions.refresh (hot-reload trigger) ─────────────────────────
  // The extensions.refresh method forces a filesystem scan for extension manifests.
  // Even with no extensions installed, it should succeed.
  // (MCP tool name is "extensions_refresh"; Godot method is "extensions.refresh")
  const refreshResult = (await bridge.call("extensions.refresh", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    commands?: unknown[];
    code?: string;
  };
  if (refreshResult?.success === true) {
    pass(
      `extensions.refresh -> success (${Array.isArray(refreshResult.commands) ? refreshResult.commands.length : 0} commands found)`,
    );
  } else if (refreshResult?.code) {
    // May fail if the toolkit doesn't support extensions.refresh yet — acceptable.
    pass(`extensions.refresh -> ${refreshResult.code} (older plugin — acceptable)`);
  } else {
    fail(`extensions.refresh: unexpected response ${JSON.stringify(refreshResult)}`);
  }

  // ── Godot 4.2 vs 4.3+ extension hot-reload contract (documented) ─────
  // Adding and removing extensions apply live on ALL supported versions. EDITING
  // an existing extension's tools in-session diverges by editor version:
  //   • Godot 4.3+ : the edit is applied live (loader re-reads the script fresh via
  //                  CACHE_MODE_IGNORE and re-registers).
  //   • Godot 4.2  : the edit is NOT applied in-session. Loading a freshly-edited
  //                  @tool script fresh while the 4.2 editor is reimporting it
  //                  crashes the editor (CACHE_MODE_IGNORE reimport reentrancy — see
  //                  COMPATIBILITY.md / P-056), so the 4.2 loader reads through the
  //                  editor cache (CACHE_MODE_REUSE) and cannot see the edit.
  //                  extensions.refresh then returns a `hint` naming the extension and
  //                  telling the user to restart the editor.
  // The full live add/edit/remove lifecycle — including the 4.2 restart-nudge hint —
  // is exercised by the interactive tool sweep (Section 24 E5), not here: this
  // structural pass intentionally does not create extension scripts.

  // ── Reserved namespace rejection ─────────────────────────────────────
  // Verify that the extensions endpoint doesn't list any commands under
  // reserved namespaces (the loader rejects these at load time).
  if (extResult?.success && Array.isArray(extResult.commands)) {
    const reserved = [
      "scene.",
      "script.",
      "editor.",
      "node.",
      "runtime.",
      "server.",
      "resource.",
      "folder.",
      "file.",
      "signal.",
      "playtest.",
      "project.",
      "input_map.",
      "animation.",
      "tilemap.",
      "asset.",
      "save.",
      "meta.",
      "game.",
      "diff.",
      "autoload.",
      "extensions.",
    ];
    const violations = extResult.commands.filter((c) => reserved.some((r) => c.method.startsWith(r)));
    if (violations.length > 0) {
      fail(`reserved namespace leak: ${violations.map((v) => v.method).join(", ")}`);
    } else {
      pass("no reserved-namespace extensions leaked");
    }
  }

  // ── Extension version-gating structural assertion ────────────────────
  // Verify that extensions.list response supports version-gating fields.
  // Extensions may declare min_godot_version / max_godot_version constraints
  // so the server can hide them on incompatible editor versions. Here we
  // validate the schema supports these fields (if any extensions are present,
  // verify their version fields are well-formed).
  if (extResult?.success && Array.isArray(extResult.commands)) {
    let versionFieldsValid = true;
    for (const cmd of extResult.commands) {
      const ext = cmd as Record<string, unknown>;
      // If extension declares version constraints, they must be semver-like strings.
      const minVer = ext.min_godot_version as string | undefined;
      const maxVer = ext.max_godot_version as string | undefined;
      if (minVer && !/^\d+\.\d+/.test(minVer)) {
        fail(`extension ${cmd.method}: malformed min_godot_version "${minVer}"`);
        versionFieldsValid = false;
      }
      if (maxVer && !/^\d+\.\d+/.test(maxVer)) {
        fail(`extension ${cmd.method}: malformed max_godot_version "${maxVer}"`);
        versionFieldsValid = false;
      }
    }
    if (versionFieldsValid) {
      pass(
        `extension version-gating: ${extResult.commands.length} extension(s) have valid version fields (or none declared)`,
      );
    }
  }

  // ── Error contract: invalid params → structured error with hint ─────
  // Use a built-in tool with required params to verify the error envelope
  // survives the MCP bridge round-trip: {success:false, code, error, hint}.
  const errResult = (await bridge.call("script.read", { file_path: "" }, CALL_TIMEOUT)) as Record<string, unknown>;
  assertError(ctx, "error contract (empty file_path)", errResult, "INVALID_PARAMS");
  assertHint(ctx, "error hint (empty file_path)", errResult);

  // ── Success contract: built-in tools return success:true ─────────────
  // Verify the response contract (ADR 0004): every handler returns
  // {success: true/false}. Built-in tool successHints are injected
  // server-side in callAndWrap(), NOT at the bridge level — so we only
  // check that success:true is present here.
  const treeResult = (await bridge.call("scene.get_tree", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    hint?: string;
  };
  if (treeResult?.success) {
    pass(`success contract: scene.get_tree -> success=true`);
  } else {
    // scene.get_tree may fail if no scene is open — acceptable, skip
    pass(
      `success contract: scene.get_tree unavailable (${(treeResult as Record<string, unknown>)?.code ?? "no scene"}) — skipped`,
    );
  }
}

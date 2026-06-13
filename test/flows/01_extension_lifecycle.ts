// ═══════════════════════════════════════════════════════════════════════════
// Flow 01 — Extension lifecycle (the flagship flow; sweep S24 → flows).
//
// This is the gap smoke structurally cannot cover: smoke tests each tool in
// isolation and "intentionally does not create extension scripts"
// (22_extensibility.ts). The 41l-tricies validation caught a Major regression —
// `extensions.refresh` returning commands:[] for a newly-created extension —
// that full smoke passed right past (437/0). This flow exercises the
// create → discovered → call → update → remove → gone lifecycle and would have
// caught it.
//
// Talks to the Godot toolkit registry directly over the bridge (extensions.*,
// script.*, and the registered extension methods) — NOT the server-side
// discover_tools/group layer (that is smoke §39 + server unit tests).
//
// Version branch (decision #4): create→discovered and remove→gone are uniform
// across all supported versions; only update-existing-in-session branches —
// 4.3+ applies the edit live, 4.2 defers it with a restart hint (the
// 41l-tricies-ter CACHE_MODE_REUSE gate). The 4.2 assertion here also
// regression-guards that fix.
// ═══════════════════════════════════════════════════════════════════════════

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT } from "../helpers.js";
import { isVersionAtLeast } from "../../src/version.js";
import { FLOW_PROBE_DIR, ensureProbeDir, cleanupProbeDir } from "./_shared.js";

export const TOOLS_TESTED: string[] = ["extensions_refresh", "script_write", "script_delete"];

const EXT_PATH = `${FLOW_PROBE_DIR}/flow_test_extension.gd`;

// Two-tool extension (create state). flow_ext.hello + flow_ext.add.
const EXT_V1 = `@tool
class_name FlowTestExtension
extends MCPToolkitExtension

func register(registry: MCPToolkitCommandRegistry, _server: Node) -> void:
\tregistry.add("flow_ext.hello", func(params: Dictionary) -> Dictionary:
\t\tvar who := str(params.get("name", "world"))
\t\treturn {"success": true, "message": "Hello, %s!" % who}
\t, MCPToolkitExtensionOptions.new("Flow test greeting")
\t\t.with_input_schema({"type": "object", "properties": {"name": {"type": "string"}}})
\t\t.with_group("flow_test_group", "Flow test group"))
\tregistry.add("flow_ext.add", func(params: Dictionary) -> Dictionary:
\t\tvar a := int(params.get("a", 0))
\t\tvar b := int(params.get("b", 0))
\t\treturn {"success": true, "result": a + b}
\t, MCPToolkitExtensionOptions.new("Flow test adder")
\t\t.with_input_schema({"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}, "required": ["a", "b"]})
\t\t.with_group("flow_test_group", "Flow test group"))
\tregistry.add("flow_ext.guarded", func(params: Dictionary) -> Dictionary:
\t\treturn {"success": true, "path": str(params.get("file_path", ""))}
\t, MCPToolkitExtensionOptions.new("Flow test path-guarded")
\t\t.with_input_schema({"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]})
\t\t.guard_project_path("file_path")
\t\t.with_group("flow_test_group", "Flow test group"))
`;

// Three-tool extension (update-existing state). Adds flow_ext.multiply, keeps
// the header (class_name/extends) or discovery breaks.
const EXT_V2 = `@tool
class_name FlowTestExtension
extends MCPToolkitExtension

func register(registry: MCPToolkitCommandRegistry, _server: Node) -> void:
\tregistry.add("flow_ext.hello", func(params: Dictionary) -> Dictionary:
\t\tvar who := str(params.get("name", "world"))
\t\treturn {"success": true, "message": "Hello, %s!" % who}
\t, MCPToolkitExtensionOptions.new("Flow test greeting")
\t\t.with_input_schema({"type": "object", "properties": {"name": {"type": "string"}}})
\t\t.with_group("flow_test_group", "Flow test group"))
\tregistry.add("flow_ext.add", func(params: Dictionary) -> Dictionary:
\t\tvar a := int(params.get("a", 0))
\t\tvar b := int(params.get("b", 0))
\t\treturn {"success": true, "result": a + b}
\t, MCPToolkitExtensionOptions.new("Flow test adder")
\t\t.with_input_schema({"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}, "required": ["a", "b"]})
\t\t.with_group("flow_test_group", "Flow test group"))
\tregistry.add("flow_ext.multiply", func(params: Dictionary) -> Dictionary:
\t\tvar a := int(params.get("a", 0))
\t\tvar b := int(params.get("b", 0))
\t\treturn {"success": true, "result": a * b}
\t, MCPToolkitExtensionOptions.new("Flow test multiplier")
\t\t.with_input_schema({"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}, "required": ["a", "b"]})
\t\t.with_group("flow_test_group", "Flow test group"))
`;

interface RefreshResult {
  success?: boolean;
  commands?: { method: string }[];
  hint?: string;
  code?: string;
}

function methodsOf(res: RefreshResult): string[] {
  return Array.isArray(res?.commands) ? res.commands.map((c) => c.method) : [];
}

/** Force the filesystem scan to settle before asserting on discovery. The
 *  bridge timeout outlasts the server-side wait so they cannot race. */
async function settleScan(ctx: TestCtx): Promise<void> {
  try {
    await ctx.bridge.call("editor.wait_for_idle", { timeout_ms: 5000 }, SCREENSHOT_TIMEOUT);
  } catch {
    // wait_for_idle is best-effort; refresh forces the scan regardless.
  }
}

export async function testExtensionLifecycle(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const godotVer = bridge.getGodotVersion();

  await ensureProbeDir(ctx);

  try {
    // ── CREATE → DISCOVERED (uniform across versions) ──────────────────────
    // This is the Finding #1 guard: write a brand-new extension, refresh, and
    // assert its commands appear. A commands:[] response here is the exact
    // regression smoke could not see.
    const writeV1 = (await bridge.call("script.write", { file_path: EXT_PATH, content: EXT_V1 }, CALL_TIMEOUT)) as {
      success?: boolean;
      code?: string;
    };
    if (writeV1?.success !== true) {
      fail(`ext lifecycle CREATE: script.write failed: ${JSON.stringify(writeV1)}`);
      return; // nothing to assert without the file
    }
    pass("ext lifecycle CREATE: script.write extension (2 tools)");

    await settleScan(ctx);
    const refreshCreate = (await bridge.call("extensions.refresh", {}, CALL_TIMEOUT)) as RefreshResult;
    const createdMethods = methodsOf(refreshCreate);
    if (refreshCreate?.success !== true) {
      fail(`ext lifecycle CREATE: extensions.refresh failed: ${JSON.stringify(refreshCreate)}`);
    } else if (!createdMethods.includes("flow_ext.hello") || !createdMethods.includes("flow_ext.add")) {
      // ← Finding #1 would land here (commands:[] / missing the new tools).
      fail(
        `ext lifecycle CREATE: refresh did not discover the new extension — ` +
          `expected flow_ext.hello + flow_ext.add, got [${createdMethods.join(", ")}] (Finding #1 regression?)`,
      );
    } else {
      pass(`ext lifecycle CREATE: refresh discovered flow_ext.hello + flow_ext.add (${createdMethods.length} cmds)`);
    }

    // extensions.list independently sees the same commands.
    const listed = (await bridge.call("extensions.list", {}, CALL_TIMEOUT)) as RefreshResult;
    if (methodsOf(listed).includes("flow_ext.hello"))
      pass("ext lifecycle CREATE: extensions.list includes flow_ext.hello");
    else fail(`ext lifecycle CREATE: extensions.list missing flow_ext.hello: [${methodsOf(listed).join(", ")}]`);

    // The discovered tools are callable over the bridge.
    const hello = (await bridge.call("flow_ext.hello", { name: "Flow" }, CALL_TIMEOUT)) as {
      success?: boolean;
      message?: string;
    };
    if (hello?.success === true && hello.message === "Hello, Flow!")
      pass("ext lifecycle CALL: flow_ext.hello -> greeting");
    else fail(`ext lifecycle CALL: flow_ext.hello: ${JSON.stringify(hello)}`);

    const add = (await bridge.call("flow_ext.add", { a: 3, b: 7 }, CALL_TIMEOUT)) as {
      success?: boolean;
      result?: number;
    };
    if (add?.success === true && add.result === 10) pass("ext lifecycle CALL: flow_ext.add(3,7) -> 10");
    else fail(`ext lifecycle CALL: flow_ext.add: ${JSON.stringify(add)}`);

    // ── PATH GUARD (41m-quater): declarative extension guard enforced at dispatch ──
    // flow_ext.guarded declared .guard_project_path("file_path"); the toolkit
    // dispatch must reject a traversal path with PATH_DENIED before the handler,
    // and allow a valid res:// path. This is the live end-to-end of the toolkit's
    // extension path-guard enforcement (server → bridge → command_registry).
    const guardBad = (await bridge.call("flow_ext.guarded", { file_path: "res://../escape.gd" }, CALL_TIMEOUT)) as {
      success?: boolean;
      code?: string;
    };
    if (guardBad?.success === false && guardBad.code === "PATH_DENIED")
      pass("ext lifecycle GUARD: flow_ext.guarded traversal -> PATH_DENIED (toolkit dispatch)");
    else fail(`ext lifecycle GUARD: expected PATH_DENIED, got ${JSON.stringify(guardBad)}`);
    const guardOk = (await bridge.call("flow_ext.guarded", { file_path: "res://ok.gd" }, CALL_TIMEOUT)) as {
      success?: boolean;
    };
    if (guardOk?.success === true) pass("ext lifecycle GUARD: flow_ext.guarded valid res:// -> allowed");
    else fail(`ext lifecycle GUARD: valid path should pass, got ${JSON.stringify(guardOk)}`);

    // ── RE-ENTRANCY: refresh with no changes → stable, no duplicates ───────
    const refreshAgain = (await bridge.call("extensions.refresh", {}, CALL_TIMEOUT)) as RefreshResult;
    const againMethods = methodsOf(refreshAgain);
    const helloCount = againMethods.filter((m) => m === "flow_ext.hello").length;
    if (refreshAgain?.success === true && helloCount === 1)
      pass("ext lifecycle RE-ENTRANCY: no-op refresh stable, no dupes");
    else
      fail(
        `ext lifecycle RE-ENTRANCY: expected single flow_ext.hello, got ${helloCount} in [${againMethods.join(", ")}]`,
      );

    // ── UPDATE-EXISTING (version-branched, decision #4) ────────────────────
    // Rewrite the SAME extension adding flow_ext.multiply. 4.3+ applies live;
    // 4.2 defers with a restart hint (CACHE_MODE_REUSE gate, 41l-tricies-ter).
    const writeV2 = (await bridge.call("script.write", { file_path: EXT_PATH, content: EXT_V2 }, CALL_TIMEOUT)) as {
      success?: boolean;
    };
    if (writeV2?.success !== true) {
      fail(`ext lifecycle UPDATE: script.write v2 failed: ${JSON.stringify(writeV2)}`);
    } else {
      pass("ext lifecycle UPDATE: script.write v2 (adds flow_ext.multiply)");
      await settleScan(ctx);
      const refreshUpdate = (await bridge.call("extensions.refresh", {}, CALL_TIMEOUT)) as RefreshResult;
      const updMethods = methodsOf(refreshUpdate);
      const hasMultiply = updMethods.includes("flow_ext.multiply");

      if (godotVer !== null && isVersionAtLeast(godotVer, "4.3")) {
        // 4.3+: edit applied live; multiply present + callable.
        if (!hasMultiply) {
          fail(
            `ext lifecycle UPDATE (4.3+): expected flow_ext.multiply live after refresh, got [${updMethods.join(", ")}]`,
          );
        } else {
          const mul = (await bridge.call("flow_ext.multiply", { a: 4, b: 5 }, CALL_TIMEOUT)) as {
            success?: boolean;
            result?: number;
          };
          if (mul?.success === true && mul.result === 20)
            pass("ext lifecycle UPDATE (4.3+): flow_ext.multiply(4,5) -> 20 live");
          else fail(`ext lifecycle UPDATE (4.3+): flow_ext.multiply call: ${JSON.stringify(mul)}`);
        }
      } else {
        // 4.2: edit deferred; multiply absent + restart hint present. Also
        // regression-guards the 4.2 REUSE gate (a regressed IGNORE-mid-scan
        // load would crash here instead).
        if (hasMultiply) {
          fail(`ext lifecycle UPDATE (4.2): expected flow_ext.multiply DEFERRED, but it appeared live`);
        } else if (typeof refreshUpdate?.hint === "string" && refreshUpdate.hint.length > 0) {
          pass(`ext lifecycle UPDATE (4.2): multiply deferred + restart hint present`);
        } else {
          fail(`ext lifecycle UPDATE (4.2): expected a restart hint, got ${JSON.stringify(refreshUpdate)}`);
        }
      }
    }

    // ── REMOVE → GONE (uniform across versions) ────────────────────────────
    const del = (await bridge.call("script.delete", { file_path: EXT_PATH }, CALL_TIMEOUT)) as { success?: boolean };
    if (del?.success !== true) {
      fail(`ext lifecycle REMOVE: script.delete failed: ${JSON.stringify(del)}`);
    } else {
      pass("ext lifecycle REMOVE: script.delete extension");
      await settleScan(ctx);
      const refreshRemove = (await bridge.call("extensions.refresh", {}, CALL_TIMEOUT)) as RefreshResult;
      const remMethods = methodsOf(refreshRemove);
      if (refreshRemove?.success === true && !remMethods.some((m) => m.startsWith("flow_ext."))) {
        pass("ext lifecycle REMOVE: refresh -> all flow_ext.* gone");
      } else {
        fail(`ext lifecycle REMOVE: expected flow_ext.* gone, got [${remMethods.join(", ")}]`);
      }

      // Calling a removed tool errors cleanly (NOT a crash). An unregistered
      // method surfaces as a thrown JSON-RPC -32601 "Method not found" (the
      // bridge rejects unknown methods before they reach a handler); a handler
      // that still exists but refuses returns a {success:false} envelope.
      // Either is the clean "handler gone" signal — only a crash/timeout fails.
      try {
        const ghost = (await bridge.call("flow_ext.hello", { name: "ghost" }, CALL_TIMEOUT)) as {
          success?: boolean;
          code?: string;
        };
        if (ghost?.success === false)
          pass(`ext lifecycle REMOVE: calling removed flow_ext.hello -> error (${ghost.code ?? "rejected"}), no crash`);
        else fail(`ext lifecycle REMOVE: removed tool should error, got ${JSON.stringify(ghost)}`);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (msg.includes("-32601") || /method not found/i.test(msg)) {
          pass("ext lifecycle REMOVE: calling removed flow_ext.hello -> JSON-RPC method-not-found (clean, no crash)");
        } else {
          fail(`ext lifecycle REMOVE: removed tool threw unexpected error: ${msg}`);
        }
      }
    }
  } finally {
    // Guaranteed cleanup — leave the toolkit working tree clean.
    try {
      await bridge.call("script.delete", { file_path: EXT_PATH }, CALL_TIMEOUT);
    } catch {
      /* already gone */
    }
    await cleanupProbeDir(ctx);
    try {
      await bridge.call("extensions.refresh", {}, CALL_TIMEOUT);
    } catch {
      /* best-effort */
    }
  }
}

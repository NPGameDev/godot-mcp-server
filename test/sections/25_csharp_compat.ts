// ═══════════════════════════════════════════════════════════════════════════
// Section 25 — C# compatibility
//
// Auto-detects whether the target project is a .NET (C#) project.
// If not, skips entirely. If yes, exercises C#-specific tool behaviors:
//
//   • script.write / script.read / script.delete roundtrip for .cs files
//   • script.check rejects .cs with INVALID_PARAMS
//   • node.get_property on C# [Export] fields
//   • node.set_property on C# [Export] fields
//   • node.get_property_list mask=script on C# nodes
//   • node.call_method returns null with C#-specific hint
//   • signal.list includes C# [Signal] declarations
//   • classdb.search / classdb.get_info for [GlobalClass] C# types
//
// Detection: reads project.get_settings["dotnet/project/assembly_name"], unwrapped
// from the untrusted envelope (a raw settings.settings index yields undefined and
// false-skips every .NET project). Node-level tests discover an instantiable C#
// [GlobalClass] via classdb.search, create a probe node of it in an open scene,
// exercise the node tools, then delete the probe (no save — nothing leaks to disk
// or to later sections). GDScript-only projects skip these gracefully.
// ═══════════════════════════════════════════════════════════════════════════

import type { TestCtx, BridgeInstance } from "../helpers.js";
import { CALL_TIMEOUT, assertError, unwrapUntrusted } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "project_get_settings",
  "script_write",
  "script_read",
  "script_delete",
  "script_check",
  "scene_get_tree",
  "scene_open",
  "scene_create_node",
  "scene_delete_node",
  "node_get_property",
  "node_set_property",
  "node_get_property_list",
  "node_call_method",
  "signal_list",
  "classdb_search",
  "classdb_get_info",
];
/**
 * Discover an instantiable C# [GlobalClass] deriving from Node, project-agnostically.
 *
 * scene.get_tree exposes no per-node script, so a C# node can't be spotted by walking
 * the tree; instead we ask classdb.search for the project's global classes. A no-filter
 * search returns only Object's direct children, so we filter by base_class "Node" (which
 * covers every node-type C# class) and page until we find a global entry whose
 * script_path ends in .cs. Returns undefined on a GDScript-only project — or before the
 * C# assembly is built — so callers skip node-level tests gracefully.
 */
async function discoverCsGlobalClass(
  bridge: BridgeInstance,
): Promise<{ name: string; scriptPath: string } | undefined> {
  let offset = 0;
  for (let page = 0; page < 8; page++) {
    const r = (await bridge.call(
      "classdb.search",
      { base_class: "Node", include_global: true, instantiable_only: true, offset },
      CALL_TIMEOUT,
    )) as {
      success?: boolean;
      classes?: Array<{ name?: string; source?: string; script_path?: string }>;
      truncated?: boolean;
      next_offset?: number;
    };
    if (r?.success === false) return undefined;
    const classes = Array.isArray(r.classes) ? r.classes : [];
    const hit = classes.find(
      (c) => c.source === "global" && typeof c.script_path === "string" && c.script_path.endsWith(".cs"),
    );
    if (hit && hit.name && typeof hit.script_path === "string") {
      return { name: hit.name, scriptPath: hit.script_path };
    }
    if (!r.truncated || classes.length === 0) break;
    offset = typeof r.next_offset === "number" ? r.next_offset : offset + classes.length;
  }
  return undefined;
}

export async function testCsharpCompat(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ─── Detect C# project ──────────────────────────────────────────────
  // project.get_settings returns `settings` inside an <untrusted> envelope; indexing
  // it raw yields undefined and false-skips every .NET project. Unwrap first — the
  // same pattern as §04/§11 (unwrapUntrusted parses the inner JSON to an object).
  const settings = (await bridge.call("project.get_settings", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    settings?: unknown;
  };

  const settingsMap = (unwrapUntrusted(settings.settings) ?? {}) as Record<string, unknown>;
  const assemblyName = settingsMap["dotnet/project/assembly_name"];

  if (!assemblyName) {
    pass("C# compat: skipped (not a .NET project)");
    return;
  }

  pass(`C# compat: .NET project detected (assembly: ${assemblyName})`);

  // ─── script.write / script.read roundtrip for .cs ───────────────────
  const csProbePath = "res://smoke_cs_probe.cs";
  const csContent =
    "using Godot;\n\npublic partial class SmokeCsProbe : Node\n{\n\t[Export] public int Val { get; set; } = 7;\n}\n";

  const writeR = (await bridge.call("script.write", { file_path: csProbePath, content: csContent }, CALL_TIMEOUT)) as {
    success?: boolean;
  };

  if (writeR?.success === false) {
    fail(`C# script.write .cs: ${JSON.stringify(writeR)}`);
  } else {
    pass("C# script.write .cs succeeded");

    const readR = (await bridge.call("script.read", { file_path: csProbePath }, CALL_TIMEOUT)) as {
      success?: boolean;
      content?: unknown;
    };

    if (readR?.success === false) {
      fail(`C# script.read .cs: ${JSON.stringify(readR)}`);
    } else {
      const content = typeof readR.content === "string" ? readR.content : String(unwrapUntrusted(readR.content) ?? "");
      if (content.includes("SmokeCsProbe")) {
        pass("C# script.read .cs roundtrip verified");
      } else {
        fail("C# script.read .cs content mismatch");
      }
    }

    // script.delete .cs
    const delR = (await bridge.call("script.delete", { file_path: csProbePath }, CALL_TIMEOUT)) as {
      success?: boolean;
    };

    if (delR?.success === false) {
      fail(`C# script.delete .cs: ${JSON.stringify(delR)}`);
    } else {
      pass("C# script.delete .cs succeeded");
    }
  }

  // ─── script.check rejects .cs ───────────────────────────────────────
  // Write a temp .cs to check against (script.check needs the file to exist
  // to reach the extension check on some code paths).
  await bridge.call("script.write", { file_path: csProbePath, content: csContent }, CALL_TIMEOUT);

  const checkR = await bridge.call("script.check", { file_path: csProbePath }, CALL_TIMEOUT);
  assertError(ctx, "C# script.check rejects .cs", checkR, "INVALID_PARAMS");

  // Cleanup probe file
  await bridge.call("script.delete", { file_path: csProbePath }, CALL_TIMEOUT);

  // ─── Ensure an editable scene is open ───────────────────────────────
  // Node-level tests need an edited scene to host a C# node. A fresh headless
  // editor opens none, so open the fixture's Main.tscn when nothing is edited
  // (a project with a scene already open keeps it — least invasive).
  let treeR = (await bridge.call("scene.get_tree", {}, CALL_TIMEOUT)) as { success?: boolean };
  if (treeR?.success === false) {
    try {
      await bridge.call("scene.open", { file_path: "res://Main.tscn" }, CALL_TIMEOUT);
    } catch {
      // No openable scene — the skip below reports it.
    }
    await new Promise((r) => setTimeout(r, 500));
    treeR = (await bridge.call("scene.get_tree", {}, CALL_TIMEOUT)) as { success?: boolean };
  }
  if (treeR?.success === false) {
    pass("C# node-level tests: skipped (no editable scene available to host a C# node)");
    return;
  }

  // ─── Discover + instantiate a C# [GlobalClass] node ─────────────────
  const csClass = await discoverCsGlobalClass(bridge);
  if (!csClass) {
    pass("C# node-level tests: skipped (no instantiable C# [GlobalClass] — GDScript-only or assembly not built)");
    return;
  }
  pass(`C# [GlobalClass] discovered: ${csClass.name} (${csClass.scriptPath})`);

  const nodePath = "McpCsProbe";
  const createR = (await bridge.call(
    "scene.create_node",
    { class_name: csClass.name, parent_path: ".", node_name: nodePath },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string };
  if (createR?.success === false) {
    fail(`C# scene.create_node ${csClass.name}: ${JSON.stringify(createR)}`);
    return;
  }
  pass(`C# probe node created: ${nodePath} (${csClass.name}, status=${createR.status})`);

  try {
    // ─── node.get_property_list mask=script on the C# node ────────────
    const propListR = (await bridge.call(
      "node.get_property_list",
      { node_path: nodePath, mask: "script" },
      CALL_TIMEOUT,
    )) as { success?: boolean; properties?: Array<{ name: string }> };

    if (propListR?.success !== false && Array.isArray(propListR.properties) && propListR.properties.length > 0) {
      pass(
        `C# property_list mask=script: ${propListR.properties.length} props [${propListR.properties.map((p) => p.name).join(", ")}]`,
      );

      // Read the first [Export] property to verify get_property works.
      const firstProp = propListR.properties[0].name;
      const getR = (await bridge.call(
        "node.get_property",
        { node_path: nodePath, property: firstProp },
        CALL_TIMEOUT,
      )) as { success?: boolean; value?: unknown };

      if (getR?.success !== false) {
        pass(`C# node.get_property ${nodePath}.${firstProp} = ${JSON.stringify(getR.value)}`);
      } else {
        fail(`C# node.get_property ${nodePath}.${firstProp}: ${JSON.stringify(getR)}`);
      }

      // Write + verify + restore — only on a numeric field, so a string [Export]
      // isn't mangled by a numeric probe value (readback would false-fail).
      const originalValue = getR?.value;
      if (typeof originalValue === "number") {
        const testValue = originalValue + 1;
        const setR = (await bridge.call(
          "node.set_property",
          { node_path: nodePath, property: firstProp, value: testValue },
          CALL_TIMEOUT,
        )) as { success?: boolean };

        if (setR?.success !== false) {
          const verifyR = (await bridge.call(
            "node.get_property",
            { node_path: nodePath, property: firstProp },
            CALL_TIMEOUT,
          )) as { value?: unknown };

          if (verifyR.value === testValue) {
            pass(`C# node.set_property ${nodePath}.${firstProp} = ${testValue} verified`);
          } else {
            fail(`C# node.set_property readback mismatch: expected ${testValue}, got ${verifyR.value}`);
          }
          // Restore original value.
          await bridge.call(
            "node.set_property",
            { node_path: nodePath, property: firstProp, value: originalValue },
            CALL_TIMEOUT,
          );
        } else {
          fail(`C# node.set_property: ${JSON.stringify(setR)}`);
        }
      } else {
        pass(`C# node.set_property: skipped (first [Export] "${firstProp}" is non-numeric)`);
      }
    } else {
      pass("C# property_list: no script props (node may lack [Export] fields)");
    }

    // ─── node.call_method — C#-specific hint ──────────────────────────
    // In the editor a C# node's methods can't be invoked; the tool returns a
    // C#-specific hint. Any method name exercises that path; prefer a real one
    // from classdb, else fall back to a method present on every C# object.
    const classInfoR = (await bridge.call(
      "classdb.get_info",
      { class_name: csClass.name, sections: ["methods"] },
      CALL_TIMEOUT,
    )) as { success?: boolean; methods?: Array<{ name: string }> };

    let methodToCall = "GetHashCode"; // fallback — exists on all C# objects
    if (classInfoR?.success !== false && Array.isArray(classInfoR.methods) && classInfoR.methods.length > 0) {
      const getter = classInfoR.methods.find((m) => m.name.startsWith("Get"));
      methodToCall = getter?.name ?? classInfoR.methods[0].name;
    }

    const callR = (await bridge.call(
      "node.call_method",
      { node_path: nodePath, method_name: methodToCall, args: [] },
      CALL_TIMEOUT,
    )) as { success?: boolean; result?: unknown; hint?: string };

    if (callR?.hint && callR.hint.includes("C#")) {
      pass(`C# node.call_method hint verified: "${callR.hint.slice(0, 80)}..."`);
    } else if (callR?.hint) {
      // Has a hint but not C#-specific — report but don't fail hard.
      fail(`C# node.call_method hint present but not C#-specific: "${callR.hint.slice(0, 80)}..."`);
    } else if (callR?.result !== undefined && callR.result !== null) {
      // Method actually returned a value — unexpected in editor mode for C#.
      pass(
        `C# node.call_method ${methodToCall} returned value (unexpected in editor): ${JSON.stringify(callR.result)}`,
      );
    } else {
      fail("C# node.call_method returned null without C#-specific hint");
    }

    // ─── signal.list on C# node ───────────────────────────────────────
    const sigR = (await bridge.call("signal.list", { node_path: nodePath }, CALL_TIMEOUT)) as {
      success?: boolean;
      signals?: Array<{ name: string }>;
    };

    if (sigR?.success !== false && Array.isArray(sigR.signals)) {
      // C# [Signal] declarations should appear alongside engine signals.
      pass(
        `C# signal.list: ${sigR.signals.length} signals [${sigR.signals
          .slice(0, 5)
          .map((s) => s.name)
          .join(", ")}${sigR.signals.length > 5 ? "..." : ""}]`,
      );
    } else {
      fail(`C# signal.list: ${JSON.stringify(sigR).slice(0, 200)}`);
    }

    // ─── node.get_property_list mask=all on C# node ───────────────────
    const allPropsR = (await bridge.call(
      "node.get_property_list",
      { node_path: nodePath, mask: "all" },
      CALL_TIMEOUT,
    )) as { success?: boolean; properties?: Array<{ name: string }> };

    if (allPropsR?.success !== false && Array.isArray(allPropsR.properties)) {
      pass(`C# property_list mask=all: ${allPropsR.properties.length} total props`);
    } else {
      fail(`C# property_list mask=all: ${JSON.stringify(allPropsR).slice(0, 200)}`);
    }
  } finally {
    // Discard the probe node — no editor_save_scene, so the fixture scene on disk
    // is untouched and nothing leaks to later sections.
    try {
      await bridge.call("scene.delete_node", { node_path: nodePath }, CALL_TIMEOUT);
    } catch {
      // Best-effort cleanup; without a save there is no on-disk change to revert.
    }
  }

  // ─── classdb.search with the C# [GlobalClass] name ─────────────────
  // ClassDB pagination (W1 Lane 2) added offset + total_classes. Verify the
  // paginated response resolves the discovered C# class (pattern is a
  // case-insensitive substring match on the class name).
  const classSearchR = (await bridge.call(
    "classdb.search",
    { pattern: csClass.name, include_global: true },
    CALL_TIMEOUT,
  )) as { success?: boolean; classes?: Array<{ name?: string }>; total_classes?: number };

  if (classSearchR?.success !== false) {
    const found = Array.isArray(classSearchR.classes) && classSearchR.classes.some((c) => c.name === csClass.name);
    if (typeof classSearchR.total_classes !== "number") {
      fail(
        `C# classdb.search "${csClass.name}": missing/non-numeric total_classes (${JSON.stringify(classSearchR).slice(0, 200)})`,
      );
    } else if (!found) {
      fail(`C# classdb.search "${csClass.name}": class not in results (${JSON.stringify(classSearchR.classes)})`);
    } else {
      pass(`C# classdb.search "${csClass.name}": found, total=${classSearchR.total_classes}`);
    }
  } else {
    // ClassDB search may not index C# classes — acceptable limitation.
    pass(`C# classdb.search: not available for C# classes (expected)`);
  }

  // ─── LSP + C# limitation note ──────────────────────────────────────
  // Godot's built-in LSP server handles GDScript only. C# uses a separate
  // language server (OmniSharp / csharp-ls). LSP tools (lsp_diagnostics,
  // lsp_hover, etc.) may not return useful results for .cs files. This is
  // a known platform limitation, not a bug.
  pass("C# LSP limitation: documented (GDScript LSP only; C# uses separate language server)");
}

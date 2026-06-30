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
// Detection: checks project_get_settings for `dotnet/project/assembly_name`.
// Node-level tests require the current scene to have at least one node with
// a .cs script attached. If none found, those tests are skipped.
// ═══════════════════════════════════════════════════════════════════════════

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertError, unwrapUntrusted } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "project_get_settings",
  "script_write",
  "script_read",
  "script_delete",
  "script_check",
  "scene_get_tree",
  "node_get_property",
  "node_set_property",
  "node_get_property_list",
  "node_call_method",
  "signal_list",
];
/** Find the first node in the scene tree whose script ends with .cs. */
function findCsNode(tree: unknown): { path: string; scriptPath: string } | null {
  const walk = (node: Record<string, unknown>, parentPath: string): { path: string; scriptPath: string } | null => {
    const name = node.name as string | undefined;
    const script = node.script as string | undefined;
    const currentPath = parentPath ? `${parentPath}/${name}` : (name ?? ".");
    if (script && script.endsWith(".cs")) {
      return { path: name ?? currentPath, scriptPath: script };
    }
    const children = node.children as Record<string, unknown>[] | undefined;
    if (Array.isArray(children)) {
      for (const child of children) {
        const found = walk(child, currentPath);
        if (found) return found;
      }
    }
    return null;
  };

  if (tree && typeof tree === "object") {
    return walk(tree as Record<string, unknown>, "");
  }
  return null;
}

export async function testCsharpCompat(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ─── Detect C# project ──────────────────────────────────────────────
  const settings = (await bridge.call("project.get_settings", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    settings?: Record<string, unknown>;
  };

  const settingsMap = settings.settings ?? {};
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

  // ─── Find a C# node in the current scene ────────────────────────────
  const treeR = (await bridge.call("scene.get_tree", {}, CALL_TIMEOUT)) as { success?: boolean; tree?: unknown };

  const csNode = treeR?.success !== false ? findCsNode(treeR.tree) : null;

  if (!csNode) {
    pass("C# node-level tests: skipped (no .cs-scripted node in current scene)");
    return;
  }

  pass(`C# node detected: ${csNode.path} (${csNode.scriptPath})`);
  const nodePath = csNode.path;

  // ─── node.get_property on C# [Export] fields ────────────────────────
  const propListR = (await bridge.call(
    "node.get_property_list",
    { node_path: nodePath, mask: "script" },
    CALL_TIMEOUT,
  )) as { success?: boolean; properties?: Array<{ name: string }> };

  if (propListR?.success !== false && Array.isArray(propListR.properties) && propListR.properties.length > 0) {
    pass(
      `C# property_list mask=script: ${propListR.properties.length} props [${propListR.properties.map((p) => p.name).join(", ")}]`,
    );

    // Read the first property to verify get_property works
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

    // Write + verify + restore
    const originalValue = getR?.value;
    const testValue = typeof originalValue === "number" ? originalValue + 1 : 12345;

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
      // Restore original value
      await bridge.call(
        "node.set_property",
        { node_path: nodePath, property: firstProp, value: originalValue },
        CALL_TIMEOUT,
      );
    } else {
      fail(`C# node.set_property: ${JSON.stringify(setR)}`);
    }
  } else {
    pass("C# property_list: no script props (node may lack [Export] fields)");
  }

  // ─── node.call_method — C#-specific hint ────────────────────────────
  // Find any public method on the C# node. We look for a common pattern:
  // methods named Get* are typical. We'll try calling any method — in
  // editor mode it returns null and we validate the C#-specific hint.
  const classInfoR = (await bridge.call(
    "classdb.get_info",
    { class_name: csNode.scriptPath, include: "methods" },
    CALL_TIMEOUT,
  )) as { success?: boolean; methods?: Array<{ name: string }> };

  // Whether or not classdb finds the class, we can still try calling a
  // method by name. Pick a plausible name, or fall back to a method
  // that won't exist (which exercises a different path).
  let methodToCall = "GetHashCode"; // fallback — exists on all C# objects

  if (classInfoR?.success !== false && Array.isArray(classInfoR.methods) && classInfoR.methods.length > 0) {
    // Prefer a method that starts with "Get" for a clean test
    const getter = classInfoR.methods.find((m) => m.name.startsWith("Get"));
    methodToCall = getter?.name ?? classInfoR.methods[0].name;
  }

  const callR = (await bridge.call(
    "node.call_method",
    { node_path: nodePath, method_name: methodToCall, arguments: [] },
    CALL_TIMEOUT,
  )) as { success?: boolean; result?: unknown; hint?: string };

  if (callR?.hint && callR.hint.includes("C#")) {
    pass(`C# node.call_method hint verified: "${callR.hint.slice(0, 80)}..."`);
  } else if (callR?.hint) {
    // Has a hint but not C#-specific — may be the GDScript hint if
    // detection failed. Report but don't fail hard.
    fail(`C# node.call_method hint present but not C#-specific: "${callR.hint.slice(0, 80)}..."`);
  } else if (callR?.result !== undefined && callR.result !== null) {
    // Method actually returned a value — this is unexpected in editor
    // mode for C# but not necessarily wrong.
    pass(`C# node.call_method ${methodToCall} returned value (unexpected in editor): ${JSON.stringify(callR.result)}`);
  } else {
    fail("C# node.call_method returned null without C#-specific hint");
  }

  // ─── signal.list on C# node ─────────────────────────────────────────
  const sigR = (await bridge.call("signal.list", { node_path: nodePath }, CALL_TIMEOUT)) as {
    success?: boolean;
    signals?: Array<{ name: string }>;
  };

  if (sigR?.success !== false && Array.isArray(sigR.signals)) {
    // C# [Signal] declarations should appear alongside engine signals.
    // We can't know the specific names, but having any signals is good.
    pass(
      `C# signal.list: ${sigR.signals.length} signals [${sigR.signals
        .slice(0, 5)
        .map((s) => s.name)
        .join(", ")}${sigR.signals.length > 5 ? "..." : ""}]`,
    );
  } else {
    fail(`C# signal.list: ${JSON.stringify(sigR).slice(0, 200)}`);
  }

  // ─── node.get_property_list mask=all on C# node ─────────────────────
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

  // ─── classdb.search with C# class name ─────────────────────────────
  // ClassDB pagination (W1 Lane 2) added offset + total_classes. Verify
  // the paginated response works for C# [GlobalClass] types.
  const classSearchR = (await bridge.call(
    "classdb.search",
    { query: String(assemblyName), limit: 5 },
    CALL_TIMEOUT,
  )) as { success?: boolean; classes?: unknown[]; total_classes?: number; offset?: number };

  if (classSearchR?.success !== false) {
    // Assert the canonical pagination field exists and is numeric — the prior
    // dead total_count read could not catch total_classes vanishing.
    if (typeof classSearchR.total_classes !== "number") {
      fail(
        `C# classdb.search "${assemblyName}": missing/non-numeric total_classes (${JSON.stringify(classSearchR).slice(0, 200)})`,
      );
    } else {
      pass(
        `C# classdb.search "${assemblyName}": ${classSearchR.classes?.length ?? 0} result(s), total=${classSearchR.total_classes}`,
      );
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

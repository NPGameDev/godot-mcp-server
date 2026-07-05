// ═══════════════════════════════════════════════════════════════════════════
// C# compatibility audit
//
// Tests every MCP tool that interacts with scripts/classes/properties against
// a Godot project with C# scripts. Run with the C# test project open in a
// Godot .NET editor (plugin enabled, C# solution built).
//
// Usage:
//   cd <server-repo>
//   GODOT_MCP_PROJECT_NAME="CSharp MCP Test" node_modules/.bin/tsx test/csharp-audit.ts
//
// Exit codes: 0 = all passed, 1 = failures, 2 = precondition failure.
// ═══════════════════════════════════════════════════════════════════════════

import { createBridge } from "../src/transport/bridge.js";
import { registryPath } from "../src/registry.js";
import { readFileSync } from "node:fs";
import {
  HOST,
  PORT,
  RUNTIME_PORT,
  PROBE_TIMEOUT_MS,
  CALL_TIMEOUT,
  probePort,
  printUnreachable,
  unwrapUntrusted,
} from "./helpers.js";

// ─── Counters ────────────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
let skipCount = 0;

function pass(msg: string): void {
  passCount++;
  console.log(`  PASS  ${msg}`);
}
function fail(msg: string): void {
  failCount++;
  console.error(`  FAIL  ${msg}`);
}
function skip(msg: string): void {
  skipCount++;
  console.log(`  SKIP  ${msg}`);
}

function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 56 - title.length))}`);
}

function discoverProjectPath(): string | undefined {
  const envPath = process.env.GODOT_MCP_PROJECT_PATH;
  if (envPath) return envPath;
  try {
    const data = JSON.parse(readFileSync(registryPath(), "utf-8")) as {
      by_path?: Record<string, { port?: number }>;
    };
    for (const [path, entry] of Object.entries(data.by_path ?? {})) {
      if (entry.port === PORT) return path;
    }
  } catch {
    /* Registry unreadable */
  }
  return undefined;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  C# Compatibility Audit");
  console.log("═══════════════════════════════════════════════════════════");

  const reachable = await probePort(HOST, PORT, PROBE_TIMEOUT_MS);
  if (!reachable) {
    printUnreachable();
    process.exit(2);
  }

  const projectPath = discoverProjectPath();
  const bridge = createBridge(`ws://${HOST}:${PORT}`, {
    projectPath,
    explicitRuntimePort: String(RUNTIME_PORT),
  });

  // Ensure Main.tscn is open so node paths resolve.
  try {
    await bridge.call("scene.open", { file_path: "res://Main.tscn" }, CALL_TIMEOUT);
  } catch {
    /* may already be open */
  }
  // Small settle delay
  await new Promise((r) => setTimeout(r, 500));

  // ──────────────────────────────────────────────────────────────────────
  section("1. Scene tree — C# nodes appear correctly");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const tree = (await bridge.call("scene.get_tree", {}, CALL_TIMEOUT)) as {
      success?: boolean;
      tree?: unknown;
    };
    if (tree.success !== false) {
      const treeStr = JSON.stringify(tree);
      if (treeStr.includes("Player") && treeStr.includes("Spawner")) {
        pass("scene.get_tree returns C# scripted nodes (Player, Spawner)");
      } else {
        fail(`scene.get_tree missing expected nodes: ${treeStr.slice(0, 300)}`);
      }
    } else {
      fail(`scene.get_tree failed: ${JSON.stringify(tree)}`);
    }
  } catch (e) {
    fail(`scene.get_tree threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("2. node.get_property — read C# [Export] fields");
  // ──────────────────────────────────────────────────────────────────────
  for (const [prop, expected] of [
    ["Speed", 200],
    ["MaxHealth", 100],
    ["PlayerName", "Player"],
  ] as const) {
    try {
      const r = (await bridge.call("node.get_property", { node_path: "Player", property: prop }, CALL_TIMEOUT)) as {
        success?: boolean;
        value?: unknown;
      };
      if (r.success !== false && r.value !== undefined) {
        if (r.value == expected) {
          pass(`node.get_property Player.${prop} = ${JSON.stringify(r.value)}`);
        } else {
          fail(
            `node.get_property Player.${prop}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(r.value)}`,
          );
        }
      } else {
        fail(`node.get_property Player.${prop}: ${JSON.stringify(r)}`);
      }
    } catch (e) {
      fail(`node.get_property Player.${prop} threw: ${e}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  section("3. node.set_property — write C# [Export] fields");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call(
      "node.set_property",
      { node_path: "Player", property: "Speed", value: 999 },
      CALL_TIMEOUT,
    )) as { success?: boolean };
    if (r.success !== false) {
      // Verify it took effect
      const check = (await bridge.call(
        "node.get_property",
        { node_path: "Player", property: "Speed" },
        CALL_TIMEOUT,
      )) as { value?: unknown };
      if (check.value === 999 || check.value === 999.0) {
        pass("node.set_property Player.Speed = 999 → verified");
      } else {
        fail(`node.set_property set but readback is ${check.value}`);
      }
      // Restore
      await bridge.call("node.set_property", { node_path: "Player", property: "Speed", value: 200 }, CALL_TIMEOUT);
    } else {
      fail(`node.set_property failed: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`node.set_property threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("4. node.get_property_list — C# properties in full list");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call("node.get_property_list", { node_path: "Player", mask: "all" }, CALL_TIMEOUT)) as {
      success?: boolean;
      properties?: Array<{ name: string }>;
    };
    if (r.success !== false && Array.isArray(r.properties)) {
      const names = r.properties.map((p) => p.name);
      const hasSpeed = names.includes("Speed");
      const hasMaxHealth = names.includes("MaxHealth");
      const hasPlayerName = names.includes("PlayerName");
      if (hasSpeed && hasMaxHealth && hasPlayerName) {
        pass(`node.get_property_list mask=all includes C# [Export] props (${names.length} total)`);
      } else {
        fail(
          `node.get_property_list mask=all missing C# props. Has Speed=${hasSpeed}, MaxHealth=${hasMaxHealth}, PlayerName=${hasPlayerName}. Names: [${names.join(", ")}]`,
        );
      }
    } else {
      fail(`node.get_property_list failed: ${JSON.stringify(r).slice(0, 300)}`);
    }
  } catch (e) {
    fail(`node.get_property_list threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("5. node.get_property_list mask='script' — C# script vars");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call("node.get_property_list", { node_path: "Player", mask: "script" }, CALL_TIMEOUT)) as {
      success?: boolean;
      properties?: Array<{ name: string; visibility?: string }>;
    };
    if (r.success !== false && Array.isArray(r.properties)) {
      const names = r.properties.map((p) => p.name);
      const len = r.properties.length;
      pass(`node.get_property_list mask=script returned ${len} props: [${names.join(", ")}]`);
      // All should be "public" since C# private fields don't appear in Godot's property list
      const allPublic = r.properties.every((p) => p.visibility === "public" || !p.visibility);
      if (allPublic) {
        pass("All C# script vars classified as public (expected — Godot hides privates)");
      } else {
        pass(`Some C# props have non-public visibility — unexpected but informational`);
      }
    } else {
      fail(`node.get_property_list mask=script failed: ${JSON.stringify(r).slice(0, 300)}`);
    }
  } catch (e) {
    fail(`node.get_property_list mask=script threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("6. node.call_method — call C# public methods");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call(
      "node.call_method",
      { node_path: "Player", method_name: "GetCurrentHealth", arguments: [] },
      CALL_TIMEOUT,
    )) as { success?: boolean; return_value?: unknown };
    if (r.success !== false) {
      pass(`node.call_method Player.GetCurrentHealth() = ${JSON.stringify(r.return_value)}`);
    } else {
      fail(`node.call_method Player.GetCurrentHealth() failed: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`node.call_method threw: ${e}`);
  }

  try {
    const r = (await bridge.call(
      "node.call_method",
      { node_path: "Player/Health", method_name: "GetHealth", arguments: [] },
      CALL_TIMEOUT,
    )) as { success?: boolean; return_value?: unknown };
    if (r.success !== false) {
      pass(`node.call_method Health.GetHealth() = ${JSON.stringify(r.return_value)}`);
    } else {
      fail(`node.call_method Health.GetHealth() failed: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`node.call_method Health.GetHealth() threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("7. signal.list — C# [Signal] declarations");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call("signal.list", { node_path: "Player" }, CALL_TIMEOUT)) as {
      success?: boolean;
      signals?: Array<{ name: string }>;
    };
    if (r.success !== false && Array.isArray(r.signals)) {
      const names = r.signals.map((s) => s.name);
      const hasHealthChanged = names.includes("HealthChanged");
      const hasPlayerDied = names.includes("PlayerDied");
      if (hasHealthChanged && hasPlayerDied) {
        pass("signal.list includes C# signals (HealthChanged, PlayerDied)");
      } else {
        fail(`signal.list missing C# signals. Got: [${names.join(", ")}]`);
      }
    } else {
      fail(`signal.list failed: ${JSON.stringify(r).slice(0, 300)}`);
    }
  } catch (e) {
    fail(`signal.list threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("8. script.read — read .cs file content");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call("script.read", { file_path: "res://scripts/PlayerController.cs" }, CALL_TIMEOUT)) as {
      success?: boolean;
      content?: string;
    };
    if (r.success !== false) {
      const content = typeof r.content === "string" ? r.content : String(unwrapUntrusted(r.content) ?? "");
      if (content.includes("public partial class PlayerController")) {
        pass("script.read returns .cs content correctly");
      } else {
        fail(`script.read returned content but missing expected C# class declaration`);
      }
    } else {
      fail(`script.read .cs failed: ${JSON.stringify(r).slice(0, 300)}`);
    }
  } catch (e) {
    fail(`script.read threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("9. script.write — write .cs file");
  // ──────────────────────────────────────────────────────────────────────
  const testCsPath = "res://scripts/TestWritten.cs";
  const testCsContent = `using Godot;\n\npublic partial class TestWritten : Node\n{\n\t[Export] public string TestProp { get; set; } = "hello";\n}\n`;
  try {
    const r = (await bridge.call("script.write", { file_path: testCsPath, content: testCsContent }, CALL_TIMEOUT)) as {
      success?: boolean;
    };
    if (r.success !== false) {
      pass("script.write .cs file succeeded");
      // Verify content
      const readBack = (await bridge.call("script.read", { file_path: testCsPath }, CALL_TIMEOUT)) as {
        content?: string;
      };
      const raw =
        typeof readBack.content === "string" ? readBack.content : String(unwrapUntrusted(readBack.content) ?? "");
      if (raw.includes("TestWritten")) {
        pass("script.write + script.read roundtrip .cs verified");
      } else {
        fail("script.write roundtrip — read content doesn't match");
      }
      // Cleanup
      await bridge.call("file.delete", { file_path: testCsPath }, CALL_TIMEOUT);
    } else {
      fail(`script.write .cs failed: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`script.write threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("10. script.check — must reject .cs with clear error");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call("script.check", { file_path: "res://scripts/PlayerController.cs" }, CALL_TIMEOUT)) as {
      success?: boolean;
      error?: string;
      code?: string;
    };
    if (r.success === false) {
      const msg = r.error ?? "";
      if (msg.includes(".gd") || r.code === "INVALID_PATH" || r.code === "INVALID_PARAMS") {
        pass(`script.check rejects .cs correctly: ${r.code} — "${msg}"`);
      } else {
        fail(`script.check rejected .cs but message unclear: ${JSON.stringify(r)}`);
      }
    } else {
      fail(`script.check should have rejected .cs file but returned success: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`script.check threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("11. node.set_script — attach .cs script to node");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call(
      "node.set_script",
      { node_path: "UnscriptedNode", script_path: "res://scripts/HealthComponent.cs" },
      CALL_TIMEOUT,
    )) as { success?: boolean; exports?: unknown };
    if (r.success !== false) {
      pass(`node.set_script attached .cs to UnscriptedNode: exports=${JSON.stringify(r.exports)}`);
      // Detach to clean up
      await bridge.call("node.set_script", { node_path: "UnscriptedNode", script_path: "" }, CALL_TIMEOUT);
    } else {
      fail(`node.set_script .cs failed: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`node.set_script threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("12. editor.refresh — with C# scripts present");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call("editor.refresh", {}, CALL_TIMEOUT)) as {
      success?: boolean;
      reloaded?: number;
    };
    if (r.success !== false) {
      pass(`editor.refresh succeeded (reloaded: ${r.reloaded ?? "unknown"})`);
    } else {
      fail(`editor.refresh failed: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`editor.refresh threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("13. classdb.get_info — [GlobalClass] C# class");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call(
      "classdb.get_info",
      { class_name: "EnemySpawner", include: "properties,methods,signals" },
      CALL_TIMEOUT,
    )) as { success?: boolean; properties?: unknown[]; methods?: unknown[]; signals?: unknown[] };
    if (r.success !== false) {
      pass(
        `classdb.get_info EnemySpawner: ${(r.properties as unknown[])?.length ?? 0} props, ` +
          `${(r.methods as unknown[])?.length ?? 0} methods, ${(r.signals as unknown[])?.length ?? 0} signals`,
      );
    } else {
      // Expected if GlobalClass doesn't appear in ClassDB
      fail(`classdb.get_info EnemySpawner failed: ${JSON.stringify(r).slice(0, 300)}`);
    }
  } catch (e) {
    fail(`classdb.get_info threw: ${e}`);
  }

  // Also try a built-in class for comparison
  try {
    const r = (await bridge.call(
      "classdb.get_info",
      { class_name: "CharacterBody2D", include: "properties" },
      CALL_TIMEOUT,
    )) as { success?: boolean; properties?: unknown[] };
    if (r.success !== false) {
      pass(`classdb.get_info CharacterBody2D (baseline): ${(r.properties as unknown[])?.length ?? 0} props`);
    } else {
      fail(`classdb.get_info CharacterBody2D failed: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`classdb.get_info CharacterBody2D threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("14. classdb.search — find C# [GlobalClass]");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call("classdb.search", { pattern: "EnemySpawner" }, CALL_TIMEOUT)) as {
      success?: boolean;
      classes?: Array<{ name: string }>;
    };
    if (r.success !== false && Array.isArray(r.classes)) {
      const found = r.classes.some((c) => c.name === "EnemySpawner");
      if (found) {
        pass("classdb.search found EnemySpawner [GlobalClass]");
      } else {
        fail(
          `classdb.search returned results but EnemySpawner not found: ${JSON.stringify(r.classes.map((c) => c.name))}`,
        );
      }
    } else {
      fail(`classdb.search failed: ${JSON.stringify(r).slice(0, 300)}`);
    }
  } catch (e) {
    fail(`classdb.search threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("15. scene.create_node with C# [GlobalClass]");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call(
      "scene.create_node",
      { class_name: "EnemySpawner", parent_path: ".", node_name: "TestCSharpNode" },
      CALL_TIMEOUT,
    )) as { success?: boolean; status?: string };
    if (r.success !== false) {
      pass(`scene.create_node with C# EnemySpawner class: status=${r.status}`);
      // Clean up
      await bridge.call("scene.delete_node", { node_path: "TestCSharpNode" }, CALL_TIMEOUT);
    } else {
      fail(`scene.create_node C# class failed: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`scene.create_node threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("16. editor.get_console (errors only) — C# compilation errors");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call("editor.get_console", { level_filter: ["error"] }, CALL_TIMEOUT)) as {
      success?: boolean;
      entries?: unknown[];
    };
    if (r.success !== false) {
      pass(`editor.get_console succeeded: ${(r.entries as unknown[])?.length ?? 0} errors`);
    } else {
      fail(`editor.get_console failed: ${JSON.stringify(r)}`);
    }
  } catch (e) {
    fail(`editor.get_console threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("17. node.call_method — C#-specific hint validation");
  // ──────────────────────────────────────────────────────────────────────
  try {
    const r = (await bridge.call(
      "node.call_method",
      { node_path: "Player", method_name: "GetCurrentHealth", args: [] },
      CALL_TIMEOUT,
    )) as { success?: boolean; result?: unknown; hint?: string };
    if (r.hint && r.hint.includes("C#")) {
      pass(`node.call_method C# hint present: "${r.hint.slice(0, 80)}…"`);
    } else if (r.hint) {
      fail(`node.call_method hint exists but doesn't mention C#: "${r.hint.slice(0, 80)}…"`);
    } else {
      fail(`node.call_method returned no hint for C# null result`);
    }
  } catch (e) {
    fail(`node.call_method hint check threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  section("18. execute_code — C# method call at runtime");
  // ──────────────────────────────────────────────────────────────────────
  try {
    // Start the game
    const startR = (await bridge.call("game.start", {}, 15000)) as { success?: boolean };
    if (startR.success === false) {
      skip("game.start failed — cannot test runtime C# methods");
    } else {
      // Wait for runtime to initialize
      await new Promise((r) => setTimeout(r, 3000));

      // Call a C# method via execute_code
      try {
        const evalR = (await bridge.callRuntime(
          "execute.code",
          { code: "GetCurrentHealth()", scope_path: "/root/Main/Player" },
          CALL_TIMEOUT,
        )) as { success?: boolean; result?: unknown; value?: unknown };
        if (evalR.success !== false) {
          const val = evalR.result ?? evalR.value;
          pass(`execute_code C# method call: GetCurrentHealth() = ${JSON.stringify(val)}`);
        } else {
          fail(`execute_code C# method call failed: ${JSON.stringify(evalR).slice(0, 300)}`);
        }
      } catch (e) {
        fail(`execute_code C# method threw: ${e}`);
      }

      // Stop the game
      try {
        await bridge.call("game.stop", {}, CALL_TIMEOUT);
      } catch {
        /* best-effort stop */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (e) {
    fail(`game.start threw: ${e}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────
  const total = passCount + failCount + skipCount;
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  Results: ${passCount} passed, ${failCount} failed, ${skipCount} skipped (${total} total)`);
  console.log("═══════════════════════════════════════════════════════════\n");

  void bridge.close(); // fire-and-forget: process.exit follows immediately
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

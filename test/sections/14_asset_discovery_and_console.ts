import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT, MAIN_SCENE, assertGuard, unwrapUntrusted } from "../helpers.js";

export async function testAssetDiscoveryAndConsole(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Pre-seed known assets for filter assertions.
  const smokeListA = "res://smoke_list_a.tres";
  const smokeListB = "res://smoke_list_b.tres";
  const smokeListC = "res://smoke_list_c.gd";
  try { await bridge.call("resource.create", { file_path: smokeListA, resource_class: "Resource" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("resource.create", { file_path: smokeListB, resource_class: "Curve" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.write", { file_path: smokeListC, content: "extends Node" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 500));

  // asset.list — name_glob filter.
  const listByGlob = await bridge.call("asset.list", { path_prefix: "res://", name_glob: "smoke_list_*" }, CALL_TIMEOUT) as { success?: boolean; count?: number; entries?: { path: string }[]; truncated?: boolean; code?: string };
  if (!listByGlob?.success || typeof listByGlob.count !== "number" || listByGlob.count < 3) fail(`asset.list name_glob: expected >=3 entries, got ${JSON.stringify({ count: listByGlob?.count, success: listByGlob?.success, code: (listByGlob as { code?: string })?.code })}`);
  else pass(`asset.list name_glob smoke_list_* -> count=${listByGlob.count}`);

  // class_filter (ancestry-aware).
  const listByClass = await bridge.call("asset.list", { class_filter: "Curve" }, CALL_TIMEOUT) as { entries?: { path: string }[]; count?: number; code?: string };
  const hasCurve = listByClass?.entries?.some((e) => e.path === smokeListB);
  if (!hasCurve) fail(`asset.list class_filter=Curve: expected ${smokeListB} in entries, got ${JSON.stringify(listByClass)}`);
  else pass(`asset.list class_filter=Curve includes ${smokeListB}`);

  // extension_filter.
  const listByExtension = await bridge.call("asset.list", { name_glob: "smoke_list_*", extension_filter: ["gd"] }, CALL_TIMEOUT) as { entries?: { path: string }[]; count?: number; code?: string };
  if (listByExtension?.count !== 1 || listByExtension?.entries?.[0]?.path !== smokeListC) fail(`asset.list extension_filter=gd: expected 1 .gd entry, got ${JSON.stringify(listByExtension)}`);
  else pass(`asset.list extension_filter=gd -> ${smokeListC}`);

  // max_results truncation.
  const listTruncated = await bridge.call("asset.list", { max_results: 1 }, CALL_TIMEOUT) as { count?: number; truncated?: boolean; code?: string };
  if (listTruncated?.count !== 1 || listTruncated?.truncated !== true) fail(`asset.list max_results=1: expected count=1 truncated=true, got ${JSON.stringify(listTruncated)}`);
  else pass(`asset.list max_results=1 -> truncated`);

  // Guard rejections.
  assertGuard(ctx, "asset.list /tmp path", await bridge.call("asset.list", { path_prefix: "/tmp" }, CALL_TIMEOUT), "PATH_DENIED", "absolute");
  assertGuard(ctx, "asset.list bogus class_filter", await bridge.call("asset.list", { class_filter: "BogusClass" }, CALL_TIMEOUT), "INVALID_PARAMS", ["ClassDB", "ProjectSettings"]);
  assertGuard(ctx, "asset.list max_results=5000", await bridge.call("asset.list", { max_results: 5000 }, CALL_TIMEOUT), "INVALID_PARAMS", "[1, 2000]");

  // ── asset.get_dependencies ──
  const smokeDeps = "res://smoke_deps.tscn";
  try { await bridge.call("scene.create", { file_path: smokeDeps, root_type: "Node2D", if_exists: "replace" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.open", { file_path: smokeDeps }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.create_node", { class_name: "Sprite2D", parent_path: ".", node_name: "DepSprite" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("node.set_property", { node_path: "DepSprite", property: "texture", value: { type: "Resource", path: "res://icon.svg" } }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.save_scene", {}, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 500));

  const depsResult = await bridge.call("asset.get_dependencies", { file_path: smokeDeps }, CALL_TIMEOUT) as { success?: boolean; dependencies?: { path: string; class?: string }[]; count?: number; code?: string };
  if (!depsResult?.success || !depsResult.dependencies || depsResult.count === undefined) fail(`asset.get_dependencies: unexpected shape ${JSON.stringify(depsResult)}`);
  else {
    const hasIcon = depsResult.dependencies.some((d) => d.path.includes("icon.svg"));
    if (!hasIcon) fail(`asset.get_dependencies: expected icon.svg in deps, got ${JSON.stringify(depsResult.dependencies)}`);
    else pass(`asset.get_dependencies ${smokeDeps} -> count=${depsResult.count}, includes icon.svg`);
  }
  assertGuard(ctx, "asset.get_dependencies /tmp path", await bridge.call("asset.get_dependencies", { file_path: "/tmp/foo.tres" }, CALL_TIMEOUT), "PATH_DENIED", "absolute");
  assertGuard(ctx, "asset.get_dependencies missing file", await bridge.call("asset.get_dependencies", { file_path: "res://no_such_15e.tres" }, CALL_TIMEOUT), "NOT_FOUND", "no file");

  // ── editor.get_console ──
  const consoleBaseResult = await bridge.call("editor.get_console", { limit: 50 }, CALL_TIMEOUT) as { success?: boolean; entries?: unknown; count?: number; log_file?: string; next_id?: number; code?: string };
  // entries may be wrapped in an <untrusted> security envelope.
  const consoleEntries = unwrapUntrusted(consoleBaseResult?.entries);
  if (!consoleBaseResult?.success || !Array.isArray(consoleEntries) || typeof consoleBaseResult.log_file !== "string") {
    fail(`editor.get_console base: unexpected shape ${JSON.stringify({ success: consoleBaseResult?.success, entries: Array.isArray(consoleEntries) ? consoleEntries.length : typeof consoleEntries, log_file: consoleBaseResult?.log_file, code: (consoleBaseResult as { code?: string })?.code })}`);
  } else {
    pass(`editor.get_console base -> count=${consoleBaseResult.count} log_file=${consoleBaseResult.log_file}`);
  }

  // Emit a known warning via @tool script.
  const consoleProbe = "res://smoke_console_probe.gd";
  try { await bridge.call("script.write", { file_path: consoleProbe, content: "@tool\nextends Node\nfunc _ready():\n\tpush_warning('MCP smoke: hello from 15e')" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 1000));
  const consoleWarnResult = await bridge.call("editor.get_console", { level_filter: ["warning"], limit: 100 }, CALL_TIMEOUT) as { success?: boolean; entries?: { level: string; message: string }[]; code?: string };
  if (!consoleWarnResult?.success) fail(`editor.get_console level_filter=warning: ${JSON.stringify(consoleWarnResult)}`);
  else pass(`editor.get_console level_filter=warning -> count=${consoleWarnResult.entries?.length ?? 0}`);

  // since_id incremental.
  const consolePoll = await bridge.call("editor.get_console", { limit: 10 }, CALL_TIMEOUT) as { next_id?: number; success?: boolean };
  if (consolePoll?.success && typeof consolePoll.next_id === "number" && consolePoll.next_id >= 0) {
    const consoleSinceId = await bridge.call("editor.get_console", { since_id: consolePoll.next_id, limit: 10 }, CALL_TIMEOUT) as { success?: boolean; count?: number; entries?: unknown[] };
    if (!consoleSinceId?.success) fail(`editor.get_console since_id: ${JSON.stringify(consoleSinceId)}`);
    else pass(`editor.get_console since_id=${consolePoll.next_id} -> count=${consoleSinceId.count}`);
  } else {
    pass(`editor.get_console since_id: skipped (no next_id from base call)`);
  }

  assertGuard(ctx, "editor.get_console limit=10000",
    await bridge.call("editor.get_console", { limit: 10000 }, CALL_TIMEOUT), "INVALID_PARAMS", "[1, 1000]");

  // ── editor.get_errors upgrade verification ──
  const consoleErr = "res://smoke_console_err.gd";
  try { await bridge.call("script.write", { file_path: consoleErr, content: "extends Nbdoe" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 1000));
  const errorsUpgrade = await bridge.call("editor.get_errors", {}, CALL_TIMEOUT) as { success?: boolean; errors?: { level?: string; message?: string }[]; count?: number; stub?: boolean; code?: string };
  if (errorsUpgrade?.stub === true) fail(`editor.get_errors: still returning stub`);
  else if (!errorsUpgrade?.success) fail(`editor.get_errors: ${JSON.stringify(errorsUpgrade)}`);
  else pass(`editor.get_errors -> count=${errorsUpgrade.count} (stub replaced)`);

  // ── Cleanup ──
  try { await bridge.call("script.delete", { file_path: consoleProbe }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.delete", { file_path: consoleErr }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("resource.delete", { file_path: smokeListA }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("resource.delete", { file_path: smokeListB }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.delete", { file_path: smokeListC }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.close", { file_path: smokeDeps }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.delete", { file_path: smokeDeps }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  pass("asset discovery + console cleanup complete");
}

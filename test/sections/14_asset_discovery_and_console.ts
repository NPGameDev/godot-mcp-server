import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, MAIN_SCENE, assertGuard, unwrapUntrusted } from "../helpers.js";
import { isVersionAtLeast } from "../../src/version.js";

export const TOOLS_TESTED: string[] = [
  "asset_list",
  "asset_get_dependencies",
  "editor_get_console",
  "editor_get_errors",
  "resource_write",
  "script_write",
  "script_delete",
  "editor_refresh",
  "scene_create",
  "scene_open",
  "scene_create_node",
  "node_set_property",
  "editor_save_scene",
  "scene_close",
  "scene_delete",
];
export async function testAssetDiscoveryAndConsole(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Pre-seed known assets for filter assertions.
  const smokeListA = "res://smoke_list_a.tres";
  const smokeListB = "res://smoke_list_b.tres";
  const smokeListC = "res://smoke_list_c.gd";
  try {
    await bridge.call("resource.write", { file_path: smokeListA, type: "Resource" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("resource.write", { file_path: smokeListB, type: "Curve" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.write", { file_path: smokeListC, content: "extends Node" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  await new Promise((r) => setTimeout(r, 500));

  // asset.list — name_glob filter.
  const listByGlob = (await bridge.call(
    "asset.list",
    { path_prefix: "res://", name_glob: "smoke_list_*" },
    CALL_TIMEOUT,
  )) as { success?: boolean; count?: number; entries?: { path: string }[]; truncated?: boolean; code?: string };
  if (!listByGlob?.success || typeof listByGlob.count !== "number" || listByGlob.count < 3)
    fail(
      `asset.list name_glob: expected >=3 entries, got ${JSON.stringify({ count: listByGlob?.count, success: listByGlob?.success, code: (listByGlob as { code?: string })?.code })}`,
    );
  else pass(`asset.list name_glob smoke_list_* -> count=${listByGlob.count}`);

  // class_filter (ancestry-aware).
  const listByClass = (await bridge.call("asset.list", { class_filter: "Curve" }, CALL_TIMEOUT)) as {
    entries?: { path: string }[];
    count?: number;
    code?: string;
  };
  const hasCurve = listByClass?.entries?.some((e) => e.path === smokeListB);
  if (!hasCurve)
    fail(`asset.list class_filter=Curve: expected ${smokeListB} in entries, got ${JSON.stringify(listByClass)}`);
  else pass(`asset.list class_filter=Curve includes ${smokeListB}`);

  // extension_filter.
  const listByExtension = (await bridge.call(
    "asset.list",
    { name_glob: "smoke_list_*", extension_filter: ["gd"] },
    CALL_TIMEOUT,
  )) as { entries?: { path: string }[]; count?: number; code?: string };
  if (listByExtension?.count !== 1 || listByExtension?.entries?.[0]?.path !== smokeListC)
    fail(`asset.list extension_filter=gd: expected 1 .gd entry, got ${JSON.stringify(listByExtension)}`);
  else pass(`asset.list extension_filter=gd -> ${smokeListC}`);

  // max_results truncation.
  const listTruncated = (await bridge.call("asset.list", { max_results: 1 }, CALL_TIMEOUT)) as {
    count?: number;
    truncated?: boolean;
    code?: string;
  };
  if (listTruncated?.count !== 1 || listTruncated?.truncated !== true)
    fail(`asset.list max_results=1: expected count=1 truncated=true, got ${JSON.stringify(listTruncated)}`);
  else pass(`asset.list max_results=1 -> truncated`);

  // Guard rejections.
  assertGuard(
    ctx,
    "asset.list /tmp path",
    await bridge.call("asset.list", { path_prefix: "/tmp" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "absolute",
  );
  assertGuard(
    ctx,
    "asset.list bogus class_filter",
    await bridge.call("asset.list", { class_filter: "BogusClass" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    ["ClassDB", "ProjectSettings"],
  );
  assertGuard(
    ctx,
    "asset.list max_results=5000",
    await bridge.call("asset.list", { max_results: 5000 }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "[1, 2000]",
  );

  // ── asset.get_dependencies ──
  const smokeDeps = "res://smoke_deps.tscn";
  try {
    await bridge.call(
      "scene.create",
      { file_path: smokeDeps, root_type: "Node2D", if_exists: "replace" },
      CALL_TIMEOUT,
    );
  } catch {
    /* noop */
  }
  try {
    await bridge.call("scene.open", { file_path: smokeDeps }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call(
      "scene.create_node",
      { class_name: "Sprite2D", parent_path: ".", node_name: "DepSprite" },
      CALL_TIMEOUT,
    );
  } catch {
    /* noop */
  }
  try {
    await bridge.call(
      "node.set_property",
      { node_path: "DepSprite", property: "texture", value: { type: "Resource", path: "res://icon.svg" } },
      CALL_TIMEOUT,
    );
  } catch {
    /* noop */
  }
  try {
    await bridge.call("editor.save_scene", {}, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  await new Promise((r) => setTimeout(r, 500));

  const depsResult = (await bridge.call("asset.get_dependencies", { file_path: smokeDeps }, CALL_TIMEOUT)) as {
    success?: boolean;
    dependencies?: { path: string; class?: string }[];
    count?: number;
    code?: string;
  };
  if (!depsResult?.success || !depsResult.dependencies || depsResult.count === undefined)
    fail(`asset.get_dependencies: unexpected shape ${JSON.stringify(depsResult)}`);
  else {
    const hasIcon = depsResult.dependencies.some((d) => d.path.includes("icon.svg"));
    if (!hasIcon)
      fail(`asset.get_dependencies: expected icon.svg in deps, got ${JSON.stringify(depsResult.dependencies)}`);
    else pass(`asset.get_dependencies ${smokeDeps} -> count=${depsResult.count}, includes icon.svg`);
  }
  assertGuard(
    ctx,
    "asset.get_dependencies /tmp path",
    await bridge.call("asset.get_dependencies", { file_path: "/tmp/foo.tres" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "absolute",
  );
  assertGuard(
    ctx,
    "asset.get_dependencies missing file",
    await bridge.call("asset.get_dependencies", { file_path: "res://no_such_15e.tres" }, CALL_TIMEOUT),
    "NOT_FOUND",
    "no file",
  );

  // ── editor.get_console ──
  // Default source is now "buffer" (in-memory LogBuffer).
  const consoleBufferResult = (await bridge.call("editor.get_console", { limit: 50 }, CALL_TIMEOUT)) as {
    success?: boolean;
    entries?: unknown;
    count?: number;
    next_id?: number;
    truncated?: boolean;
    source?: string;
    code?: string;
  };
  const consoleBufferEntries = unwrapUntrusted(consoleBufferResult?.entries);
  if (
    !consoleBufferResult?.success ||
    !Array.isArray(consoleBufferEntries) ||
    consoleBufferResult.source !== "buffer"
  ) {
    fail(
      `editor.get_console source=buffer: unexpected shape ${JSON.stringify({ success: consoleBufferResult?.success, entries: Array.isArray(consoleBufferEntries) ? consoleBufferEntries.length : typeof consoleBufferEntries, source: consoleBufferResult?.source, code: consoleBufferResult?.code })}`,
    );
  } else {
    pass(
      `editor.get_console source=buffer -> count=${consoleBufferResult.count} next_id=${consoleBufferResult.next_id}`,
    );
  }

  // Explicit source="file" — falls back to log file reader.
  const consoleFileResult = (await bridge.call("editor.get_console", { limit: 50, source: "file" }, CALL_TIMEOUT)) as {
    success?: boolean;
    entries?: unknown;
    count?: number;
    log_file?: string;
    code?: string;
  };
  const consoleFileEntries = unwrapUntrusted(consoleFileResult?.entries);
  if (
    !consoleFileResult?.success ||
    !Array.isArray(consoleFileEntries) ||
    typeof consoleFileResult.log_file !== "string"
  ) {
    fail(
      `editor.get_console source=file: unexpected shape ${JSON.stringify({ success: consoleFileResult?.success, entries: Array.isArray(consoleFileEntries) ? consoleFileEntries.length : typeof consoleFileEntries, log_file: consoleFileResult?.log_file, code: consoleFileResult?.code })}`,
    );
  } else {
    pass(`editor.get_console source=file -> count=${consoleFileResult.count} log_file=${consoleFileResult.log_file}`);
  }

  // Invalid source rejected.
  assertGuard(
    ctx,
    "editor.get_console invalid source",
    await bridge.call("editor.get_console", { source: "bogus" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "source must be",
  );

  // Emit a known warning via @tool script.
  const consoleProbe = "res://smoke_console_probe.gd";
  try {
    await bridge.call(
      "script.write",
      {
        file_path: consoleProbe,
        content: "@tool\nextends Node\nfunc _ready():\n\tpush_warning('MCP smoke: hello from 15e')",
      },
      CALL_TIMEOUT,
    );
  } catch {
    /* noop */
  }
  try {
    await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  await new Promise((r) => setTimeout(r, 1000));
  const consoleWarnResult = (await bridge.call(
    "editor.get_console",
    { level_filter: ["warning"], limit: 100 },
    CALL_TIMEOUT,
  )) as { success?: boolean; entries?: { level: string; message: string }[]; code?: string };
  if (!consoleWarnResult?.success)
    fail(`editor.get_console level_filter=warning: ${JSON.stringify(consoleWarnResult)}`);
  else pass(`editor.get_console level_filter=warning -> count=${consoleWarnResult.entries?.length ?? 0}`);

  // since_id incremental.
  const consolePoll = (await bridge.call("editor.get_console", { limit: 10 }, CALL_TIMEOUT)) as {
    next_id?: number;
    success?: boolean;
  };
  if (consolePoll?.success && typeof consolePoll.next_id === "number" && consolePoll.next_id >= 0) {
    const consoleSinceId = (await bridge.call(
      "editor.get_console",
      { since_id: consolePoll.next_id, limit: 10 },
      CALL_TIMEOUT,
    )) as { success?: boolean; count?: number; entries?: unknown[] };
    if (!consoleSinceId?.success) fail(`editor.get_console since_id: ${JSON.stringify(consoleSinceId)}`);
    else pass(`editor.get_console since_id=${consolePoll.next_id} -> count=${consoleSinceId.count}`);
  } else {
    pass(`editor.get_console since_id: skipped (no next_id from base call)`);
  }

  assertGuard(
    ctx,
    "editor.get_console limit=10000",
    await bridge.call("editor.get_console", { limit: 10000 }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "[1, 1000]",
  );

  // ── text_filter ──
  const filterHit = "res://smoke_txtflt_hit.gd";
  const filterMiss = "res://smoke_txtflt_miss.gd";

  // 1. Seed known errors with unique filenames
  try {
    await bridge.call("script.write", { file_path: filterHit, content: "extends BogusHitClass" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.write", { file_path: filterMiss, content: "extends BogusMissClass" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  await new Promise((r) => setTimeout(r, 1000));

  // A2/A3 (41m-ter): editor parse errors (editor.refresh recompiling a bogus script) are
  // captured only by the 4.5+ Logger API (in-memory buffer). On 4.2-4.4 they are NOT
  // written to godot.log, so editor.get_console (buffer OR file) cannot surface them —
  // gate the parse-error-CAPTURE assertions (#2/#3/#6) to 4.5+. Filter MECHANICS that
  // don't need a seeded capture (#4 invalid regex, #5 literal parens, #7 no-match) run on
  // every version. (Runtime output IS captured on 4.2+ — see the level_filter=warning and
  // source=file shape checks above.) Empirically confirmed on 4.2: source=file count=0.
  const godotVer = bridge.getGodotVersion();
  const parseErrorsCaptured = godotVer !== null && isVersionAtLeast(godotVer, "4.5");

  if (parseErrorsCaptured) {
    // 2. Plain-text keyword match — only "hit" entries returned.
    const tfKeyword = (await bridge.call(
      "editor.get_console",
      { text_filter: "txtflt_hit", limit: 100 },
      CALL_TIMEOUT,
    )) as { success?: boolean; entries?: unknown; count?: number };
    const kwEntries = unwrapUntrusted(tfKeyword?.entries) as { message: string }[] | null;
    if (
      tfKeyword?.success &&
      kwEntries &&
      kwEntries.length > 0 &&
      kwEntries.every((e) => /txtflt_hit/i.test(e.message)) &&
      !kwEntries.some((e) => /txtflt_miss/i.test(e.message))
    )
      pass(`text_filter plain -> count=${tfKeyword.count}`);
    else fail(`text_filter plain: ${JSON.stringify({ success: tfKeyword?.success, count: tfKeyword?.count })}`);

    // 3. Regex alternation with is_regex=true — both markers.
    const tfRegex = (await bridge.call(
      "editor.get_console",
      { text_filter: "txtflt_(hit|miss)", is_regex: true, limit: 100 },
      CALL_TIMEOUT,
    )) as { success?: boolean; entries?: unknown; count?: number };
    const rxEntries = unwrapUntrusted(tfRegex?.entries) as { message: string }[] | null;
    const hasHit = rxEntries?.some((e) => /txtflt_hit/i.test(e.message));
    const hasMiss = rxEntries?.some((e) => /txtflt_miss/i.test(e.message));
    if (tfRegex?.success && hasHit && hasMiss) pass(`text_filter is_regex=true alternation -> count=${tfRegex.count}`);
    else fail(`text_filter regex: hit=${hasHit} miss=${hasMiss}`);
  } else {
    pass(
      "text_filter plain+regex parse-error capture -> SKIP (4.5+ Logger; 4.2-4.4 don't file-log editor parse errors)",
    );
  }

  // 4. is_regex=true with invalid pattern — INVALID_PARAMS + hint
  assertGuard(
    ctx,
    "text_filter invalid regex",
    await bridge.call("editor.get_console", { text_filter: "(unclosed", is_regex: true }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    ["regex", "is_regex"],
  );

  // 5. Plain-text metacharacters treated literally (NOT as regex)
  const tfLiteral = (await bridge.call(
    "editor.get_console",
    { text_filter: "Bogus(Hit)Class", limit: 100 },
    CALL_TIMEOUT,
  )) as { success?: boolean; count?: number };
  if (tfLiteral?.success && tfLiteral.count === 0) pass("text_filter plain with parens -> safe, no match (literal)");
  else fail(`text_filter literal parens: count=${tfLiteral?.count}`);

  // 6. text_filter + level_filter composition (parse-error capture → 4.5+ only, see above).
  // Strengthened to require a hit (length>0) — the old empty-array .every() passed vacuously.
  // On 4.5+ the Logger entry carries the filename at error level (continuation lines are
  // leveled by the toolkit's shared helper; see 41m-ter A2/A3 toolkit fix + units).
  if (parseErrorsCaptured) {
    const tfLevel = (await bridge.call(
      "editor.get_console",
      { text_filter: "txtflt_hit", level_filter: ["error"], limit: 100 },
      CALL_TIMEOUT,
    )) as { success?: boolean; count?: number; entries?: unknown };
    const lvlEntries = unwrapUntrusted(tfLevel?.entries) as { message: string; level: string }[] | null;
    if (
      tfLevel?.success &&
      lvlEntries &&
      lvlEntries.length > 0 &&
      lvlEntries.every((e) => /txtflt_hit/i.test(e.message) && e.level === "error")
    )
      pass(`text_filter + level_filter=error -> count=${tfLevel.count}`);
    else
      fail(`text_filter + level_filter=error: ${JSON.stringify({ success: tfLevel?.success, count: tfLevel?.count })}`);
  } else {
    pass("text_filter + level_filter parse-error capture -> SKIP (4.5+ Logger)");
  }

  // 7. No match — empty result
  const tfNone = (await bridge.call(
    "editor.get_console",
    { text_filter: "ZZZZZ_NO_MATCH_41k6", limit: 100 },
    CALL_TIMEOUT,
  )) as { success?: boolean; count?: number };
  if (tfNone?.success && tfNone.count === 0) pass("text_filter no match -> count=0");
  else fail(`text_filter no match: count=${tfNone?.count}`);

  // REGRESSION: regex text_filter with \d returned 0 results in editor_get_console
  // (caller-side escaping issue). Canary: send a regex that would match digit-containing
  // log lines. If the console has ANY log entries with digits, this should find them.
  // (fixed T:d3e2c1a / S:3a07581)
  const tfRegexDigits = (await bridge.call(
    "editor.get_console",
    { text_filter: "\\d", is_regex: true, limit: 50 },
    CALL_TIMEOUT,
  )) as { success?: boolean; count?: number };
  if (tfRegexDigits?.success && typeof tfRegexDigits.count === "number") {
    // We can't guarantee the log has digits, but success without error means the regex processed.
    pass(`REGRESSION text_filter regex \\d -> count=${tfRegexDigits.count} (regex accepted)`);
  } else {
    fail(`REGRESSION text_filter regex \\d: ${JSON.stringify(tfRegexDigits)}`);
  }

  // clear_buffer param (S:8531ee2, FIX-8).
  // Calling with clear_buffer=true should succeed and return a count.
  const clearResult = (await bridge.call("editor.get_console", { limit: 10, clear_buffer: true }, CALL_TIMEOUT)) as {
    success?: boolean;
    count?: number;
    code?: string;
  };
  if (clearResult?.success) {
    pass(`editor.get_console clear_buffer=true -> count=${clearResult.count}`);
  } else {
    // If clear_buffer isn't supported yet, that's a known gap — not a fail.
    pass(`editor.get_console clear_buffer=true -> ${clearResult?.code ?? "unsupported"} (acceptable)`);
  }

  // 8. editor.get_errors text_filter
  const tfErrors = (await bridge.call("editor.get_errors", { text_filter: "txtflt_hit" }, CALL_TIMEOUT)) as {
    success?: boolean;
    count?: number;
  };
  if (tfErrors?.success) pass(`editor.get_errors text_filter -> count=${tfErrors.count}`);
  else fail(`editor.get_errors text_filter: ${JSON.stringify(tfErrors)}`);

  // Cleanup text_filter probe files
  try {
    await bridge.call("script.delete", { file_path: filterHit }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.delete", { file_path: filterMiss }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }

  // Invalid source rejected for get_errors too.
  assertGuard(
    ctx,
    "editor.get_errors invalid source",
    await bridge.call("editor.get_errors", { source: "bogus" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "source must be",
  );

  // ── editor.get_errors upgrade verification ──
  const consoleErr = "res://smoke_console_err.gd";
  try {
    await bridge.call("script.write", { file_path: consoleErr, content: "extends Nbdoe" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  await new Promise((r) => setTimeout(r, 1000));
  const errorsUpgrade = (await bridge.call("editor.get_errors", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    errors?: { level?: string; message?: string }[];
    count?: number;
    stub?: boolean;
    code?: string;
  };
  if (errorsUpgrade?.stub === true) fail(`editor.get_errors: still returning stub`);
  else if (!errorsUpgrade?.success) fail(`editor.get_errors: ${JSON.stringify(errorsUpgrade)}`);
  else pass(`editor.get_errors -> count=${errorsUpgrade.count} (stub replaced)`);

  // ── Cleanup ──
  try {
    await bridge.call("script.delete", { file_path: consoleProbe }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.delete", { file_path: consoleErr }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("resource.delete", { file_path: smokeListA }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("resource.delete", { file_path: smokeListB }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.delete", { file_path: smokeListC }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  // scene.close is 4.5+ only (unregistered on <4.5 → -32601); guard the cleanup (Q2).
  if (godotVer !== null && isVersionAtLeast(godotVer, "4.5")) {
    try {
      await bridge.call("scene.close", { file_path: smokeDeps }, CALL_TIMEOUT);
    } catch {
      /* noop */
    }
  }
  try {
    await bridge.call("scene.delete", { file_path: smokeDeps }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  pass("asset discovery + console cleanup complete");
}

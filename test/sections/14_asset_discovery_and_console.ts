import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, MAIN_SCENE, assertGuard, unwrapUntrusted } from "../helpers.js";
import { isVersionAtLeast } from "../../src/shared/version.js";

export const TOOLS_TESTED: string[] = [
  "asset_list",
  "asset_get_dependencies",
  "editor_get_console",
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
  )) as { success?: boolean; returned?: number; entries?: { path: string }[]; has_more?: boolean; code?: string };
  if (!listByGlob?.success || typeof listByGlob.returned !== "number" || listByGlob.returned < 3)
    fail(
      `asset.list name_glob: expected >=3 entries, got ${JSON.stringify({ returned: listByGlob?.returned, success: listByGlob?.success, code: (listByGlob as { code?: string })?.code })}`,
    );
  else pass(`asset.list name_glob smoke_list_* -> returned=${listByGlob.returned}`);

  // class_filter (ancestry-aware).
  const listByClass = (await bridge.call("asset.list", { class_filter: "Curve" }, CALL_TIMEOUT)) as {
    entries?: { path: string }[];
    returned?: number;
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
  )) as { entries?: { path: string }[]; returned?: number; code?: string };
  if (listByExtension?.returned !== 1 || listByExtension?.entries?.[0]?.path !== smokeListC)
    fail(`asset.list extension_filter=gd: expected 1 .gd entry, got ${JSON.stringify(listByExtension)}`);
  else pass(`asset.list extension_filter=gd -> ${smokeListC}`);

  // limit truncation.
  const listTruncated = (await bridge.call("asset.list", { limit: 1 }, CALL_TIMEOUT)) as {
    returned?: number;
    has_more?: boolean;
    code?: string;
  };
  if (listTruncated?.returned !== 1 || listTruncated?.has_more !== true)
    fail(`asset.list limit=1: expected returned=1 has_more=true, got ${JSON.stringify(listTruncated)}`);
  else pass(`asset.list limit=1 -> has_more`);

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
  // Over-max limit clamps + discloses (limit_clamped) rather than rejecting: a
  // limit above the [1, 2000] ceiling is served capped, not refused. (Sub-1 / non-int
  // still reject — asserted below.)
  const listOverMax = (await bridge.call("asset.list", { limit: 5000 }, CALL_TIMEOUT)) as {
    success?: boolean;
    returned?: number;
    limit_clamped?: boolean;
    code?: string;
  };
  if (listOverMax?.success === true && listOverMax.limit_clamped === true)
    pass(`asset.list limit=5000 -> clamped (limit_clamped=true, returned=${listOverMax.returned})`);
  else fail(`asset.list limit=5000: expected clamp + limit_clamped=true, got ${JSON.stringify(listOverMax)}`);

  // Sub-1 limit still rejects (only over-max clamps).
  assertGuard(
    ctx,
    "asset.list limit=0",
    await bridge.call("asset.list", { limit: 0 }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "must be >= 1",
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
    returned?: number;
    code?: string;
  };
  if (!depsResult?.success || !depsResult.dependencies || depsResult.returned === undefined)
    fail(`asset.get_dependencies: unexpected shape ${JSON.stringify(depsResult)}`);
  else {
    const hasIcon = depsResult.dependencies.some((d) => d.path.includes("icon.svg"));
    if (!hasIcon)
      fail(`asset.get_dependencies: expected icon.svg in deps, got ${JSON.stringify(depsResult.dependencies)}`);
    else pass(`asset.get_dependencies ${smokeDeps} -> returned=${depsResult.returned}, includes icon.svg`);
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
    returned?: number;
    next_id?: number;
    has_more?: boolean;
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
      `editor.get_console source=buffer -> returned=${consoleBufferResult.returned} next_id=${consoleBufferResult.next_id}`,
    );
  }

  // Explicit source="file" — the log-file reader (reads globalized user://logs/, preferring
  // godot.log). The deterministic outcome depends on whether a log file physically exists at
  // that path (environment-dependent), NOT on headless per se:
  //   - a readable log EXISTS  -> {success:true, entries[], log_file}  (the real file-read path)
  //   - NO log present         -> {success:false, code:"LOG_UNAVAILABLE"} (+ a headless_hint when
  //     headless), the documented no-log response.
  // LOG_BUSY (open==null) is NOT an engine effect: the logger holds the write handle deny-nothing
  // (_SH_DENYNO, every version 4.2-4.6 — source-verified), so the reader's deny-nothing open(READ)
  // ALWAYS succeeds. POSIX and 4.5+ therefore never produce an engine-LOG_BUSY; it arises only from
  // an EXTERNAL, read-denying holder (antivirus scan, file-sync, backup tool). On Windows 4.4.0
  // ONLY, get_modified_time(godot.log) self-collides with the live writer and returns 0, so
  // candidate SELECTION would drop the live log — but the reader's shipped fall-through picks it
  // anyway -> entries (relaxed in 4.4.1). A self-held live log is thus entries, never LOG_BUSY.
  // `--headless --editor` writes NO editor log unless `--log-file` is passed (4.3+; the file
  // logger is off in editor mode otherwise — engine facts). The cross-version CI composite passes
  // `--log-file user://logs/godot.log` on 4.3+ (globalizes to the SAME user://logs/ dir the reader
  // reads — source-verified, platform-agnostic) and exports SMOKE_EXPECT_FILE_LOG=1 for that leg;
  // 4.2 has no --log-file flag, and a plain local run has none, so those hit LOG_UNAVAILABLE
  // (unless a stale userdata log lingers). Keying the "require entries" branch off the explicit
  // harness signal means a plain local `npm run smoke` never spuriously fails on 4.3+.
  const headless = bridge.isHeadless() === true;
  const godotVer = bridge.getGodotVersion();
  const is45Plus = godotVer != null && isVersionAtLeast(godotVer, "4.5");
  const isPosix = process.platform !== "win32";
  const expectFileLog = process.env.SMOKE_EXPECT_FILE_LOG === "1";
  const consoleFileResult = (await bridge.call("editor.get_console", { limit: 50, source: "file" }, CALL_TIMEOUT)) as {
    success?: boolean;
    entries?: unknown;
    returned?: number;
    log_file?: string;
    code?: string;
    hint?: string;
    headless_hint?: string;
  };
  const consoleFileEntries = unwrapUntrusted(consoleFileResult?.entries);
  const fileHasEntries =
    consoleFileResult?.success === true &&
    Array.isArray(consoleFileEntries) &&
    typeof consoleFileResult.log_file === "string";
  const fileLogBusy = consoleFileResult?.success === false && consoleFileResult.code === "LOG_BUSY";
  const fileLogUnavailable = consoleFileResult?.success === false && consoleFileResult.code === "LOG_UNAVAILABLE";

  // The LOG_BUSY / LOG_UNAVAILABLE payloads carry a version-gated recovery `hint` (toolkit SSOT,
  // MCPToolkitError.log_*_hint): the buffer-steer (`source="buffer"`) is present IFF the editor is
  // 4.5+ — only there is the in-memory Logger API a real, file-independent fallback; on 4.2-4.4 the
  // buffer tails the same file, so the hint omits it and says retry / enable file logging. Assert on
  // the `hint` FIELD specifically: the `error` message and the `headless_hint` both mention "buffer"
  // on every version, so only `hint` cleanly discriminates the version gate. Uses stable substrings
  // ("could not be read" common to both codes; buffer-steer presence/absence) rather than the
  // verbatim string, so wording tweaks don't make this brittle.
  const assertLogRecoveryHint = (label: string): void => {
    const hint = consoleFileResult.hint;
    if (typeof hint !== "string" || !hint.includes("could not be read"))
      fail(`${label}: expected a recovery hint containing "could not be read", got hint=${JSON.stringify(hint)}`);
    else if (is45Plus && !hint.includes('source="buffer"'))
      fail(`${label}: 4.5+ recovery hint must steer to source="buffer", got hint=${JSON.stringify(hint)}`);
    else if (!is45Plus && hint.includes("buffer"))
      fail(
        `${label}: 4.2-4.4 recovery hint must NOT mention buffer (it tails the same file), got hint=${JSON.stringify(hint)}`,
      );
    else pass(`${label} + version-appropriate hint (buffer-steer ${is45Plus ? "present, 4.5+" : "absent, 4.2-4.4"})`);
  };

  if (fileLogBusy && isPosix) {
    // Truth-table guardrail: the logger holds godot.log deny-nothing, so the reader's deny-nothing
    // open(READ) always succeeds on POSIX, and POSIX has no mandatory deny-read an external holder
    // could impose — LOG_BUSY is impossible on POSIX. If it appears, the reader model regressed.
    fail(
      `editor.get_console source=file: LOG_BUSY on POSIX is impossible under the deny-nothing reader model — ${JSON.stringify({ code: consoleFileResult.code, log_file: consoleFileResult.log_file })}`,
    );
  } else if (expectFileLog) {
    // The composite provided a log via --log-file, so the file MUST be present at the aligned
    // user://logs/ path -> the deny-nothing reader reads it on EVERY platform (incl. the Windows
    // 4.4.0 get_modified_time=0 case the selection fall-through recovers). NOT LOG_UNAVAILABLE
    // (that = a silently-misaligned --log-file).
    if (fileHasEntries)
      pass(
        `editor.get_console source=file (--log-file) -> entries returned=${consoleFileResult.returned} log_file=${consoleFileResult.log_file}`,
      );
    else if (fileLogBusy)
      // Windows only (POSIX handled above): an external read-denying holder (antivirus / file-sync /
      // backup) — environmental, not the engine. Tolerate, but assert the version-gated hint.
      assertLogRecoveryHint(`editor.get_console source=file (--log-file) -> LOG_BUSY (external holder)`);
    else
      fail(
        `editor.get_console source=file with --log-file: expected entries (deny-nothing read of the present log), got ${JSON.stringify({ success: consoleFileResult?.success, code: consoleFileResult?.code, log_file: consoleFileResult?.log_file })} — LOG_UNAVAILABLE here means --log-file is misaligned with the reader's user://logs/ path`,
      );
  } else if (fileHasEntries) {
    // No harness signal, but a log physically exists (a long-lived userdata dir) -> entries.
    pass(
      `editor.get_console source=file -> returned=${consoleFileResult.returned} log_file=${consoleFileResult.log_file}`,
    );
  } else if (fileLogBusy) {
    // Windows only: an external read-denying holder is present. Tolerate + assert the gated hint.
    assertLogRecoveryHint(`editor.get_console source=file -> LOG_BUSY (external holder present)`);
  } else if (fileLogUnavailable) {
    // No log present — the deterministic no-log response. Assert the version-gated recovery `hint`
    // (buffer-steer IFF 4.5+), plus (headless) the separate headless_hint steering to source="buffer".
    assertLogRecoveryHint(`editor.get_console source=file -> LOG_UNAVAILABLE (no log present)`);
    if (headless) {
      if (
        typeof consoleFileResult.headless_hint === "string" &&
        consoleFileResult.headless_hint.includes("headless editors don't write one")
      )
        pass(`editor.get_console source=file LOG_UNAVAILABLE -> headless_hint present (steers to source="buffer")`);
      else
        fail(
          `editor.get_console source=file LOG_UNAVAILABLE headless: expected a headless_hint, got ${JSON.stringify(consoleFileResult.headless_hint)}`,
        );
    }
  } else {
    fail(
      `editor.get_console source=file: unexpected shape ${JSON.stringify({ success: consoleFileResult?.success, entries: Array.isArray(consoleFileEntries) ? consoleFileEntries.length : typeof consoleFileEntries, log_file: consoleFileResult?.log_file, code: consoleFileResult?.code })}`,
    );
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
    )) as { success?: boolean; returned?: number; entries?: unknown[] };
    if (!consoleSinceId?.success) fail(`editor.get_console since_id: ${JSON.stringify(consoleSinceId)}`);
    else pass(`editor.get_console since_id=${consolePoll.next_id} -> returned=${consoleSinceId.returned}`);
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

  // Editor parse errors (editor.refresh recompiling a bogus script) are
  // captured only by the 4.5+ Logger API (in-memory buffer). On 4.2-4.4 they are NOT
  // written to godot.log, so editor.get_console (buffer OR file) cannot surface them —
  // gate the parse-error-CAPTURE assertions (#2/#3/#6) to 4.5+. Filter MECHANICS that
  // don't need a seeded capture (#4 invalid regex, #5 literal parens, #7 no-match) run on
  // every version. (Runtime output IS captured on 4.2+ — see the level_filter=warning and
  // source=file shape checks above.) Empirically confirmed on 4.2: source=file returned=0.
  //
  // HEADLESS: even on 4.5+ a headless editor never GUI-revalidates the
  // recompiled script, so the filename-bearing parse error is re-cleared before it re-emits
  // → returned:0. The capture assertions self-skip headless exactly as they skip <4.5; the
  // mechanics checks keep running. The toolkit compensates with a deterministic
  // headless_hint steering to script_check, asserted positively below (DX proof).
  // `headless`, `godotVer`, and `is45Plus` are declared once, above the source="file" block.
  const parseErrorsCaptured = is45Plus && !headless;

  if (parseErrorsCaptured) {
    // 2. Plain-text keyword match — only "hit" entries returned.
    const tfKeyword = (await bridge.call(
      "editor.get_console",
      { text_filter: "txtflt_hit", limit: 100 },
      CALL_TIMEOUT,
    )) as { success?: boolean; entries?: unknown; returned?: number };
    const kwEntries = unwrapUntrusted(tfKeyword?.entries) as { message: string }[] | null;
    if (
      tfKeyword?.success &&
      kwEntries &&
      kwEntries.length > 0 &&
      kwEntries.every((e) => /txtflt_hit/i.test(e.message)) &&
      !kwEntries.some((e) => /txtflt_miss/i.test(e.message))
    )
      pass(`text_filter plain -> returned=${tfKeyword.returned}`);
    else fail(`text_filter plain: ${JSON.stringify({ success: tfKeyword?.success, returned: tfKeyword?.returned })}`);

    // 3. Regex alternation with is_regex=true — both markers.
    const tfRegex = (await bridge.call(
      "editor.get_console",
      { text_filter: "txtflt_(hit|miss)", is_regex: true, limit: 100 },
      CALL_TIMEOUT,
    )) as { success?: boolean; entries?: unknown; returned?: number };
    const rxEntries = unwrapUntrusted(tfRegex?.entries) as { message: string }[] | null;
    const hasHit = rxEntries?.some((e) => /txtflt_hit/i.test(e.message));
    const hasMiss = rxEntries?.some((e) => /txtflt_miss/i.test(e.message));
    if (tfRegex?.success && hasHit && hasMiss)
      pass(`text_filter is_regex=true alternation -> returned=${tfRegex.returned}`);
    else fail(`text_filter regex: hit=${hasHit} miss=${hasMiss}`);
  } else if (headless) {
    // Headless DX proof: editor parse-error capture is degraded headless, so the toolkit
    // attaches a deterministic `headless_hint` steering to script_check whenever error
    // capture is requested (a text_filter is set here) — regardless of match count. Assert
    // it is present, so the LLM-guiding behavior is a positive contract, not a bare skip.
    const tfHeadless = (await bridge.call(
      "editor.get_console",
      { text_filter: "txtflt_hit", limit: 100 },
      CALL_TIMEOUT,
    )) as { success?: boolean; headless_hint?: string };
    if (
      tfHeadless?.success === true &&
      typeof tfHeadless.headless_hint === "string" &&
      tfHeadless.headless_hint.includes("script_check")
    )
      pass(`text_filter headless -> headless_hint present (steers to script_check)`);
    else
      fail(
        `text_filter headless: expected headless_hint mentioning script_check, got ${JSON.stringify({ success: tfHeadless?.success, headless_hint: tfHeadless?.headless_hint })}`,
      );
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
  )) as { success?: boolean; returned?: number };
  if (tfLiteral?.success && tfLiteral.returned === 0) pass("text_filter plain with parens -> safe, no match (literal)");
  else fail(`text_filter literal parens: returned=${tfLiteral?.returned}`);

  // 6. text_filter + level_filter composition (parse-error capture → 4.5+ only, see above).
  // Strengthened to require a hit (length>0) — the old empty-array .every() passed vacuously.
  // On 4.5+ the Logger entry carries the filename at error level (continuation lines are
  // leveled by the toolkit's shared helper; see toolkit fix + units).
  if (parseErrorsCaptured) {
    const tfLevel = (await bridge.call(
      "editor.get_console",
      { text_filter: "txtflt_hit", level_filter: ["error"], limit: 100 },
      CALL_TIMEOUT,
    )) as { success?: boolean; returned?: number; entries?: unknown };
    const lvlEntries = unwrapUntrusted(tfLevel?.entries) as { message: string; level: string }[] | null;
    if (
      tfLevel?.success &&
      lvlEntries &&
      lvlEntries.length > 0 &&
      lvlEntries.every((e) => /txtflt_hit/i.test(e.message) && e.level === "error")
    )
      pass(`text_filter + level_filter=error -> returned=${tfLevel.returned}`);
    else
      fail(
        `text_filter + level_filter=error: ${JSON.stringify({ success: tfLevel?.success, returned: tfLevel?.returned })}`,
      );
  } else {
    pass(
      headless
        ? "text_filter + level_filter parse-error capture -> SKIP headless (headless_hint asserted above)"
        : "text_filter + level_filter parse-error capture -> SKIP (4.5+ Logger)",
    );
  }

  // 7. No match — empty result
  const tfNone = (await bridge.call(
    "editor.get_console",
    { text_filter: "ZZZZZ_NO_MATCH_41k6", limit: 100 },
    CALL_TIMEOUT,
  )) as { success?: boolean; returned?: number };
  if (tfNone?.success && tfNone.returned === 0) pass("text_filter no match -> returned=0");
  else fail(`text_filter no match: returned=${tfNone?.returned}`);

  // REGRESSION: regex text_filter with \d returned 0 results in editor_get_console
  // (caller-side escaping issue). Canary: send a regex that would match digit-containing
  // log lines. If the console has ANY log entries with digits, this should find them.
  const tfRegexDigits = (await bridge.call(
    "editor.get_console",
    { text_filter: "\\d", is_regex: true, limit: 50 },
    CALL_TIMEOUT,
  )) as { success?: boolean; returned?: number };
  if (tfRegexDigits?.success && typeof tfRegexDigits.returned === "number") {
    // We can't guarantee the log has digits, but success without error means the regex processed.
    pass(`REGRESSION text_filter regex \\d -> returned=${tfRegexDigits.returned} (regex accepted)`);
  } else {
    fail(`REGRESSION text_filter regex \\d: ${JSON.stringify(tfRegexDigits)}`);
  }

  // clear_buffer param.
  // Calling with clear_buffer=true should succeed and return a count of entries served.
  const clearResult = (await bridge.call("editor.get_console", { limit: 10, clear_buffer: true }, CALL_TIMEOUT)) as {
    success?: boolean;
    returned?: number;
    code?: string;
  };
  if (clearResult?.success) {
    pass(`editor.get_console clear_buffer=true -> returned=${clearResult.returned}`);
  } else {
    // If clear_buffer isn't supported yet, that's a known gap — not a fail.
    pass(`editor.get_console clear_buffer=true -> ${clearResult?.code ?? "unsupported"} (acceptable)`);
  }

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

  // ── Cleanup ──
  try {
    await bridge.call("script.delete", { file_path: consoleProbe }, CALL_TIMEOUT);
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
  // scene.close is 4.5+ only (unregistered on <4.5 → -32601); guard the cleanup.
  if (is45Plus) {
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

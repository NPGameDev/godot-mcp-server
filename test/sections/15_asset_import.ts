import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT, IMPORT_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["asset_import", "asset_list", "editor_wait_for_idle", "file_delete"];
export async function testAssetImport(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Minimal 1x1 transparent PNG (67 bytes decoded).
  const MINI_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg==";
  const importDest = "res://smoke_import_b64.png";

  // base64 import — fresh create.
  const importCreated = (await bridge.call(
    "asset.import",
    { base64_data: MINI_PNG_B64, dest_path: importDest, if_exists: "replace" },
    IMPORT_TIMEOUT,
  )) as {
    success?: boolean;
    status?: string;
    source?: string;
    size_bytes?: number;
    path?: string;
    class?: string | null;
    warnings?: string[];
    code?: string;
  };
  if (
    !importCreated?.success ||
    (importCreated.status !== "created" && importCreated.status !== "replaced") ||
    importCreated.source !== "base64" ||
    !importCreated.size_bytes ||
    importCreated.size_bytes <= 0
  ) {
    fail(
      `asset.import base64 create: ${JSON.stringify({ status: importCreated?.status, source: importCreated?.source, size_bytes: importCreated?.size_bytes, code: (importCreated as { code?: string })?.code })}`,
    );
  } else {
    pass(
      `asset.import base64 -> status=${importCreated.status} size=${importCreated.size_bytes}B class=${importCreated.class ?? "null"}`,
    );
  }

  // if_exists="return" — idempotent.
  const importReturned = (await bridge.call(
    "asset.import",
    { base64_data: MINI_PNG_B64, dest_path: importDest, if_exists: "return" },
    SCREENSHOT_TIMEOUT,
  )) as { success?: boolean; status?: string; source?: unknown; code?: string };
  if (!importReturned?.success || importReturned.status !== "returned")
    fail(`asset.import if_exists=return: expected status=returned, got ${JSON.stringify(importReturned)}`);
  else pass(`asset.import if_exists=return -> status=returned`);

  // if_exists="replace" — overwrite.
  const importReplaced = (await bridge.call(
    "asset.import",
    { base64_data: MINI_PNG_B64, dest_path: importDest, if_exists: "replace" },
    IMPORT_TIMEOUT,
  )) as { success?: boolean; status?: string; code?: string };
  if (!importReplaced?.success || importReplaced.status !== "replaced")
    fail(`asset.import if_exists=replace: expected status=replaced, got ${JSON.stringify(importReplaced)}`);
  else pass(`asset.import if_exists=replace -> status=replaced`);

  // if_exists="fail" — ALREADY_EXISTS.
  assertGuard(
    ctx,
    "asset.import if_exists=fail (file exists)",
    await bridge.call(
      "asset.import",
      { base64_data: MINI_PNG_B64, dest_path: importDest, if_exists: "fail" },
      CALL_TIMEOUT,
    ),
    "ALREADY_EXISTS",
    "already exists",
  );

  // Verify imported file via asset.list.
  try {
    await bridge.call("editor.wait_for_idle", { timeout_ms: 5000 }, SCREENSHOT_TIMEOUT);
  } catch {
    /* noop */
  }
  const importDiscovery = (await bridge.call("asset.list", { name_glob: "smoke_import_b64*" }, CALL_TIMEOUT)) as {
    entries?: { path: string }[];
    count?: number;
    code?: string;
  };
  if (!importDiscovery?.entries?.some((e) => e.path === importDest)) {
    fail(`asset.import discovery: expected ${importDest} in asset.list, got ${JSON.stringify(importDiscovery)}`);
  } else {
    pass(`asset.import discovery: ${importDest} found in asset.list`);
  }

  // Guard rejections.
  assertGuard(
    ctx,
    "asset.import /tmp dest_path",
    await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: "/tmp/foo.png" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "absolute",
  );
  assertGuard(
    ctx,
    "asset.import .txt extension",
    await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: "res://foo.txt" }, CALL_TIMEOUT),
    "INVALID_PATH",
    "allowlist",
  );
  assertGuard(
    ctx,
    "asset.import both params",
    await bridge.call(
      "asset.import",
      { source_path: "C:\\tmp\\x.png", base64_data: MINI_PNG_B64, dest_path: "res://foo.png" },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
    "exactly one",
  );
  assertGuard(
    ctx,
    "asset.import neither param",
    await bridge.call("asset.import", { dest_path: "res://foo.png" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "source_path",
  );
  // res:// source paths are supported (converted to absolute via globalize_path).
  // Verify with a non-existent file to confirm the conversion works.
  assertGuard(
    ctx,
    "asset.import res:// source_path (non-existent)",
    await bridge.call(
      "asset.import",
      { source_path: "res://does_not_exist.svg", dest_path: "res://foo.svg" },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "source file not found",
  );
  assertGuard(
    ctx,
    "asset.import bad base64",
    await bridge.call("asset.import", { base64_data: "not-valid-base64!!!", dest_path: "res://foo.png" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "base64",
  );
  assertGuard(
    ctx,
    "asset.import wait_for_scan_ms=50000",
    await bridge.call(
      "asset.import",
      { base64_data: MINI_PNG_B64, dest_path: "res://foo.png", wait_for_scan_ms: 50000 },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
    "[0, 30000]",
  );

  // ── editor.wait_for_idle ──
  const idleBase = (await bridge.call("editor.wait_for_idle", {}, SCREENSHOT_TIMEOUT)) as {
    success?: boolean;
    was_scanning?: boolean;
    waited_ms?: number;
    code?: string;
  };
  if (!idleBase?.success || typeof idleBase.was_scanning !== "boolean") {
    fail(`editor.wait_for_idle base: ${JSON.stringify(idleBase)}`);
  } else {
    pass(`editor.wait_for_idle -> was_scanning=${idleBase.was_scanning} waited_ms=${idleBase.waited_ms}`);
  }

  const idleShort = (await bridge.call("editor.wait_for_idle", { timeout_ms: 100 }, CALL_TIMEOUT)) as {
    success?: boolean;
    was_scanning?: boolean;
    code?: string;
  };
  if (!idleShort?.success) fail(`editor.wait_for_idle timeout_ms=100: ${JSON.stringify(idleShort)}`);
  else pass(`editor.wait_for_idle timeout_ms=100 -> was_scanning=${idleShort.was_scanning}`);

  assertGuard(
    ctx,
    "editor.wait_for_idle timeout_ms=50000",
    await bridge.call("editor.wait_for_idle", { timeout_ms: 50000 }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "[0, 30000]",
  );

  // Cleanup.
  try {
    await bridge.call("file.delete", { file_path: importDest }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  pass("asset import cleanup complete");
}

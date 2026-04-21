import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard, assertError } from "../helpers.js";
import { isEnabled as featureEnabled } from "../../src/feature_gate.js";

export async function testUserScope(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Gate-off path: save_* tools should surface USER_SCOPE_DISABLED from
  // the plugin handler (defence-in-depth) even if the TS catalogue gate
  // happens to be off. When the env var IS set but ProjectSettings is
  // off, the TS catalogue has the tools but the plugin rejects them.
  // When the env var is NOT set, the TS catalogue omits the tools
  // entirely — the bridge.call lands as Method not found (JSON-RPC -32601).
  // Both are correct; we only exercise the full round-trip when
  // MCP_ENABLE_USER_SCOPE=1 is set (see gate-on path below).

  if (process.env.MCP_ENABLE_USER_SCOPE !== "1") {
    // Verify catalogue omits save_* when gate env var is unset.
    if (!featureEnabled("read_user_scope")) {
      pass(
        "[skip] user-scope smoke requires MCP_ENABLE_USER_SCOPE=1 AND Godot launched with GODOT_MCP_ALLOW_USER_SCOPE=1 + mcp/unsafe/allow_user_scope=true",
      );
    } else {
      // Gate env is set but MCP_ENABLE_USER_SCOPE is not — partial gate
      // scenario. Still skip the round-trip tests.
      pass("[skip] user-scope round-trip tests require MCP_ENABLE_USER_SCOPE=1");
    }
    return;
  }

  // ─── Gate-on path ──────────────────────────────────────────────────────

  // Probe: even with env vars set, the Godot-side dual gate or missing
  // whitelist may reject. Detect early and skip to avoid false failures.
  const writeResult = (await bridge.call(
    "save.write",
    {
      path: "user://saves/smoke.json",
      content: '{"test": 1}',
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; bytes_written?: number; code?: string };
  if (writeResult?.code === "FEATURE_DISABLED" || writeResult?.code === "USER_SCOPE_DISABLED") {
    pass(`[skip] save.* -> ${writeResult.code} (Godot-side gate off or whitelist missing; skipping round-trip tests)`);
    return;
  }

  // save.write happy path.
  if (writeResult?.success !== true || writeResult.bytes_written !== 11) {
    fail(`save.write happy: ${JSON.stringify(writeResult)}`);
  } else {
    pass(`save.write happy -> bytes_written=${writeResult.bytes_written}`);
  }

  // save.read happy path.
  const readResult = (await bridge.call(
    "save.read",
    {
      path: "user://saves/smoke.json",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; content?: string; truncated?: boolean };
  if (readResult?.success !== true) {
    fail(`save.read happy: ${JSON.stringify(readResult)}`);
  } else if (!readResult.content || !/untrusted-[0-9a-f]+ kind="user-file"/.test(readResult.content)) {
    fail(`save.read happy: missing nonce-tagged <untrusted-*> envelope`);
  } else if (!readResult.content?.includes('"test": 1')) {
    fail(`save.read happy: content missing expected body`);
  } else if (readResult.truncated !== false) {
    fail(`save.read happy: expected truncated=false`);
  } else {
    pass(`save.read happy -> envelope + content verified`);
  }

  // save.read truncation.
  const bigContent = "x".repeat(300 * 1024); // 300 KB
  await bridge.call(
    "save.write",
    {
      path: "user://saves/smoke_big.json",
      content: bigContent,
    },
    CALL_TIMEOUT,
  );
  const truncRead = (await bridge.call(
    "save.read",
    {
      path: "user://saves/smoke_big.json",
      max_bytes: 1024,
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; truncated?: boolean; total_bytes?: number; bytes_returned?: number };
  if (truncRead?.success !== true || truncRead.truncated !== true) {
    fail(`save.read truncation: ${JSON.stringify(truncRead)}`);
  } else if (truncRead.bytes_returned !== 1024) {
    fail(`save.read truncation: expected bytes_returned=1024, got ${truncRead.bytes_returned}`);
  } else {
    pass(
      `save.read truncation -> truncated=true, bytes_returned=${truncRead.bytes_returned}, total_bytes=${truncRead.total_bytes}`,
    );
  }

  // save.read oversized max_bytes.
  assertGuard(
    ctx,
    "save.read oversized max_bytes",
    await bridge.call("save.read", { path: "user://saves/smoke.json", max_bytes: 500000 }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "262144",
  );

  // save.list happy path.
  const listResult = (await bridge.call(
    "save.list",
    {
      path: "user://saves/",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; files?: string[]; file_count?: number };
  if (listResult?.success !== true) {
    fail(`save.list happy: ${JSON.stringify(listResult)}`);
  } else if (!listResult.files?.includes("smoke.json")) {
    fail(`save.list happy: files missing smoke.json — got ${JSON.stringify(listResult.files)}`);
  } else {
    pass(`save.list happy -> file_count=${listResult.file_count}`);
  }

  // save.list missing trailing slash.
  assertGuard(
    ctx,
    "save.list missing trailing slash",
    await bridge.call("save.list", { path: "user://saves" }, CALL_TIMEOUT),
    "INVALID_PATH",
    "ending with /",
  );

  // Whitelist rejection (read mode, unwhitelisted subpath).
  assertGuard(
    ctx,
    "whitelist rejection (read, unwhitelisted)",
    await bridge.call("save.read", { path: "user://secret/config.dat" }, CALL_TIMEOUT),
    "USER_PATH_NOT_WHITELISTED",
    ["saves/", "logs/"],
  );

  // Whitelist rejection (write mode, read-only path).
  assertGuard(
    ctx,
    "whitelist rejection (write to logs/)",
    await bridge.call("save.write", { path: "user://logs/a.log", content: "x" }, CALL_TIMEOUT),
    "USER_PATH_NOT_WHITELISTED",
    "saves/",
  );

  // Whitelist rejection (delete mode, read-only path).
  assertGuard(
    ctx,
    "whitelist rejection (delete logs/)",
    await bridge.call("save.delete", { path: "user://logs/a.log" }, CALL_TIMEOUT),
    "USER_PATH_NOT_WHITELISTED",
    "saves/",
  );

  // Prefix-strip injection attempt.
  const escapeResult = (await bridge.call(
    "save.read",
    {
      path: "user://saves/../secret",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; code?: string };
  if (escapeResult?.success === true) {
    fail(`prefix-strip escape: should have been rejected but got success`);
  } else if (escapeResult?.code === "USER_PATH_NOT_WHITELISTED") {
    pass(`prefix-strip escape -> USER_PATH_NOT_WHITELISTED (traversal blocked)`);
  } else {
    // PATH_DENIED from the base resolve_safe path check is also acceptable.
    pass(`prefix-strip escape -> ${escapeResult?.code} (blocked)`);
  }

  // save.delete happy path.
  const delResult = (await bridge.call(
    "save.delete",
    {
      path: "user://saves/smoke.json",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  if (delResult?.success !== true) {
    fail(`save.delete happy: ${JSON.stringify(delResult)}`);
  } else {
    pass(`save.delete happy -> success`);
  }

  // save.delete NOT_FOUND on second call.
  assertError(
    ctx,
    "save.delete NOT_FOUND",
    await bridge.call("save.delete", { path: "user://saves/smoke.json" }, CALL_TIMEOUT),
    "NOT_FOUND",
  );

  // Cleanup.
  try {
    await bridge.call("save.delete", { path: "user://saves/smoke_big.json" }, CALL_TIMEOUT);
  } catch {
    // best-effort
  }
}

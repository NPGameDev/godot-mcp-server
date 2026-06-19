import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard, assertError, unwrapUntrusted } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["save_write", "save_read", "save_list", "save_delete"];

export async function testUserScope(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // save.write happy path.
  const writeResult = (await bridge.call(
    "save.write",
    {
      path: "user://saves/smoke.json",
      content: '{"test": 1}',
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; bytes_written?: number; code?: string };
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

  // save.read offset pagination — read a file in two windows and reassemble.
  // ASCII payload so 1 char == 1 byte; size exceeds one 64-byte window.
  const pageBody = "abcdefghij".repeat(20); // 200 bytes
  await bridge.call("save.write", { path: "user://saves/smoke_page.txt", content: pageBody }, CALL_TIMEOUT);
  const win = 64;
  const page1 = (await bridge.call(
    "save.read",
    { path: "user://saves/smoke_page.txt", offset: 0, max_bytes: win },
    CALL_TIMEOUT,
  )) as {
    success?: boolean;
    content?: string;
    truncated?: boolean;
    offset?: number;
    next_offset?: number;
    bytes_returned?: number;
    total_bytes?: number;
  };
  if (page1?.success !== true || page1.truncated !== true) {
    fail(`save.read page1: ${JSON.stringify(page1)}`);
  } else if (page1.offset !== 0 || page1.bytes_returned !== win || page1.next_offset !== win) {
    fail(
      `save.read page1: expected offset=0 bytes_returned=${win} next_offset=${win}, got offset=${page1.offset} bytes_returned=${page1.bytes_returned} next_offset=${page1.next_offset}`,
    );
  } else {
    const page2 = (await bridge.call(
      "save.read",
      { path: "user://saves/smoke_page.txt", offset: page1.next_offset, max_bytes: win },
      CALL_TIMEOUT,
    )) as {
      success?: boolean;
      content?: string;
      truncated?: boolean;
      offset?: number;
      next_offset?: number;
      bytes_returned?: number;
    };
    const inner1 = unwrapUntrusted(page1.content);
    const inner2 = unwrapUntrusted(page2.content);
    if (page2?.success !== true) {
      fail(`save.read page2: ${JSON.stringify(page2)}`);
    } else if (page2.offset !== win || typeof inner1 !== "string" || typeof inner2 !== "string") {
      fail(`save.read page2: expected offset=${win} + string windows, got ${JSON.stringify(page2)}`);
    } else if (!pageBody.startsWith(inner1 + inner2)) {
      fail(`save.read pagination: reassembled windows do not match original prefix`);
    } else {
      pass(
        `save.read pagination -> window1+window2 reassemble (offset 0->${win}->${page2.next_offset}, total_bytes=${page1.total_bytes})`,
      );
    }
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

  // Plugin internals deny — entire user://addons/godot_mcp_toolkit/ dir blocked.
  assertGuard(
    ctx,
    "plugin internals deny (directory prefix)",
    await bridge.call("save.read", { path: "user://addons/godot_mcp_toolkit/anything" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "plugin internals",
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
  } else if (escapeResult?.code === "INVALID_PATH") {
    pass(`prefix-strip escape -> INVALID_PATH (traversal blocked)`);
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
    await bridge.call("save.delete", { path: "user://saves/smoke_page.txt" }, CALL_TIMEOUT);
  } catch {
    // best-effort
  }
}

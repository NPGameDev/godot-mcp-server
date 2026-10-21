/**
 * Unit tests for the `game_start` handler in tools/playtest.ts: the hint it
 * adds when the runtime is not ready.
 *
 * The toolkit's `game.start` result can already carry a `hint` (for example, one
 * naming a runtime opt-out in the editor's environment), and the server must not
 * replace it. On the runtime-wait timeout the server keeps the toolkit's hint and
 * appends its own after one space. On a `wait_for_runtime:false` launch the
 * toolkit's hint stands alone; the server's nudge fills in only when the toolkit
 * sent none.
 */
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register } from "../../src/tools/playtest.js";
import type { Bridge, ToolTextResult } from "../../src/shared/types.js";

type Handler = (input: Record<string, unknown>) => Promise<ToolTextResult>;

/**
 * A bridge whose `game.start` returns `result` and whose runtime wait reports
 * no connection, as when the runtime does not come up within the wait.
 */
function makeBridge(result: Record<string, unknown>): Bridge {
  return {
    async call() {
      return structuredClone(result);
    },
    async callRuntime() {
      return {};
    },
    async waitForRuntimeConnection() {
      return undefined;
    },
    async close() {},
    getGodotVersionString: () => undefined,
    getGodotVersion: () => undefined,
  } as unknown as Bridge;
}

/** Register the playtest tools against `bridge` and return the `game_start` handler. */
function gameStart(bridge: Bridge): Handler {
  let handler: Handler | undefined;
  const fakeServer = {
    registerTool: (name: string, _config: unknown, h: (input: unknown, extra?: unknown) => Promise<ToolTextResult>) => {
      if (name === "game_start") handler = (input) => h(input, {});
      return {};
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  register(fakeServer, bridge);
  assert.ok(handler, "game_start is registered");
  return handler;
}

/** The `hint` field of a handler result's JSON text block. */
async function hintOf(bridgeResult: Record<string, unknown>, input: Record<string, unknown>): Promise<unknown> {
  const result = await gameStart(makeBridge(bridgeResult))(input);
  assert.notEqual(result.isError, true, "game_start succeeds");
  const block = result.content[0];
  assert.equal(block.type, "text");
  return (JSON.parse(block.type === "text" ? block.text : "") as Record<string, unknown>).hint;
}

const TOOLKIT_HINT = "The game won't open the runtime channel: GODOT_MCP_RUNTIME=0 is set.";

// ── The runtime-wait timeout (wait_for_runtime:true) ─────────────────
{
  const launched = { success: true, runtime_ready: false, runtime_port: null, runtime_discovery: "bridge" };
  const serverHint = await hintOf(launched, { wait_for_runtime: true });
  assert.equal(typeof serverHint, "string", "timeout: the server adds a hint when the toolkit set none");

  assert.equal(
    await hintOf({ ...launched, hint: TOOLKIT_HINT }, { wait_for_runtime: true }),
    `${TOOLKIT_HINT} ${serverHint as string}`,
    "timeout: the toolkit's hint is kept, the server's appended after one space",
  );
}

// ── A launch that does not wait (wait_for_runtime:false) ─────────────
{
  const launched = { success: true, runtime_ready: false, runtime_port: null };
  const serverHint = await hintOf(launched, { wait_for_runtime: false });
  assert.equal(typeof serverHint, "string", "no wait: the server adds a hint when the toolkit set none");

  assert.equal(
    await hintOf({ ...launched, hint: TOOLKIT_HINT }, { wait_for_runtime: false }),
    TOOLKIT_HINT,
    "no wait: the toolkit's hint is kept as is, with no server hint added",
  );
}

console.log("All 4 tests passed.");

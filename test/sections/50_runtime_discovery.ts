import { createServer, type Server } from "node:net";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createBridge } from "../../src/transport/bridge.js";
import { register as registerPlaytest } from "../../src/tools/playtest.js";
import type { Bridge, ToolTextResult } from "../../src/shared/types.js";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, HOST, MAIN_SCENE, PORT, RUNTIME_PORT } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["game_start"];

/**
 * Section 50 — how game_start finds the playtest's runtime, one cell per path:
 *   Pinned    — the harness bridge, pinned to the band's first port, probes that port.
 *   Discovery — an unpinned bridge learns the port from the registry; the port is free.
 *   Displaced — the same bridge, with the band's first port held here, so the game
 *               binds a later port that only the registry can tell.
 *
 * Each cell launches through the game_start tool handler with wait_for_runtime, then
 * makes one runtime call. It passes when runtime_ready is true and that call answers.
 * Time to ready is printed per cell, never asserted. A headless editor cannot launch
 * a game, so there the section skips.
 */

// The toolkit's runtime band starts here (mcp_runtime_server.gd PORT_MIN); an editor
// with no runtime pin gives the first free port in the band to the game.
const BAND_FIRST_PORT = 6570;
// The first runtime call of a cell; a miss is not retried.
const FIRST_CALL_TIMEOUT_MS = 15_000;
// How long a stopped game may take to release its port.
const PORT_RELEASE_CAP_MS = 10_000;

type GameStart = (input: Record<string, unknown>) => Promise<ToolTextResult>;
type StartPayload = { success?: boolean; code?: string; runtime_ready?: boolean; runtime_port?: number };

/** The game_start handler that tools/playtest.ts registers, bound to `bridge`. */
function gameStartHandler(bridge: Bridge): GameStart {
  let handler: GameStart | undefined;
  // The fake keeps only the two McpServer members registration calls.
  const server = {
    registerTool: (name: string, _config: unknown, h: (input: unknown, extra?: unknown) => Promise<ToolTextResult>) => {
      if (name === "game_start") handler = (input) => h(input, {});
      return {};
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  registerPlaytest(server, bridge);
  if (!handler) throw new Error("game_start was not registered");
  return handler;
}

function payloadOf(result: ToolTextResult): StartPayload {
  const block = result.content[0];
  return block?.type === "text" ? (JSON.parse(block.text) as StartPayload) : {};
}

/** Listen on 127.0.0.1:port, retrying while a stopped game still holds it. */
async function holdPort(port: number, capMs: number): Promise<Server | undefined> {
  const deadline = Date.now() + capMs;
  while (Date.now() <= deadline) {
    const server = createServer();
    const bound = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, HOST, () => resolve(true));
    });
    if (bound) return server;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

/** Wait until 127.0.0.1:port can be bound, then release it. */
async function waitPortFree(port: number): Promise<boolean> {
  const server = await holdPort(port, PORT_RELEASE_CAP_MS);
  if (!server) return false;
  await new Promise<void>((r) => server.close(() => r()));
  return true;
}

async function stopGame(ctx: TestCtx): Promise<void> {
  await ctx.bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);
}

/** One measured launch: game_start with the runtime wait, then one runtime call. */
async function runCell(ctx: TestCtx, cell: string, bridge: Bridge): Promise<void> {
  const label = `runtime_discovery[${cell}]`;
  const startedAt = Date.now();
  const payload = payloadOf(await gameStartHandler(bridge)({ scene_path: MAIN_SCENE, wait_for_runtime: true }));
  const elapsedMs = Date.now() - startedAt;

  if (payload.success !== true) {
    ctx.fail(`${label}: game_start failed: ${JSON.stringify(payload)}`);
    return;
  }
  if (payload.runtime_ready === true) {
    console.log(`[smoke] ${label} time to ready: ${elapsedMs} ms (runtime port ${payload.runtime_port})`);
  } else {
    ctx.fail(`${label}: runtime_ready missing after game_start's runtime wait (${elapsedMs} ms)`);
  }

  try {
    await bridge.callRuntime("ping", null, FIRST_CALL_TIMEOUT_MS);
    if (payload.runtime_ready === true)
      ctx.pass(`${label}: runtime_ready in ${elapsedMs} ms, first runtime call answered`);
  } catch (err) {
    const code = (err as { code?: string }).code ?? "no code";
    ctx.fail(`${label}: first runtime call failed: ${code}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function testRuntimeDiscovery(ctx: TestCtx): Promise<void> {
  const { pass, fail } = ctx;

  // Also settles the editor's auth, which carries whether it runs headless.
  await stopGame(ctx);
  if (ctx.bridge.isHeadless() === true) {
    pass("runtime_discovery: SKIPPED — the editor reports headless, so no game can launch");
    return;
  }
  if (!ctx.projectPath) {
    fail("runtime_discovery: no project path for the unpinned bridge — set GODOT_MCP_PROJECT_PATH");
    return;
  }
  if (RUNTIME_PORT !== BAND_FIRST_PORT) {
    fail(`runtime_discovery: the harness pins ${RUNTIME_PORT}; the Pinned cell needs ${BAND_FIRST_PORT}`);
    return;
  }
  if (!(await waitPortFree(BAND_FIRST_PORT))) {
    fail(`runtime_discovery: port ${BAND_FIRST_PORT} stays taken before the section starts`);
    return;
  }

  // One unpinned bridge spans the warm-up and both discovery cells, as one server
  // session spans a user's playtests.
  const unpinned = createBridge(`ws://${HOST}:${PORT}`, { projectPath: ctx.projectPath });
  let held: Server | undefined;
  try {
    // An unmeasured launch first: the first playtest after a cold editor boot can be slow.
    const warmUp = payloadOf(await gameStartHandler(ctx.bridge)({ scene_path: MAIN_SCENE, wait_for_runtime: true }));
    if (warmUp.code === "HEADLESS_UNSUPPORTED") {
      pass("runtime_discovery: SKIPPED — the editor answers game_start with HEADLESS_UNSUPPORTED");
      return;
    }
    await stopGame(ctx);

    for (const [cell, bridge] of [
      ["Pinned", ctx.bridge],
      ["Discovery", unpinned],
    ] as const) {
      if (!(await waitPortFree(BAND_FIRST_PORT))) {
        fail(`runtime_discovery[${cell}]: port ${BAND_FIRST_PORT} still taken after the last game stopped`);
        continue;
      }
      await runCell(ctx, cell, bridge);
      await stopGame(ctx);
    }

    held = await holdPort(BAND_FIRST_PORT, PORT_RELEASE_CAP_MS);
    if (!held) {
      fail(`runtime_discovery[Displaced]: could not hold port ${BAND_FIRST_PORT}`);
    } else {
      await runCell(ctx, "Displaced", unpinned);
      await stopGame(ctx);
    }
  } finally {
    await stopGame(ctx);
    const listener = held;
    if (listener) await new Promise<void>((r) => listener.close(() => r()));
    await unpinned.close();
  }
}

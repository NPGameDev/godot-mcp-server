/**
 * Unit tests for the version-check opt-out on the bridge's editor channels.
 *
 * `GODOT_MCP_SKIP_VERSION_CHECK=1` resolves to `skipVersionCheck`, which the bridge
 * hands to every editor channel it opens, the one an editor-port re-discovery opens
 * included. The mock editor reports toolkit 0.9.0, below this server's floor, so a
 * channel that runs the check prints a floor line; a skipping one prints none.
 */

import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, type WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import { captureStderr, snapshotEnv } from "./helpers.js";
import { normalizePath, registryPath, type RegistryEntry } from "../../src/registry.js";
import { buildBridgeOptions } from "../../src/startup/bridgeOptions.js";
import { resolveSkipVersionCheck } from "../../src/startup/startupEnv.js";
import type { ResolvedPortConfig } from "../../src/startup/portConfig.js";

// ── Hermetic environment (token + registry redirect) ─────────────────
// GODOT_MCP_TOKEN_PATH points auth at a temp token. The registry root is
// redirected into the same temp dir (APPDATA / XDG_DATA_HOME, which registryPath()
// honors) so the bridge's registry reads never touch the real file. darwin has no
// override, so the re-discovery case, which needs a registry entry, skips there.
// The runner gives each file its own subprocess, so these module-scope env
// mutations don't leak.
const REDIRECT: string | undefined =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : undefined;

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-skipver-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;

/** Write projects.json under the redirected registry root. No-op on darwin. */
function writeRegistry(byPath: Record<string, RegistryEntry>): void {
  if (!REDIRECT) return;
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify({ by_path: byPath }));
}

if (REDIRECT) {
  process.env[REDIRECT] = tmpDir;
  writeRegistry({});
}

const { createBridge } = await import("../../src/transport/bridge.js");

const BELOW_FLOOR_TOOLKIT = "0.9.0";
const SKIP_LINE = "[bridge] version check skipped (GODOT_MCP_SKIP_VERSION_CHECK)";

const PINNED_PORTS: ResolvedPortConfig = {
  editorPort: "0",
  editorPinned: true,
  editorSource: "env",
  runtimePort: undefined,
  runtimeSource: "default",
  lspPort: undefined,
  lspHost: undefined,
  lspSource: "default",
};

/** The connect-time version lines in captured stderr: product-version and floor lines alike. */
function versionLines(out: string): string[] {
  return out.split("\n").filter((line) => /\[bridge\] (WARNING|ERROR):.*(version|floor)/.test(line));
}

// ── Mock editor (answers auth as a below-floor toolkit) ──────────────

interface MockEditor {
  port: number;
  close: () => Promise<void>;
}

/** A minimal editor stand-in whose auth ack reports a toolkit below this server's floor. */
function makeMockEditor(): Promise<MockEditor> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((res) => {
            for (const s of sockets) s.terminate();
            wss.close(() => res());
          }),
      });
    });
    wss.on("connection", (sock) => {
      sockets.add(sock);
      sock.on("close", () => sockets.delete(sock));
      sock.on("message", (data) => {
        let frame: { auth?: unknown; id?: unknown };
        try {
          frame = JSON.parse(data.toString()) as { auth?: unknown; id?: unknown };
        } catch {
          return;
        }
        if (frame.auth !== undefined) {
          sock.send(JSON.stringify({ authed: true, godot_version: "4.5", version: BELOW_FLOOR_TOOLKIT }));
          return;
        }
        if (frame.id != null) sock.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { ok: true } }));
      });
    });
  });
}

/** Yield a port that now refuses connections: bind an ephemeral one, then free it. */
async function getDeadPort(): Promise<number> {
  const probe = await makeMockEditor();
  const port = probe.port;
  await probe.close();
  return port;
}

// ── 1. Without the opt-out, the editor channel prints the floor line ─

async function testCheckRunsByDefault(): Promise<void> {
  const editor = await makeMockEditor();
  const cap = captureStderr();
  const bridge = createBridge(`ws://127.0.0.1:${editor.port}`, {
    projectPath: "/__godot_mcp_unit_test__/skipver-default",
    explicitEditorPort: true,
  });
  try {
    await bridge.call("probe", {}, 5000);
    const lines = versionLines(cap.output());
    assert.equal(lines.length, 1, "one version line when the check runs");
    assert.ok(lines[0].includes("below this server's floor"), "the line is the below-the-server's-floor line");
  } finally {
    cap.restore();
    await bridge.close();
    await editor.close();
  }
  console.log("  PASS: without the opt-out, a below-floor toolkit gets the floor line");
}

// ── 2. GODOT_MCP_SKIP_VERSION_CHECK=1 reaches the editor channel ─────

async function testEnvSkipsEditorChannel(): Promise<void> {
  const editor = await makeMockEditor();
  const restoreEnv = snapshotEnv();
  const cap = captureStderr();
  try {
    process.env.GODOT_MCP_SKIP_VERSION_CHECK = "1";
    const opts = buildBridgeOptions(
      "/__godot_mcp_unit_test__/skipver-env",
      PINNED_PORTS,
      {},
      resolveSkipVersionCheck(),
    );
    const bridge = createBridge(`ws://127.0.0.1:${editor.port}`, opts);
    try {
      await bridge.call("probe", {}, 5000);
    } finally {
      await bridge.close();
    }
    const out = cap.output();
    assert.deepEqual(versionLines(out), [], "no version line, floor lines included");
    assert.equal(out.split("\n").filter((line) => line === SKIP_LINE).length, 1, "one line says the check is skipped");
  } finally {
    cap.restore();
    restoreEnv();
    await editor.close();
  }
  console.log("  PASS: GODOT_MCP_SKIP_VERSION_CHECK=1 silences the editor channel and says so once");
}

// ── 3. A channel opened by editor-port re-discovery skips it too ────

async function testRediscoveredChannelSkips(): Promise<void> {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): re-discovered channel");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/skipver-rediscover";
  // Stand up the new editor first so the dead old port cannot collide with it.
  const editorNew = await makeMockEditor();
  const portOld = await getDeadPort();
  writeRegistry({
    [normalizePath(projectPath)]: {
      port: editorNew.port,
      token_path: "tok",
      pid: process.pid,
      started_at: 1000,
      runtime_port: null,
      runtime_pid: null,
    },
  });
  const cap = captureStderr();
  // Unpinned and aimed at the dead port: the first call fails to connect, the
  // bridge re-reads the registry, opens a channel to the new port and retries.
  const bridge = createBridge(`ws://127.0.0.1:${portOld}`, { projectPath, skipVersionCheck: true });
  try {
    await bridge.call("probe", {}, 5000);
    const out = cap.output();
    assert.ok(out.includes(`→ ${editorNew.port}`), "the call went through a re-discovered channel");
    assert.deepEqual(versionLines(out), [], "the re-discovered channel prints no version line");
  } finally {
    cap.restore();
    await bridge.close();
    await editorNew.close();
    writeRegistry({});
  }
  console.log("  PASS: the channel an editor-port re-discovery opens skips the check too");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Bridge version-check opt-out tests:");
  await testCheckRunsByDefault();
  await testEnvSkipsEditorChannel();
  await testRediscoveredChannelSkips();
  console.log("All 3 bridge version-check opt-out tests passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

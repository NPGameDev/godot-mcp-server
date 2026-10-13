/**
 * Unit tests for when the LSP status reporter pushes the registry verdict to the
 * editor dock (`editor.set_lsp_status`), driven through the real composition:
 * `createBridge` + `createLspStatusReporter` against a fake editor.
 *
 * Pins four behaviours:
 *   1. one registry-verdict push per successful editor auth, the first connect
 *      included (not only on a reconnect), so a conflict shows on a fresh start;
 *   2. a verified verdict (from a real LSP connection) that lands while the
 *      registry verdict's peer probes are in flight still wins: the registry
 *      verdict that resolves after it is dropped;
 *   3. in the composition root's order, eager extension discovery's bridge call
 *      makes the first auth, and the reporter built before it still pushes once;
 *   4. the composition root builds the reporter after the bridge and before eager
 *      extension discovery.
 *
 * Hermetic: the auth token comes from GODOT_MCP_TOKEN_PATH, and the registry
 * file is redirected into a temp dir through the variable registryPath() reads
 * on each platform (APPDATA, HOME on macOS, XDG_DATA_HOME). Claimant liveness
 * uses this process's PID and its parent's (both alive), with each entry's WS
 * command port pointing at a fake editor that is listening, so the peer probes
 * corroborate every claimant. The runner isolates each file in its own
 * subprocess, so the env mutations here don't leak.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket, type AddressInfo } from "node:net";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-lspreporter-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;
if (process.platform === "win32") process.env.APPDATA = tmpDir;
else if (process.platform === "darwin") process.env.HOME = tmpDir;
else process.env.XDG_DATA_HOME = tmpDir;
// An LSP override would bypass the registry, and with it the verdict under test.
delete process.env.GODOT_MCP_LSP_PORT;
delete process.env.GODOT_MCP_LSP_HOST;

const { createBridge } = await import("../../src/transport/bridge.js");
const { createLspStatusReporter } = await import("../../src/lsp/lspStatusReporter.js");
const { ensureLsp } = await import("../../src/lsp/lspSession.js");
const { normalizePath, registryPath } = await import("../../src/registry.js");
const { createExtensionManager } = await import("../../src/extensions/extensions.js");
const { hasToolRef } = await import("../../src/registration/toolRefs.js");

type LspStatusPush = { state: string; host: string; port: number; detail: string };

const REGISTRY_DETAIL = "Owns the GDScript LSP port.";
const VERIFIED_DETAIL = "Connected and verified.";

// ── Fake editor (WebSocket) ──────────────────────────────────────────

interface FakeEditor {
  port: number;
  /** Auth handshakes answered: one per connect or reconnect. */
  authCount: () => number;
  /** Every `editor.set_lsp_status` the server pushed, in arrival order. */
  statusPushes: () => LspStatusPush[];
  /** Terminate every client, which makes the bridge reconnect and re-auth. */
  dropClients: () => void;
  close: () => Promise<void>;
}

/** Answers auth with a Godot version, records `editor.set_lsp_status`, and acks every
 *  RPC. `extensions.refresh` returns `refreshCommands` when they are given. */
function makeFakeEditor(refreshCommands?: Array<Record<string, unknown>>): Promise<FakeEditor> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    const pushes: LspStatusPush[] = [];
    let auths = 0;
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        authCount: () => auths,
        statusPushes: () => pushes,
        dropClients: () => {
          for (const s of sockets) s.terminate();
        },
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
        let msg: { auth?: unknown; id?: unknown; method?: string; params?: unknown };
        try {
          msg = JSON.parse(data.toString()) as typeof msg;
        } catch {
          return;
        }
        if (msg.auth !== undefined) {
          auths++;
          sock.send(JSON.stringify({ authed: true, godot_version: "4.5", version: "1.0.0" }));
          return;
        }
        if (msg.method === "editor.set_lsp_status") pushes.push(msg.params as LspStatusPush);
        if (msg.method === "extensions.refresh" && refreshCommands && msg.id != null) {
          const result = { success: true, commands: refreshCommands };
          sock.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
          return;
        }
        if (msg.id != null) sock.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));
      });
    });
  });
}

// ── Fake GDScript LSP (TCP, Content-Length framing) ───────────────────

/** Answers `initialize` with empty capabilities, which is all the client's connect needs. */
async function makeFakeLsp(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
    let buffer = "";
    sock.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");
      for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.slice(0, headerEnd))?.[1] ?? 0);
        const bodyStart = headerEnd + 4;
        if (Buffer.byteLength(buffer.slice(bodyStart), "utf-8") < length) return;
        const body = Buffer.from(buffer.slice(bodyStart), "utf-8").subarray(0, length).toString("utf-8");
        buffer = buffer.slice(bodyStart + body.length);
        const msg = JSON.parse(body) as { id?: number; method?: string };
        if (msg.method === "initialize" && msg.id != null) {
          const reply = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
          sock.write(`Content-Length: ${Buffer.byteLength(reply, "utf-8")}\r\n\r\n${reply}`);
        }
      }
    });
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((res) => {
        for (const s of sockets) s.destroy();
        server.close(() => res());
      }),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll a condition until true or the deadline elapses. */
async function waitFor(cond: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out: ${label}`);
    await sleep(25);
  }
}

// Longer than one peer-probe budget (300 ms), so any registry verdict still in
// flight has resolved, and been pushed or dropped, by the time it elapses.
const SETTLE_MS = 600;

// ── Fixtures ─────────────────────────────────────────────────────────

const editorA = await makeFakeEditor();
const editorB = await makeFakeEditor();
const EXTENSION_METHOD = "ext_probe.ping";
const editorC = await makeFakeEditor([{ method: EXTENSION_METHOD, annotations: { readOnlyHint: true } }]);
const fakeLsp = await makeFakeLsp();

// Project A: a peer editor (the parent process, started earlier) claims the same
// LSP port, so A's registry verdict is `conflict`. Project B owns its port alone,
// and that port is the fake LSP, so B's verdict is `active` and a real LSP
// connection to it yields a verified verdict. Project C owns a port of its own
// and only needs some registry verdict to push.
const PROJECT_A = join(tmpDir, "project-a");
const PROJECT_B = join(tmpDir, "project-b");
const PROJECT_C = join(tmpDir, "project-c");
const PEER = join(tmpDir, "peer");
const CONFLICT_LSP_PORT = 16005;

const entry = (over: Record<string, unknown>) => ({
  token_path: "tok",
  runtime_port: null,
  runtime_pid: null,
  lsp_host: "127.0.0.1",
  ...over,
});
mkdirSync(dirname(registryPath()), { recursive: true });
writeFileSync(
  registryPath(),
  JSON.stringify({
    by_path: {
      [normalizePath(PROJECT_A)]: entry({
        port: editorA.port,
        pid: process.pid,
        started_at: 2000,
        lsp_port: CONFLICT_LSP_PORT,
      }),
      [normalizePath(PEER)]: entry({
        port: editorA.port,
        pid: process.ppid,
        started_at: 1000,
        lsp_port: CONFLICT_LSP_PORT,
      }),
      [normalizePath(PROJECT_B)]: entry({
        port: editorB.port,
        pid: process.pid,
        started_at: 1000,
        lsp_port: fakeLsp.port,
      }),
      [normalizePath(PROJECT_C)]: entry({
        port: editorC.port,
        pid: process.pid,
        started_at: 1000,
        lsp_port: 16007,
      }),
    },
  }),
);

// Connect the LSP client for project B before any reporter exists, so no verdict
// is pushed yet; test 2's verified verdict then needs no I/O.
const preconnect = await ensureLsp(PROJECT_B);
assert.ok(!("content" in preconnect), "the LSP client connects to the fake LSP");

// ── Test 1: one registry-verdict push per auth, the first included ───

async function testPushPerAuth(): Promise<void> {
  const bridge = createBridge(`ws://127.0.0.1:${editorA.port}`, { projectPath: PROJECT_A, explicitEditorPort: true });
  createLspStatusReporter({ bridge, projectPath: PROJECT_A });
  try {
    await bridge.call("warmup", {}, 5000);
    await waitFor(() => editorA.statusPushes().length >= 1, "a registry verdict after the first connect");
    const first = editorA.statusPushes()[0];
    assert.equal(first.state, "conflict", "the first connect pushes the conflict the registry shows");
    assert.equal(first.port, CONFLICT_LSP_PORT, "the verdict names the contested LSP port");

    editorA.dropClients();
    await waitFor(() => editorA.authCount() >= 2, "the reconnect re-auth");
    await waitFor(() => editorA.statusPushes().length >= 2, "a registry verdict after the reconnect");
    await sleep(SETTLE_MS);
    assert.equal(editorA.authCount(), 2, "two auths: the first connect and one reconnect");
    assert.equal(editorA.statusPushes().length, 2, "exactly one registry-verdict push per auth");
    console.log("  PASS: one registry-verdict push per editor auth, the first connect included");
  } finally {
    await bridge.close();
  }
}

// ── Test 2: a verified verdict landing mid-probe outranks the registry one ──

async function testVerifiedOutranksRegistry(): Promise<void> {
  const bridge = createBridge(`ws://127.0.0.1:${editorB.port}`, { projectPath: PROJECT_B, explicitEditorPort: true });
  createLspStatusReporter({ bridge, projectPath: PROJECT_B });
  // The version hook runs inside the same auth callback, just before the registry
  // verdict launches. ensureLsp resumes on a microtask, so its verified verdict
  // lands after the launch and before the registry verdict's peer probe (real
  // socket I/O) can resolve.
  bridge.onGodotVersionKnown(() => {
    void ensureLsp(PROJECT_B);
  });
  try {
    await bridge.call("warmup", {}, 5000);
    await waitFor(() => editorB.statusPushes().length >= 1, "the verified verdict push");
    await sleep(SETTLE_MS);
    const details = editorB.statusPushes().map((p) => p.detail);
    assert.deepEqual(details, [VERIFIED_DETAIL], "the registry verdict that resolved later is dropped");

    // Control: a reconnect has no verified verdict racing it, so its registry
    // verdict is pushed. This proves the first auth launched one that was dropped.
    editorB.dropClients();
    await waitFor(() => editorB.authCount() >= 2, "the reconnect re-auth");
    await waitFor(() => editorB.statusPushes().length >= 2, "the registry verdict after the reconnect");
    assert.equal(editorB.statusPushes()[1].detail, REGISTRY_DETAIL, "the reconnect pushes the registry verdict");
    console.log("  PASS: a verified verdict landing mid-probe drops the registry verdict");
  } finally {
    await bridge.close();
  }
}

// ── Test 3: eager discovery's first auth reaches a reporter built before it ──

// Registers each tool through the real tool_refs bookkeeping; nothing is served.
function makeFakeServer(): McpServer {
  return {
    registerTool: () => ({ remove: () => {}, update: () => {} }),
    sendToolListChanged: () => {},
  } as unknown as McpServer;
}

async function testDiscoveryAuthReachesReporter(): Promise<void> {
  // The composition root's order: bridge, reporter, extension manager, then the
  // eager discovery whose extensions.refresh is the first bridge call.
  const bridge = createBridge(`ws://127.0.0.1:${editorC.port}`, { projectPath: PROJECT_C, explicitEditorPort: true });
  createLspStatusReporter({ bridge, projectPath: PROJECT_C });
  const extensions = createExtensionManager({ server: makeFakeServer(), bridge, getReadOnly: () => false });
  try {
    // The fake editor answers at once; the short deadline only keeps the run fast.
    const { timedOut } = await extensions.discoverEagerly(2000);
    assert.equal(timedOut, false, "eager discovery finishes inside its deadline");
    assert.equal(hasToolRef("ext_probe_ping"), true, "the discovered extension tool is registered");
    await waitFor(() => editorC.statusPushes().length >= 1, "a registry verdict after discovery's first auth");
    await sleep(SETTLE_MS);
    assert.equal(editorC.authCount(), 1, "discovery made the only auth");
    assert.equal(editorC.statusPushes().length, 1, "exactly one registry-verdict push for that auth");
    console.log("  PASS: eager discovery's first auth pushes one registry verdict");
  } finally {
    await bridge.close();
  }
}

// ── Test 4: the composition root builds the reporter before eager discovery ──

function testCompositionRootOrder(): void {
  // Test 3 cannot run index.ts itself, so this pins the order test 3 copies.
  const source = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf-8");
  const bridgeAt = source.search(/^const bridge = createBridge\(/m);
  const reporterAt = source.search(/^createLspStatusReporter\(/m);
  const discoveryAt = source.search(/await extensions\.discoverEagerly\(/);
  assert.ok(bridgeAt >= 0 && reporterAt >= 0 && discoveryAt >= 0, "all three statements are in index.ts");
  assert.ok(bridgeAt < reporterAt, "the reporter is built after the bridge");
  assert.ok(reporterAt < discoveryAt, "the reporter is built before eager discovery's first bridge call");
  console.log("  PASS: index.ts builds the reporter after the bridge and before eager discovery");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("LSP status reporter tests:");
  await testPushPerAuth();
  await testVerifiedOutranksRegistry();
  await testDiscoveryAuthReachesReporter();
  testCompositionRootOrder();
  console.log("All LSP status reporter tests passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([editorA.close(), editorB.close(), editorC.close(), fakeLsp.close()]);
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

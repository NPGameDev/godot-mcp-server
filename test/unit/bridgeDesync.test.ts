/**
 * Pins the bridge's fail-fast desync cross-check for a PINNED editor port
 * (GODOT_MCP_EDITOR_PORT / --editor-port). A pin skips re-discovery, so a stale
 * or unsynced pin would otherwise surface as a bare CONNECT_FAILED against a dead
 * socket — or, when a FOREIGN WebSocket server occupies the pinned port (it
 * passes the TCP+WS upgrade, then stalls or drops the handshake), as a bare
 * AUTH_FAILED. On either pinned failure the bridge reads the registry ONCE and
 * synthesizes a precise, actionable error (original code preserved):
 *   - registry disagrees  → names both the pinned port and the live port
 *   - no registry entry   → "no live editor" (something else may hold the port)
 *   - registry agrees + reachable → the call proceeds (healthy path never reads)
 *   - registry agrees + AUTH_FAILED → the original propagates (token trouble
 *     with the real editor, not a desync); unpinned AUTH_FAILED is untouched
 *
 * The mock-editor + registry-redirect scaffold intentionally parallels
 * bridge-rediscover.test.ts: each unit file stays hermetic (no shared mutable
 * fixture), so the small duplication is deliberate. darwin has no registry-path
 * override, so the registry-dependent cases skip there and run in CI on Linux.
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import { normalizePath, registryPath, type RegistryEntry } from "../../src/registry.js";
import { BridgeError } from "../../src/shared/errors.js";

// ── Hermetic environment (token + registry redirect) ─────────────────

const REDIRECT: string | null =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : null;

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-desync-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;
if (REDIRECT) process.env[REDIRECT] = tmpDir;

// Import AFTER the env mutation so registryPath() resolves under the redirect.
const { createBridge } = await import("../../src/transport/bridge.js");

function makeEntry(over: Partial<RegistryEntry>): RegistryEntry {
  return {
    port: 6550,
    token_path: "tok",
    pid: process.pid,
    started_at: 1000,
    runtime_port: null,
    runtime_pid: null,
    ...over,
  };
}

function writeRegistry(byPath: Record<string, RegistryEntry>): void {
  if (!REDIRECT) return;
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify({ by_path: byPath }));
}

writeRegistry({});

// ── Mock editor WebSocket server ─────────────────────────────────────

interface MockServer {
  port: number;
  authCount: () => number;
  close: () => Promise<void>;
}

function makeMockServer(): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    let auths = 0;
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        authCount: () => auths,
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
        let msg: { auth?: unknown; id?: unknown };
        try {
          msg = JSON.parse(data.toString()) as { auth?: unknown; id?: unknown };
        } catch {
          return;
        }
        if (msg.auth !== undefined) {
          auths++;
          sock.send(JSON.stringify({ authed: true, godot_version: "4.5", version: "1.0.0" }));
          return;
        }
        if (msg.id != null) sock.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));
      });
    });
  });
}

/** A port that now refuses connections: bind an ephemeral port, then free it. */
async function getDeadPort(): Promise<number> {
  const probe = await makeMockServer();
  const port = probe.port;
  await probe.close();
  return port;
}

/**
 * A FOREIGN WebSocket server: accepts the connection (passing TCP + WS upgrade)
 * but closes the socket on the first message instead of answering the auth
 * handshake — the fast, deterministic stand-in for "something else owns the
 * pinned port". The bridge surfaces it as AUTH_FAILED ("server closed connection
 * during auth"), the same code a stalled foreign peer produces at timeout.
 */
function makeForeignServer(): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        authCount: () => 0, // never answers an auth handshake
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
      sock.on("message", () => sock.close(1000, "not the toolkit"));
    });
  });
}

// ── Case 1: registry agrees + reachable → the call proceeds ──────────

async function testPinnedMatchProceeds() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): pinned-match proceeds");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/desync-match";
  const server = await makeMockServer();
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: server.port }) });
  const bridge = createBridge(`ws://127.0.0.1:${server.port}`, { projectPath, explicitEditorPort: true });

  try {
    const r = await bridge.call("echo", { ping: 1 }, 5000);
    assert.deepEqual(r, { ok: true }, "a pinned editor in sync with the registry resolves normally");
    console.log("  PASS: a pinned editor whose registry port matches proceeds (no cross-check trip)");
  } finally {
    await bridge.close();
    await server.close();
  }
}

// ── Case 2: registry disagrees → precise error naming both ports ─────

async function testPinnedMismatchErrors() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): pinned-mismatch error");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/desync-mismatch";
  const live = await makeMockServer(); // the editor is really here
  const deadPin = await getDeadPort(); // the server is pinned here (dead)
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: live.port }) });
  const bridge = createBridge(`ws://127.0.0.1:${deadPin}`, { projectPath, explicitEditorPort: true });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) =>
        err instanceof BridgeError &&
        err.code === "CONNECT_FAILED" &&
        err.message.includes(String(deadPin)) &&
        err.message.includes(String(live.port)) &&
        err.message.includes("GODOT_MCP_EDITOR_PORT"),
      "a pinned/registry mismatch names both ports and the env var to fix it",
    );
    assert.equal(
      live.authCount(),
      0,
      "the live editor is never dialed — the cross-check short-circuits before connect",
    );
    console.log("  PASS: a pinned/registry mismatch fails fast with a precise, actionable error");
  } finally {
    await bridge.close();
    await live.close();
  }
}

// ── Case 3: no registry entry → "no live editor is registered" ───────

async function testPinnedNoEntryErrors() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): pinned-no-entry error");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/desync-noentry";
  const deadPin = await getDeadPort();
  writeRegistry({}); // nothing live for the project
  const bridge = createBridge(`ws://127.0.0.1:${deadPin}`, { projectPath, explicitEditorPort: true });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) =>
        err instanceof BridgeError &&
        err.code === "CONNECT_FAILED" &&
        err.message.includes(String(deadPin)) &&
        err.message.includes("no live editor"),
      "a pin with nothing live for the project fails fast with a precise error",
    );
    console.log("  PASS: a pinned port with nothing registered for the project fails fast");
  } finally {
    await bridge.close();
  }
}

// ── Case 4: foreign server on the pin + registry mismatch → AUTH_FAILED desync ──

async function testPinnedAuthMismatchErrors() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): pinned-auth-mismatch error");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/desync-auth-mismatch";
  const live = await makeMockServer(); // the real editor is here
  const foreign = await makeForeignServer(); // the pin points here
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: live.port }) });
  const bridge = createBridge(`ws://127.0.0.1:${foreign.port}`, { projectPath, explicitEditorPort: true });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) =>
        err instanceof BridgeError &&
        err.code === "AUTH_FAILED" &&
        err.message.includes(String(foreign.port)) &&
        err.message.includes(String(live.port)) &&
        err.message.includes("occupying") &&
        err.message.includes("GODOT_MCP_EDITOR_PORT"),
      "a foreign occupant + registry mismatch keeps AUTH_FAILED and names both ports",
    );
    assert.equal(live.authCount(), 0, "the live editor is never dialed — the cross-check only reads the registry");
    console.log("  PASS: a foreign server on the pinned port fails fast with the desync diagnosis (mismatch)");
  } finally {
    await bridge.close();
    await live.close();
    await foreign.close();
  }
}

// ── Case 5: foreign server on the pin + no registry entry → AUTH_FAILED desync ──

async function testPinnedAuthNoEntryErrors() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): pinned-auth-no-entry error");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/desync-auth-noentry";
  const foreign = await makeForeignServer();
  writeRegistry({}); // nothing live for the project
  const bridge = createBridge(`ws://127.0.0.1:${foreign.port}`, { projectPath, explicitEditorPort: true });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) =>
        err instanceof BridgeError &&
        err.code === "AUTH_FAILED" &&
        err.message.includes(String(foreign.port)) &&
        err.message.includes("no live editor") &&
        err.message.includes("occupying"),
      "a foreign occupant with nothing registered names the pinned port and the likely squatter",
    );
    console.log("  PASS: a foreign server on the pinned port fails fast with the desync diagnosis (no entry)");
  } finally {
    await bridge.close();
    await foreign.close();
  }
}

// ── Case 6: auth failure with the registry AGREEING on the pin → original propagates ──

async function testPinnedAuthMatchPropagatesOriginal() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): pinned-auth-match passthrough");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/desync-auth-match";
  const foreign = await makeForeignServer();
  // Registry agrees with the pin → the failure reads as token trouble with the
  // real editor, not a port desync; the original auth error must pass untouched.
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: foreign.port }) });
  const bridge = createBridge(`ws://127.0.0.1:${foreign.port}`, { projectPath, explicitEditorPort: true });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) =>
        err instanceof BridgeError &&
        err.code === "AUTH_FAILED" &&
        err.message.includes("during auth") &&
        !err.message.includes("occupying") &&
        !err.message.includes("listening on"),
      "registry agrees with the pin → the original auth error propagates, no desync synthesis",
    );
    console.log("  PASS: a pinned auth failure with a matching registry entry propagates the original error");
  } finally {
    await bridge.close();
    await foreign.close();
  }
}

// ── Case 7: UNPINNED auth failure → byte-identical original (no cross-check) ──

async function testUnpinnedAuthUntouched() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): unpinned-auth passthrough");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/desync-auth-unpinned";
  const live = await makeMockServer();
  const foreign = await makeForeignServer();
  // Registry even points elsewhere — with no pin, the AUTH_FAILED path must not
  // consult it (no rediscover either: AUTH_FAILED is not a connection loss).
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: live.port }) });
  const bridge = createBridge(`ws://127.0.0.1:${foreign.port}`, { projectPath });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) =>
        err instanceof BridgeError &&
        err.code === "AUTH_FAILED" &&
        err.message.includes("during auth") &&
        !err.message.includes("pinned"),
      "unpinned AUTH_FAILED propagates unchanged — the desync cross-check is pin-only",
    );
    assert.equal(live.authCount(), 0, "no re-discovery fired — AUTH_FAILED is not a connection loss");
    console.log("  PASS: an unpinned auth failure is untouched by the desync cross-check");
  } finally {
    await bridge.close();
    await live.close();
    await foreign.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("Bridge pinned-editor desync cross-check tests:");
  await testPinnedMatchProceeds();
  await testPinnedMismatchErrors();
  await testPinnedNoEntryErrors();
  await testPinnedAuthMismatchErrors();
  await testPinnedAuthNoEntryErrors();
  await testPinnedAuthMatchPropagatesOriginal();
  await testUnpinnedAuthUntouched();
  console.log("All 7 bridge-desync tests passed.");
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

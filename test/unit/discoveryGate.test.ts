/**
 * Unit tests for startup/discoveryGate.ts — holding a tools/call that races an
 * in-flight extension discovery pass.
 *
 * Blocks:
 *   1. A call to an unregistered name waits for the in-flight pass, then dispatches.
 *   2. A call to a registered name, a non-call request and a call with no pass in
 *      flight dispatch at once.
 *   3. A hold ends at its bound when the pass never settles, and on a failed pass.
 *   4. The facade exposes the in-flight pass, cleared once it settles.
 */
import assert from "node:assert/strict";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { holdCallsDuringDiscovery } from "../../src/startup/discoveryGate.js";
import { createExtensionManager } from "../../src/extensions/extensions.js";
import type { Bridge } from "../../src/shared/types.js";

// A connected transport whose onmessage records what reaches the server.
function makeTransport(): { transport: Transport; dispatched: string[] } {
  const dispatched: string[] = [];
  const transport = {
    start: async () => {},
    send: async () => {},
    close: async () => {},
    onmessage: (message: JSONRPCMessage) => {
      dispatched.push("method" in message ? message.method : "response");
    },
  } as Transport;
  return { transport, dispatched };
}

function call(name: string, id = 1): JSONRPCMessage {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } };
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve: () => void = () => {};
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Block 1 — a racing call waits for the pass ─────────────────────────
{
  const { transport, dispatched } = makeTransport();
  const registered = new Set<string>();
  const pass = deferred();
  holdCallsDuringDiscovery(transport, {
    isRegistered: (n) => registered.has(n),
    discoveryInFlight: () => pass.promise,
  });
  transport.onmessage?.(call("ext_tool"));
  await tick();
  assert.deepEqual(dispatched, [], "a call to an unregistered name is held while discovery runs");
  registered.add("ext_tool");
  pass.resolve();
  await tick();
  assert.deepEqual(dispatched, ["tools/call"], "the held call dispatches once the pass settles");
}

// ── Block 2 — everything else passes straight through ─────────────────
{
  const { transport, dispatched } = makeTransport();
  const pass = deferred();
  let inFlight: Promise<void> | undefined = pass.promise;
  holdCallsDuringDiscovery(transport, {
    isRegistered: (n) => n === "builtin_tool",
    discoveryInFlight: () => inFlight,
  });
  transport.onmessage?.(call("builtin_tool"));
  transport.onmessage?.({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.deepEqual(dispatched, ["tools/call", "tools/list"], "a registered call and tools/list are not held");
  inFlight = undefined;
  transport.onmessage?.(call("missing_tool", 3));
  assert.equal(dispatched.length, 3, "with no pass in flight an unknown call dispatches at once");
  pass.resolve();
}

// ── Block 3 — a hold is bounded and survives a failed pass ────────────
{
  const { transport, dispatched } = makeTransport();
  holdCallsDuringDiscovery(transport, {
    isRegistered: () => false,
    discoveryInFlight: () => new Promise<void>(() => {}),
    holdMs: 20,
  });
  transport.onmessage?.(call("ext_tool"));
  await tick(60);
  assert.deepEqual(dispatched, ["tools/call"], "a pass that never settles releases the call at the bound");
}
{
  const { transport, dispatched } = makeTransport();
  const pass = deferred();
  holdCallsDuringDiscovery(transport, { isRegistered: () => false, discoveryInFlight: () => pass.promise });
  transport.onmessage?.(call("ext_tool"));
  pass.reject(new Error("bridge down"));
  await tick();
  assert.deepEqual(dispatched, ["tools/call"], "a failed pass releases the call");
}

// ── Block 4 — the facade's in-flight pass ──────────────────────────────
{
  const refresh = deferred();
  const bridge = {
    getGodotVersion: () => "4.5.0",
    call: (method: string) =>
      method === "extensions.refresh"
        ? refresh.promise.then(() => ({ success: true, commands: [] }))
        : Promise.resolve({ success: true }),
  } as unknown as Bridge;
  const server = {
    registerTool: () => ({ remove: () => {}, update: () => {} }),
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  const ext = createExtensionManager({ server, bridge, getReadOnly: () => false });
  assert.equal(ext.discoveryInFlight(), undefined, "no pass before discovery starts");
  const run = ext.discoverExtensions();
  assert.equal(ext.discoveryInFlight(), run, "the running pass is exposed");
  refresh.resolve();
  await run;
  assert.equal(ext.discoveryInFlight(), undefined, "the pass clears once it settles");
}

console.log("discoveryGate: all blocks passed");

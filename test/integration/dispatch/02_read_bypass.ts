// Flow 2 — Read bypass.
//
// Start a mutation (acquires lock), immediately send a read-only command.
// The read returns before the mutation completes. No _queued notification
// for the read.

import { connectAndAuth, sendRequest, closeWs, type FlowCtx, type JsonRpcResponse } from "./helpers.js";

export async function run(port: number, token: string, ctx: FlowCtx): Promise<void> {
  const { ws, collector } = await connectAndAuth(port, token);

  try {
    // Send a mutation to hold the lock.
    const idMut = sendRequest(ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f2_node",
    });

    // Wait for _executing to confirm the lock is held.
    await collector.waitForNotification("_executing", idMut);
    ctx.pass("mutation executing (lock held)");

    // Send a read-only command — should bypass the lock.
    const idRead = sendRequest(ws, "project.get_settings", { prefix: "application/config" });

    // The read should return while the mutation is still in-flight.
    const respRead = (await collector.waitForResponse(idRead)) as JsonRpcResponse;
    if (respRead.error) {
      ctx.fail(`read returned error: ${respRead.error.message}`);
      return;
    }
    ctx.pass("read completed while mutation in-flight");

    // Verify no _queued notification was sent for the read.
    const hasQueued = collector.messages.some(
      (msg) =>
        "method" in msg &&
        msg.method === "_queued" &&
        (msg as { params?: { request_id?: number } }).params?.request_id === idRead,
    );
    if (hasQueued) {
      ctx.fail("read received _queued notification — should bypass queue");
    } else {
      ctx.pass("no _queued notification for read (bypassed lock)");
    }

    // Verify no _executing notification was sent for the read.
    const hasExecuting = collector.messages.some(
      (msg) =>
        "method" in msg &&
        msg.method === "_executing" &&
        (msg as { params?: { request_id?: number } }).params?.request_id === idRead,
    );
    if (hasExecuting) {
      ctx.fail("read received _executing notification — should bypass dispatch");
    } else {
      ctx.pass("no _executing notification for read");
    }

    // Wait for mutation to finish, then clean up.
    await collector.waitForResponse(idMut);
    const idDel = sendRequest(ws, "scene.delete_node", { node_path: "./_test_f2_node" });
    await collector.waitForResponse(idDel);
  } finally {
    await closeWs(ws);
  }
}

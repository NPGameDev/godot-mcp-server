// Flow 1 — Mutation serialization.
//
// Two rapid mutations from one peer: both complete in submission order.
// Each receives _executing notification. Responses arrive in order.
//
// Note: the toolkit's dispatch loop (`await _handle_message`) serializes
// mutations synchronously within a single poll cycle, so the second
// mutation executes after the first completes (no _queued notification).
// This test verifies ordering and _executing, not queuing.

import { connectAndAuth, sendRequest, closeWs, type FlowCtx, type JsonRpcResponse } from "./helpers.js";

export async function run(port: number, token: string, ctx: FlowCtx): Promise<void> {
  const { ws, collector } = await connectAndAuth(port, token);

  try {
    // Send two mutations rapidly.
    const id1 = sendRequest(ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f1_node_1",
    });
    const id2 = sendRequest(ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f1_node_2",
    });

    // Both should get _executing notifications.
    await collector.waitForNotification("_executing", id1);
    ctx.pass("mutation 1 got _executing");

    await collector.waitForNotification("_executing", id2);
    ctx.pass("mutation 2 got _executing");

    // Both should complete successfully.
    const resp1 = (await collector.waitForResponse(id1)) as JsonRpcResponse;
    if (resp1.error) {
      ctx.fail(`mutation 1 error: ${resp1.error.message}`);
      return;
    }
    ctx.pass("mutation 1 completed");

    const resp2 = (await collector.waitForResponse(id2)) as JsonRpcResponse;
    if (resp2.error) {
      ctx.fail(`mutation 2 error: ${resp2.error.message}`);
      return;
    }
    ctx.pass("mutation 2 completed");

    // Verify ordering: response 1 before response 2 in message log.
    const idx1 = collector.messages.indexOf(resp1);
    const idx2 = collector.messages.indexOf(resp2);
    if (idx1 < idx2) {
      ctx.pass("responses arrived in submission order");
    } else {
      ctx.fail(`out-of-order: resp1 at ${idx1}, resp2 at ${idx2}`);
    }

    // Cleanup.
    const idDel1 = sendRequest(ws, "scene.delete_node", { node_path: "./_test_f1_node_1" });
    await collector.waitForResponse(idDel1);
    const idDel2 = sendRequest(ws, "scene.delete_node", { node_path: "./_test_f1_node_2" });
    await collector.waitForResponse(idDel2);
  } finally {
    await closeWs(ws);
  }
}

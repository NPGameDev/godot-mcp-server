// Flow 3 — Queue drain FIFO.
//
// Send 3 mutations rapidly. All execute in submission order.
// Response IDs match request order. Each gets _executing notification.

import { connectAndAuth, sendRequest, closeWs, type FlowCtx, type JsonRpcResponse } from "./helpers.js";

export async function run(port: number, token: string, ctx: FlowCtx): Promise<void> {
  const { ws, collector } = await connectAndAuth(port, token);

  try {
    // Send 3 mutations in rapid succession.
    const id1 = sendRequest(ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f3_node_1",
    });
    const id2 = sendRequest(ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f3_node_2",
    });
    const id3 = sendRequest(ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f3_node_3",
    });

    // All 3 should get _executing notifications.
    await collector.waitForNotification("_executing", id1);
    ctx.pass("mutation 1 got _executing");
    await collector.waitForNotification("_executing", id2);
    ctx.pass("mutation 2 got _executing");
    await collector.waitForNotification("_executing", id3);
    ctx.pass("mutation 3 got _executing");

    // Collect all 3 responses.
    const resp1 = await collector.waitForResponse(id1);
    const resp2 = await collector.waitForResponse(id2);
    const resp3 = await collector.waitForResponse(id3);

    // Verify none errored.
    for (const [label, resp] of [
      ["mutation 1", resp1],
      ["mutation 2", resp2],
      ["mutation 3", resp3],
    ] as Array<[string, JsonRpcResponse]>) {
      if (resp.error) {
        ctx.fail(`${label} error: ${resp.error.message}`);
        return;
      }
    }
    ctx.pass("all 3 mutations completed");

    // Verify FIFO order: responses arrived in submission order.
    const idx1 = collector.messages.indexOf(resp1);
    const idx2 = collector.messages.indexOf(resp2);
    const idx3 = collector.messages.indexOf(resp3);

    if (idx1 < idx2 && idx2 < idx3) {
      ctx.pass("all 3 responses arrived in FIFO order");
    } else {
      ctx.fail(`out-of-order: indices [${idx1}, ${idx2}, ${idx3}]`);
    }

    // Cleanup.
    for (const name of ["_test_f3_node_1", "_test_f3_node_2", "_test_f3_node_3"]) {
      const idDel = sendRequest(ws, "scene.delete_node", { node_path: `./${name}` });
      await collector.waitForResponse(idDel);
    }
  } finally {
    await closeWs(ws);
  }
}

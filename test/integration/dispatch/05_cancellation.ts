// Flow 5 — Cancellation (via scene queue).
//
// Uses scene lease contention to queue commands, then cancels one.
// Peer B holds the lease on scene B. Peer A has affinity for scene A.
// Peer A sends two scene-requiring mutations (X and Y) — both queue.
// Cancel X. Disconnect peer B (releases lease). Y proceeds, X is skipped.
//
// FIFO proof: Y was behind X. If Y executes and X doesn't, X was cancelled.

import {
  connectAndAuth,
  sendRequest,
  sendNotification,
  closeWs,
  type FlowCtx,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcResponse,
} from "./helpers.js";

const SCENE_A = "res://test_dispatch_a.tscn";
const SCENE_B = "res://test_dispatch_b.tscn";

export async function run(port: number, token: string, ctx: FlowCtx): Promise<void> {
  const peerA = await connectAndAuth(port, token);
  const peerB = await connectAndAuth(port, token);

  try {
    // Step 1: Peer B opens scene B → gets lease, active tab = B.
    const idOpenB = sendRequest(peerB.ws, "scene.open", { file_path: SCENE_B });
    const respOpenB = (await peerB.collector.waitForResponse(idOpenB)) as JsonRpcResponse;
    if (respOpenB.error) {
      ctx.fail(`peer B scene.open error: ${respOpenB.error.message}`);
      return;
    }
    ctx.pass("peer B holds lease on scene B");

    // Step 2: Peer A opens scene A → contended → affinity set, scene NOT opened.
    const idOpenA = sendRequest(peerA.ws, "scene.open", { file_path: SCENE_A });
    const respOpenA = (await peerA.collector.waitForResponse(idOpenA)) as JsonRpcResponse;
    if (respOpenA.error) {
      ctx.fail(`peer A scene.open error: ${respOpenA.error.message}`);
      return;
    }
    ctx.pass("peer A has affinity for scene A (lease contended)");

    // Step 3: Peer A sends mutation X → scene queued (affinity A ≠ active B).
    const idX = sendRequest(peerA.ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f5_node_x",
    });
    await peerA.collector.waitForNotification("_queued", idX);
    ctx.pass("mutation X queued in scene queue");

    // Step 4: Peer A sends mutation Y → also scene queued.
    const idY = sendRequest(peerA.ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f5_node_y",
    });
    await peerA.collector.waitForNotification("_queued", idY);
    ctx.pass("mutation Y queued in scene queue");

    // Step 5: Cancel X (fire-and-forget).
    // Send request_id as a string to avoid GDScript JSON float coercion:
    // JSON parses numbers as floats, str(3.0) may not equal str(3) in all
    // Godot versions. The toolkit compares str(entry.id) == str(request_id),
    // so sending a string "3" matches int 3 via str(3) == "3".
    sendNotification(peerA.ws, "_cancel", { request_id: String(idX) });

    // Synchronization barrier: send a read from peer A and wait for its
    // response. This guarantees the server has processed all prior messages
    // from peer A (including _cancel) before we proceed.
    const idBarrier = sendRequest(peerA.ws, "project.get_settings", { prefix: "application/config" });
    await peerA.collector.waitForResponse(idBarrier);
    ctx.pass("_cancel sent and confirmed via barrier read");

    // Step 6: Disconnect peer B → releases lease → drain → X skipped, Y proceeds.
    await closeWs(peerB.ws);
    ctx.pass("peer B disconnected (lease released)");

    // Step 7: Wait for Y to execute and complete.
    await peerA.collector.waitForNotification("_executing", idY);
    ctx.pass("mutation Y executing (X was skipped)");

    const respY = (await peerA.collector.waitForResponse(idY)) as JsonRpcResponse;
    if (respY.error) {
      ctx.fail(`mutation Y error: ${respY.error.message}`);
      return;
    }
    ctx.pass("mutation Y completed");

    // Step 8: Verify X was never executed or responded to.
    const hasExecutingX = peerA.collector.messages.some(
      (msg: JsonRpcMessage) =>
        "method" in msg && msg.method === "_executing" && (msg as JsonRpcNotification).params?.request_id === idX,
    );
    if (hasExecutingX) {
      ctx.fail("X received _executing — should have been cancelled");
    } else {
      ctx.pass("X never received _executing (cancelled in scene queue)");
    }

    const hasResponseX = peerA.collector.messages.some((msg: JsonRpcMessage) => "id" in msg && msg.id === idX);
    if (hasResponseX) {
      ctx.fail("X received a response — should have been silently dropped");
    } else {
      ctx.pass("X never received a response (silently dropped)");
    }

    // Cleanup: only Y created a node. X was cancelled.
    const idDel = sendRequest(peerA.ws, "scene.delete_node", { node_path: "./_test_f5_node_y" });
    await peerA.collector.waitForResponse(idDel);
  } finally {
    await closeWs(peerA.ws);
    await closeWs(peerB.ws).catch(() => {});
  }
}

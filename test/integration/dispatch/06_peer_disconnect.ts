// Flow 6 — Peer disconnect (via scene queue).
//
// Peer A holds the lease. Peer B has affinity for a different scene.
// Peer B sends a scene-requiring command → queued. Peer B disconnects.
// The scene queue entry is cleaned up. Peer A continues operating.

import { connectAndAuth, sendRequest, closeWs, type FlowCtx, type JsonRpcResponse } from "./helpers.js";

const SCENE_A = "res://test_dispatch_a.tscn";
const SCENE_B = "res://test_dispatch_b.tscn";

export async function run(port: number, token: string, ctx: FlowCtx): Promise<void> {
  const peerA = await connectAndAuth(port, token);
  const peerB = await connectAndAuth(port, token);

  try {
    // Step 1: Peer A opens scene A → gets lease.
    const idOpenA = sendRequest(peerA.ws, "scene.open", { file_path: SCENE_A });
    const respOpenA = (await peerA.collector.waitForResponse(idOpenA)) as JsonRpcResponse;
    if (respOpenA.error) {
      ctx.fail(`peer A scene.open error: ${respOpenA.error.message}`);
      return;
    }
    ctx.pass("peer A holds lease on scene A");

    // Step 2: Peer B opens scene B → contended → affinity set.
    const idOpenB = sendRequest(peerB.ws, "scene.open", { file_path: SCENE_B });
    const respOpenB = (await peerB.collector.waitForResponse(idOpenB)) as JsonRpcResponse;
    if (respOpenB.error) {
      ctx.fail(`peer B scene.open error: ${respOpenB.error.message}`);
      return;
    }
    ctx.pass("peer B has affinity for scene B (lease contended)");

    // Step 3: Peer B sends scene-requiring mutation → queued.
    const idB = sendRequest(peerB.ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f6_node_b",
    });
    await peerB.collector.waitForNotification("_queued", idB);
    ctx.pass("peer B mutation queued in scene queue");

    // Step 4: Disconnect peer B while its entry is in the scene queue.
    await closeWs(peerB.ws);
    ctx.pass("peer B disconnected (scene queue entry will be cleaned)");

    // Step 5: Peer A sends a mutation — should execute normally.
    // This also verifies peer B's disconnect didn't corrupt dispatch state.
    const idA = sendRequest(peerA.ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f6_node_a",
    });
    await peerA.collector.waitForNotification("_executing", idA);
    ctx.pass("peer A mutation executing normally after peer B disconnect");

    const respA = (await peerA.collector.waitForResponse(idA)) as JsonRpcResponse;
    if (respA.error) {
      ctx.fail(`peer A mutation error: ${respA.error.message}`);
      return;
    }
    ctx.pass("peer A mutation completed");

    // Cleanup.
    const idDel = sendRequest(peerA.ws, "scene.delete_node", { node_path: "./_test_f6_node_a" });
    await peerA.collector.waitForResponse(idDel);
  } finally {
    await closeWs(peerA.ws);
    await closeWs(peerB.ws).catch(() => {});
  }
}

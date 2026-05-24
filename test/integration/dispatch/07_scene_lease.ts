// Flow 7 — Scene lease contention.
//
// Peer B holds the lease on scene B (active tab). Peer A has affinity
// for scene A. Peer A sends a scene-requiring command → queued in
// _scene_queue. Peer B disconnects → lease released → peer A's command
// proceeds.
//
// Verifies the full _queued → _executing → response lifecycle for
// scene-queued commands.

import { connectAndAuth, sendRequest, closeWs, type FlowCtx, type JsonRpcResponse } from "./helpers.js";

const SCENE_A = "res://test_dispatch_a.tscn";
const SCENE_B = "res://test_dispatch_b.tscn";

export async function run(port: number, token: string, ctx: FlowCtx): Promise<void> {
  const peerA = await connectAndAuth(port, token);
  const peerB = await connectAndAuth(port, token);

  try {
    // Step 1: Peer B opens scene B → gets lease, scene B is active tab.
    const idOpenB = sendRequest(peerB.ws, "scene.open", { file_path: SCENE_B });
    const respOpenB = (await peerB.collector.waitForResponse(idOpenB)) as JsonRpcResponse;
    if (respOpenB.error) {
      ctx.fail(`peer B scene.open error: ${respOpenB.error.message}`);
      return;
    }
    ctx.pass("peer B holds lease on scene B (active tab)");

    // Step 2: Peer A opens scene A → contended → affinity set, scene NOT opened.
    const idOpenA = sendRequest(peerA.ws, "scene.open", { file_path: SCENE_A });
    const respOpenA = (await peerA.collector.waitForResponse(idOpenA)) as JsonRpcResponse;
    if (respOpenA.error) {
      ctx.fail(`peer A scene.open error: ${respOpenA.error.message}`);
      return;
    }
    ctx.pass("peer A has affinity for scene A (lease contended)");

    // Step 3: Peer A sends scene-requiring mutation.
    // Affinity A ≠ active B → queued in _scene_queue.
    const idNode = sendRequest(peerA.ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f7_node",
    });
    await peerA.collector.waitForNotification("_queued", idNode);
    ctx.pass("peer A scene.create_node queued (scene lease contention)");

    // Step 4: Disconnect peer B → releases lease → _drain_scene_queue.
    await closeWs(peerB.ws);
    ctx.pass("peer B disconnected (lease released)");

    // Step 5: Peer A's command should now proceed.
    await peerA.collector.waitForNotification("_executing", idNode);
    ctx.pass("peer A command executing after lease release");

    const respNode = (await peerA.collector.waitForResponse(idNode)) as JsonRpcResponse;
    if (respNode.error) {
      ctx.fail(`peer A scene.create_node error: ${respNode.error.message}`);
      return;
    }
    ctx.pass("peer A scene.create_node completed");

    // Cleanup.
    const idDel = sendRequest(peerA.ws, "scene.delete_node", { node_path: "./_test_f7_node" });
    await peerA.collector.waitForResponse(idDel);
  } finally {
    await closeWs(peerA.ws);
    await closeWs(peerB.ws).catch(() => {});
  }
}

// Flow 4 — Notification timing.
//
// Send a mutation. Verify _executing notification arrives before
// the response in the message log.

import {
  connectAndAuth,
  sendRequest,
  closeWs,
  type FlowCtx,
  type JsonRpcMessage,
  type JsonRpcNotification,
} from "./helpers.js";

export async function run(port: number, token: string, ctx: FlowCtx): Promise<void> {
  const { ws, collector } = await connectAndAuth(port, token);

  try {
    // Send a mutation.
    const id = sendRequest(ws, "scene.create_node", {
      class_name: "Node",
      node_name: "_test_f4_node",
    });

    // Wait for _executing notification.
    await collector.waitForNotification("_executing", id);
    ctx.pass("_executing notification received");

    // Wait for response.
    const resp = await collector.waitForResponse(id);
    if (resp.error) {
      ctx.fail(`mutation error: ${resp.error.message}`);
      return;
    }
    ctx.pass("mutation completed");

    // Verify ordering: _executing before response in message log.
    const isExec = (msg: JsonRpcMessage) =>
      "method" in msg && msg.method === "_executing" && (msg as JsonRpcNotification).params?.request_id === id;
    const isResp = (msg: JsonRpcMessage) => "id" in msg && msg.id === id;

    const idxExec = collector.messages.findIndex(isExec);
    const idxResp = collector.messages.findIndex(isResp);

    if (idxExec < idxResp) {
      ctx.pass("_executing arrived before response");
    } else {
      ctx.fail(`_executing at ${idxExec}, response at ${idxResp} — wrong order`);
    }

    // Cleanup.
    const idDel = sendRequest(ws, "scene.delete_node", { node_path: "./_test_f4_node" });
    await collector.waitForResponse(idDel);
  } finally {
    await closeWs(ws);
  }
}

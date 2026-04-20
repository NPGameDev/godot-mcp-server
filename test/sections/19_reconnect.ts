import { createBridge } from "../../src/bridge.js";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, makeFakeEchoServer, deepEqual } from "../helpers.js";

export async function testReconnect(ctx: TestCtx): Promise<void> {
  const { pass, fail } = ctx;

  const fake = await makeFakeEchoServer();
  const fakeBridge = createBridge(`ws://127.0.0.1:${fake.port}`, {
    projectPath: ctx.projectPath,
  });
  try {
    const beforeResult = await fakeBridge.call("echo", { ping: "before" }, CALL_TIMEOUT);
    if (!deepEqual(beforeResult, { ping: "before" })) {
      fail(`reconnect: pre-cycle echo: ${JSON.stringify(beforeResult)}`);
    } else {
      pass("reconnect: pre-cycle echo via fake server");
    }

    // Drop active peer; let the bridge process the close event.
    fake.dropAll();
    await new Promise((res) => setTimeout(res, 100));

    // Hot path: bridge reconnects within ~1s.
    const afterResult = await fakeBridge.call("echo", { ping: "after" }, CALL_TIMEOUT);
    if (!deepEqual(afterResult, { ping: "after" })) {
      fail(`reconnect: post-cycle echo: ${JSON.stringify(afterResult)}`);
    } else {
      pass("reconnect: post-cycle echo round-trip via auto-reconnect");
    }
  } finally {
    await fakeBridge.close();
    await fake.close();
  }
}

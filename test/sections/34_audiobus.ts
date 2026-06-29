import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["audiobus_edit", "audiobus_list"];
export async function testAudiobus(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Happy path: add a bus
  const addResult = (await bridge.call(
    "audiobus.edit",
    { action: "add_bus", bus_name: "Music", send_to: "Master" },
    CALL_TIMEOUT,
  )) as { success?: boolean; bus_name?: string };

  if (addResult?.success === true) {
    pass(`audiobus.edit add_bus -> ${addResult.bus_name}`);
  } else {
    fail(`audiobus.edit add_bus: ${JSON.stringify(addResult)}`);
  }

  // Add effect to the new bus
  const effectResult = (await bridge.call(
    "audiobus.edit",
    { action: "add_effect", bus_name: "Music", effect: { type: "Reverb" } },
    CALL_TIMEOUT,
  )) as { success?: boolean };

  if (effectResult?.success === true) {
    pass("audiobus.edit add_effect Reverb");
  } else {
    fail(`audiobus.edit add_effect: ${JSON.stringify(effectResult)}`);
  }

  // List all buses
  const listResult = (await bridge.call("audiobus.list", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    bus_count?: number;
    buses?: unknown[];
  };

  if (listResult?.success === true && (listResult.bus_count ?? 0) >= 2) {
    pass(`audiobus.list -> bus_count=${listResult.bus_count}`);
  } else {
    fail(`audiobus.list: ${JSON.stringify(listResult)}`);
  }

  // Guard: remove Master bus
  assertGuard(
    ctx,
    "audiobus.edit remove Master guard",
    await bridge.call("audiobus.edit", { action: "remove_bus", bus_name: "Master" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "Master",
  );

  // Cleanup: remove the Music bus (default_bus_layout.tres is engine-generated
  // and should be in .gitignore — we don't delete it since it may belong to
  // the project under test)
  try {
    await bridge.call("audiobus.edit", { action: "remove_bus", bus_name: "Music" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}

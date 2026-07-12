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

  // List all buses. bus_count stays an unwrapped top-level scalar; the structured
  // bus array is untrusted-enveloped (parity with resource.load — see §18), so
  // buses is a nonce-tagged <untrusted-*> string, not a raw array.
  const listResult = (await bridge.call("audiobus.list", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    bus_count?: number;
    buses?: string;
  };

  if (listResult?.success !== true || (listResult.bus_count ?? 0) < 2) {
    fail(`audiobus.list: ${JSON.stringify(listResult)}`);
  } else if (
    typeof listResult.buses !== "string" ||
    !/^<untrusted-[0-9a-f]+ kind="audiobus" source="project-audio">/.test(listResult.buses)
  ) {
    fail(
      `audiobus.list: buses missing nonce-tagged <untrusted-* kind="audiobus"> envelope: ${JSON.stringify(listResult.buses)?.slice(0, 200)}`,
    );
  } else if ((listResult.buses.match(/<untrusted-[0-9a-f]+/g) ?? []).length !== 1) {
    fail(
      `audiobus.list: buses has ${(listResult.buses.match(/<untrusted-[0-9a-f]+/g) ?? []).length} envelopes, expected exactly 1 (double-wrap?)`,
    );
  } else {
    // The wrapped body must round-trip to a bus array carrying the added Music bus.
    const inner = listResult.buses
      .replace(/^<untrusted-[0-9a-f]+ [^>]*>\n/, "")
      .replace(/\n<\/untrusted-[0-9a-f]+>$/, "");
    let buses: Array<{ name?: string }> = [];
    try {
      buses = JSON.parse(inner) as Array<{ name?: string }>;
    } catch {
      /* handled by the shape check below */
    }
    if (Array.isArray(buses) && buses.some((b) => b.name === "Music")) {
      pass(
        `audiobus.list -> bus_count=${listResult.bus_count}, buses wrapped in nonce-tagged <untrusted-* kind="audiobus">`,
      );
    } else {
      fail(`audiobus.list: enveloped body did not parse to a bus array with Music: ${inner.slice(0, 200)}`);
    }
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

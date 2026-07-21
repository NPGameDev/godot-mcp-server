/**
 * Unit tests for the unified channel selector on signal_emit + execute_code.
 *
 * Both tools advertise `channel: "editor" | "runtime"` and accept a hidden
 * "game" alias that the schema maps to "runtime" before validation. These pins
 * lock the alias contract at the schema layer — the only place the mapping is
 * exercised (the live smoke dials the toolkit directly and never passes the
 * param), and the sole deterministic lock for execute_code's channel, whose
 * routing handler is built with a live SDK server and cannot be unit-isolated.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { signalTools } from "../../src/tools/signals.js";
import { runtimeTools } from "../../src/tools/runtime.js";
import type { ToolDef } from "../../src/shared/types.js";

function toolByName(defs: ToolDef[], name: string): ToolDef {
  const def = defs.find((t) => t.name === name);
  assert.ok(def, `${name} present in its tool-def array`);
  return def;
}

/** The channel param's advertised JSON-Schema enum, under a given io direction. */
function channelEnum(def: ToolDef, io: "input" | "output"): unknown {
  const json = z.toJSONSchema(z.object(def.inputSchema), { io }) as {
    properties?: Record<string, { enum?: unknown }>;
  };
  return json.properties?.channel?.enum;
}

// ── The advertised enum is exactly [editor, runtime] — "game" stays hidden ──
// tools/list must never surface the "game" alias, nor the retired param names
// (signal_emit's "mode", execute_code's "context").
for (const [label, def] of [
  ["signal_emit", toolByName(signalTools, "signal_emit")],
  ["execute_code", toolByName(runtimeTools, "execute_code")],
] as const) {
  for (const io of ["input", "output"] as const) {
    assert.deepEqual(
      channelEnum(def, io),
      ["editor", "runtime"],
      `${label} advertises channel enum [editor, runtime] under io:"${io}" (no "game", no legacy name)`,
    );
  }
  const props = Object.keys(def.inputSchema);
  assert.ok(props.includes("channel"), `${label} exposes the "channel" param`);
  assert.ok(!props.includes("mode"), `${label} no longer exposes "mode"`);
  assert.ok(!props.includes("context"), `${label} no longer exposes "context"`);
}

// ── The "game" alias maps to "runtime"; "editor" passes through; junk rejects ──
for (const [label, def] of [
  ["signal_emit", toolByName(signalTools, "signal_emit")],
  ["execute_code", toolByName(runtimeTools, "execute_code")],
] as const) {
  const schema = z.object(def.inputSchema);
  // A minimal valid payload per tool (the non-channel required fields differ).
  const base = label === "signal_emit" ? { node_path: "/root/N", signal_name: "pressed" } : { code: "1 + 1" };

  const asGame = schema.parse({ ...base, channel: "game" }) as { channel?: string };
  assert.equal(asGame.channel, "runtime", `${label}: channel "game" maps to "runtime"`);

  const asEditor = schema.parse({ ...base, channel: "editor" }) as { channel?: string };
  assert.equal(asEditor.channel, "editor", `${label}: channel "editor" passes through`);

  const asRuntime = schema.parse({ ...base, channel: "runtime" }) as { channel?: string };
  assert.equal(asRuntime.channel, "runtime", `${label}: channel "runtime" passes through`);

  assert.throws(() => schema.parse({ ...base, channel: "bogus" }), `${label}: an unknown channel is rejected`);

  // channel is optional — omitting it leaves the value unset (the handler applies
  // the tool's own default: editor for signal_emit, runtime for execute_code).
  const omitted = schema.parse(base) as { channel?: string };
  assert.equal(omitted.channel, undefined, `${label}: channel is optional (omitted → unset)`);
}

console.log("All channel_selector tests passed.");

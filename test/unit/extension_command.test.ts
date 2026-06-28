/**
 * Unit tests for extension_command.ts — the wire-adapter leaf
 * (toolNameFromMethod / extensionAnnotations / toExtensionCommand).
 *
 * Pure functions, so no fakes: asserts the method→toolName mapping, the
 * annotation defaulting, and the grouped ExtensionCmd shape (incl. the
 * description fallback + inputSchema default) the discovery / change-application
 * paths rely on. Additive (concern 091 C0); the facade extensions.test.ts still
 * covers the integrated behavior.
 */
import assert from "node:assert/strict";
import { toolNameFromMethod, extensionAnnotations, toExtensionCommand } from "../../src/extensions/extensionCommand.js";

// ── toolNameFromMethod — dot→underscore mapping ──────────────────────

assert.equal(toolNameFromMethod("a.b"), "a_b", "single dot maps to underscore");
assert.equal(toolNameFromMethod("a.b.c"), "a_b_c", "every dot maps (multi-dot)");
assert.equal(toolNameFromMethod("plain"), "plain", "no dot passes through unchanged");
assert.equal(toolNameFromMethod(""), "", "empty string passes through");

// ── extensionAnnotations — default-false, honor-true ─────────────────

assert.deepEqual(
  extensionAnnotations({}),
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  "absent annotations default every hint to false",
);
assert.deepEqual(
  extensionAnnotations({ annotations: {} }),
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  "empty annotations object defaults every hint to false",
);
assert.deepEqual(
  extensionAnnotations({ annotations: { readOnlyHint: true, destructiveHint: true, idempotentHint: true } }),
  { readOnlyHint: true, destructiveHint: true, idempotentHint: true },
  "present true hints are honored",
);
assert.deepEqual(
  extensionAnnotations({ annotations: { readOnlyHint: true } }),
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
  "partial annotations: present honored, absent defaulted",
);

// ── toExtensionCommand — full grouped ExtensionCmd shape ─────────────

{
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false };
  const cmd = { method: "my.tool", description: "Does a thing", input_schema: { type: "object" } };
  assert.deepEqual(
    toExtensionCommand(cmd, annotations),
    {
      method: "my.tool",
      toolName: "my_tool",
      description: "Does a thing",
      inputSchema: { type: "object" },
      annotations,
    },
    "full shape: method, mapped toolName, description, inputSchema, annotations",
  );
}

// description fallback when omitted / empty.
{
  const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  assert.equal(
    toExtensionCommand({ method: "x.y" }, annotations).description,
    "Extension: x.y",
    "missing description falls back to `Extension: <method>`",
  );
  assert.equal(
    toExtensionCommand({ method: "x.y", description: "" }, annotations).description,
    "Extension: x.y",
    "empty description falls back to `Extension: <method>`",
  );
}

// inputSchema defaults to {} when the wire omits input_schema.
{
  const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  assert.deepEqual(
    toExtensionCommand({ method: "x.y" }, annotations).inputSchema,
    {},
    "missing input_schema defaults to {}",
  );
}

console.log("All extension_command tests passed.");

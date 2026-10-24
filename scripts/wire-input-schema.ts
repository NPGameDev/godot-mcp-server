/**
 * The `inputSchema` a tool advertises in `tools/list`, built the way the running
 * server builds it, so the generated tool reference and the token measure describe
 * the payload a client receives rather than an approximation of it.
 */
import { objectFromShape } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

import { addStringCoercion } from "../src/shared/schemaCoercion.js";
import type { ToolDef } from "../src/shared/types.js";

/**
 * Convert a tool's Zod input shape to the JSON Schema `tools/list` sends for it.
 *
 * @remarks Applies the string coercion `registerToolWrapped` adds to every shape,
 * then the SDK's own converter with the options its `tools/list` handler passes
 * (input side of each pipe, draft-07). A param's required/optional status and its
 * JSON Schema dialect therefore follow the wire, not zod's output-side defaults.
 * Throws when the shape cannot be converted, as the SDK would.
 */
export function toWireInputSchema(shape: ToolDef["inputSchema"]): Record<string, unknown> {
  const object = objectFromShape(addStringCoercion(shape));
  return toJsonSchemaCompat(object, { strictUnions: true, pipeStrategy: "input" }) as Record<string, unknown>;
}

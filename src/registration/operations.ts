/**
 * Operation-coverage counting — the single derivation of how many distinct
 * *operations* (action-discriminator values) the built-in tool surface exposes.
 *
 * An action-consolidated tool packs several operations behind one enum
 * discriminator (`node_manage.action` → rename/reparent/reorder/duplicate), so a
 * raw tool count understates the real breadth. This module is the SSOT the
 * `--tools-count` CLI, the `01_catalogue` drift gate, and the tool-reference
 * generator all count through, so the number can never differ between them.
 *
 * Human-facing only: operation counts feed reports and docs, never a tool
 * description or `discover_tools` output.
 *
 * @module
 */
import { z } from "zod";
import type { ToolDef } from "../shared/types.js";

/**
 * The distinct operations a tool exposes through its discriminator: the values
 * of its `operationParam` enum, else its explicit `operations` list, else an
 * empty array for a tool that performs one implicit operation with no
 * discriminator.
 *
 * @param def one catalogue tool definition
 * @returns the operation value names, or an empty array for a single-operation
 *   tool — callers that need a count floor it at 1 (see {@link operationCountOf})
 * @remarks Reads the enum values via `z.toJSONSchema` (the codebase idiom, robust
 *   across Zod point releases) rather than the Zod-instance enum API. A missing or
 *   non-enum `operationParam` yields no values; the drift gate is what asserts the
 *   param names a real enum.
 */
export function operationsOf(def: ToolDef): readonly string[] {
  if (def.operationParam) {
    const values = enumValuesOf(def.inputSchema, def.operationParam);
    if (values.length > 0) return values;
  }
  if (def.operations && def.operations.length > 0) return def.operations;
  return [];
}

/** A tool's operation count — its discriminator values, or 1 for a single-operation tool. */
export function operationCountOf(def: ToolDef): number {
  return Math.max(1, operationsOf(def).length);
}

/**
 * Total built-in operations across every catalogued tool — the sum of each
 * tool's {@link operationCountOf}.
 *
 * @param defs the canonical catalogue (`ALL_TOOL_DEFS`)
 * @returns the operation grand total (the figure `--tools-count` prints and the
 *   drift gate snapshots)
 */
export function countBuiltinOperations(defs: readonly ToolDef[]): number {
  let total = 0;
  for (const def of defs) total += operationCountOf(def);
  return total;
}

/**
 * The enum values of a top-level inputSchema param, or an empty array when the
 * param is absent or not a plain enum (e.g. a string, or an enum nested in a
 * union — those tools declare `operations` instead).
 */
function enumValuesOf(inputSchema: ToolDef["inputSchema"], param: string): readonly string[] {
  const json = z.toJSONSchema(z.object(inputSchema)) as {
    properties?: Record<string, { enum?: readonly string[] }>;
  };
  return json.properties?.[param]?.enum ?? [];
}

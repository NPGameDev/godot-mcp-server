/**
 * Extension wire adapter — the anti-corruption leaf of the extension subsystem.
 *
 * The single home for translating an ExtensionCmdWire (the raw snake_case shape
 * the toolkit pushes over the bridge) into the server's internal model: the
 * method→toolName mapping ("a.b" → "a_b"), the MCP annotation object (each hint
 * defaulting to false when the plugin omits it), and the grouped ExtensionCmd
 * builder. Pure + stateless with type-only imports, so it is a true leaf (zero
 * runtime edges) shared by the registrar, discovery, and change-application
 * sub-units — the dot-mapping and the ExtensionCmd literal live here, once.
 */
import type { ExtensionCmd } from "../groups/groups.js";
import type { ExtensionCmdWire } from "../shared/types.js";

/** Map an extension method name ("a.b.c") to its MCP tool name ("a_b_c"). */
export function toolNameFromMethod(method: string): string {
  return method.replace(/\./g, "_");
}

/** Build the MCP annotation object for an extension command, defaulting each
 *  hint to false when the plugin omits it. */
export function extensionAnnotations(cmd: Pick<ExtensionCmdWire, "annotations">): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
} {
  return {
    readOnlyHint: cmd.annotations?.readOnlyHint ?? false,
    destructiveHint: cmd.annotations?.destructiveHint ?? false,
    idempotentHint: cmd.annotations?.idempotentHint ?? false,
  };
}

/** Build the grouped ExtensionCmd model from a wire command and its already-computed
 *  annotations. Callers compute annotations once (they also need it for the read-only
 *  eligibility check), so it is passed in rather than recomputed here. */
export function toExtensionCommand(
  cmd: ExtensionCmdWire,
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean },
): ExtensionCmd {
  return {
    method: cmd.method,
    toolName: toolNameFromMethod(cmd.method),
    description: cmd.description || `Extension: ${cmd.method}`,
    inputSchema: cmd.input_schema ?? {},
    annotations,
  };
}

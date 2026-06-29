/**
 * Extension name-collision guard.
 *
 * Refuses an extension tool whose name would shadow a built-in tool or a tool
 * that is already registered. The server is the only component that holds BOTH
 * its full built-in catalogue and a discovered extension's chosen name at
 * registration time — the toolkit publishes the extensions but never sees the
 * server's built-in list — so a built-in↔extension name clash can only be caught
 * here.
 *
 * Installed extensions run in-process with full trust, so refusing a clash is
 * defence-in-depth against ACCIDENTAL name reuse (a well-meaning author reuses a
 * name the server already ships), not a privilege boundary: the clash is skipped
 * with a loud warning, never a crash, and the incumbent always wins — a built-in
 * is never overwritten, and between two extensions the first to register keeps the
 * name.
 */
import { isBuiltinToolName } from "./catalogue.js";
import { hasToolRef } from "./toolRefs.js";

/**
 * Whether registering an extension tool under `toolName` would collide with a
 * built-in tool or an already-registered tool; the caller MUST skip the tool when
 * this returns true (the incumbent keeps the name). A collision is logged to
 * stderr so the skip is diagnosable; a free name returns false silently.
 *
 * @remarks
 * The explicit pre-check makes the MCP SDK's duplicate-name handling moot for
 * correctness: the SDK's `registerTool` throws `Tool <name> is already registered`
 * on a repeated name, so refusing the collision here skips the one tool cleanly
 * instead of letting that throw abort the surrounding registration batch.
 */
export function extensionNameCollides(toolName: string): boolean {
  if (isBuiltinToolName(toolName) || hasToolRef(toolName)) {
    process.stderr.write(
      `[godot-mcp] extension tool '${toolName}' collides with a built-in (or already-registered) tool — skipped\n`,
    );
    return true;
  }
  return false;
}

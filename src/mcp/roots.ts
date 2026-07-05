/**
 * MCP Roots support.
 *
 * In the MCP protocol, roots are primarily a CLIENT capability — the
 * client declares its workspace roots and the server can
 * request them. This module exposes the Godot project root as a
 * resource so it's discoverable.
 *
 * The project path is resolved at startup from:
 *   1. GODOT_MCP_PROJECT_PATH env var (highest precedence)
 *   2. Registry lookup matching the editor port
 *   3. process.cwd() (fallback)
 *
 * @module
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Resolved project path — set once at startup via init(). */
let projectRoot: string | undefined;

/** Set the resolved project root (startup wiring). @internal */
export function init(path: string | undefined): void {
  projectRoot = path;
}

/**
 * Register a `godot://roots` resource that returns the project root(s).
 * This lets MCP clients discover what Godot project this server is
 * connected to without relying on the client's own root list.
 */
export function registerRoots(server: McpServer): void {
  server.resource("roots", "godot://roots", { mimeType: "application/json" }, async (uri) => {
    const roots: { uri: string; name: string }[] = [];
    if (projectRoot) {
      // Normalize to file:// URI for cross-platform compatibility.
      const fileUri = projectRoot.startsWith("file://") ? projectRoot : `file://${projectRoot.replace(/\\/g, "/")}`;
      roots.push({ uri: fileUri, name: "Godot Project" });
    }
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ roots }, null, 2),
        },
      ],
    };
  });
}

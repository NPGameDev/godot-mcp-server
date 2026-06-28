/**
 * MCP Resources registration.
 *
 * Exposes Godot project artifacts as URI-addressable resources that the MCP
 * client can list, fetch, and reference in conversation. Resources are
 * complementary to tools — reads vs actions.
 *
 * @module
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../shared/types.js";

/**
 * Register the read-only Godot resources (`godot://scene/{path}`,
 * `godot://script/{path}`, `godot://project/info`) on the server. Each fetches
 * live state over the bridge and degrades to an error payload if the call fails.
 */
export function registerResources(server: McpServer, bridge: Bridge): void {
  // ── godot://scene/{path} ─────────────────────────────────────────────
  // Returns the scene tree snapshot for the given scene file path.
  // The path should be a res:// path (e.g. "res://Main.tscn").
  server.resource("scene", "godot://scene/{path}", { mimeType: "application/json" }, async (uri) => {
    const path = decodeScenePath(uri.href);
    try {
      const result = await bridge.call("scene.get_tree", {
        depth: 4,
        include_properties: false,
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              error: (err as Error).message,
              path,
            }),
          },
        ],
      };
    }
  });

  // ── godot://script/{path} ──────────────���─────────────────────────────
  // Returns the script source for a given res:// path.
  server.resource("script", "godot://script/{path}", { mimeType: "text/x-gdscript" }, async (uri) => {
    const path = decodeScriptPath(uri.href);
    try {
      const result = (await bridge.call("script.read", {
        file_path: path,
      })) as { content?: string };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/x-gdscript",
            text: typeof result?.content === "string" ? result.content : JSON.stringify(result),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `Error reading script: ${(err as Error).message}`,
          },
        ],
      };
    }
  });

  // ── godot://project/info ─────────────────────────────────────────────
  // Returns project metadata (name, Godot version, etc.).
  server.resource("project-info", "godot://project/info", { mimeType: "application/json" }, async (uri) => {
    try {
      const result = await bridge.call("project.get_settings", {
        keys: ["application/config/name", "application/config/version"],
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ error: (err as Error).message }),
          },
        ],
      };
    }
  });
}

// ── URI helpers ─────��────────────────────────────────────────────────────

/** Extract the res:// path from a godot://scene/ URI. */
function decodeScenePath(href: string): string {
  // godot://scene/res://Main.tscn → res://Main.tscn
  const match = href.match(/^godot:\/\/scene\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : href;
}

/** Extract the res:// path from a godot://script/ URI. */
function decodeScriptPath(href: string): string {
  const match = href.match(/^godot:\/\/script\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : href;
}

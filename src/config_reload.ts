/**
 * Live config reload — re-reads .mcp.json env vars and rebuilds the
 * tool list without restarting the server process.
 *
 * Triggered by a WebSocket notification from the Godot plugin when the
 * user changes settings in the editor UI.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read .mcp.json from the project root and return the env vars
 * for the godot-mcp-toolkit server entry.  Returns null on any failure
 * (missing file, parse error, no matching server key).
 */
export function readMcpJsonEnv(projectPath: string): Record<string, string> | null {
  try {
    const mcpJsonPath = join(projectPath, ".mcp.json");
    const raw = readFileSync(mcpJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    const servers = parsed?.mcpServers;
    if (!servers) return null;

    // Find our server entry (mirrors mcp_json_sync.gd._find_server_key).
    let serverEntry = servers["godot-mcp-toolkit"];
    if (!serverEntry) {
      for (const key of Object.keys(servers)) {
        if (key.toLowerCase().includes("godot-mcp")) {
          serverEntry = servers[key];
          break;
        }
      }
    }
    if (!serverEntry?.env) return null;
    return serverEntry.env;
  } catch {
    return null;
  }
}

/**
 * Apply new env vars to process.env.  Only touches GODOT_MCP_* keys
 * to avoid overwriting unrelated environment.
 */
export function applyEnvUpdate(newEnv: Record<string, string>): void {
  const prefix = "GODOT_MCP_";

  // Remove MCP vars that are no longer in .mcp.json.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(prefix) && !(key in newEnv)) {
      delete process.env[key];
    }
  }

  // Set / update vars from .mcp.json.
  for (const [key, value] of Object.entries(newEnv)) {
    process.env[key] = String(value);
  }
}

/**
 * Locked stubs for feature-gated tools. When the env var is not set,
 * a lightweight stub appears in tools/list with a "LOCKED —" description
 * prefix so the LLM can discover the capability and tell the user how
 * to enable it.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProfileName } from "./profiles.js";
import { isEnabled, envVarFor } from "./feature_gate.js";

interface StubDef {
  name: string;
  gate: string;
  description: string;
}

const STUBS: StubDef[] = [
  {
    name: "game_eval",
    gate: "game_eval",
    description:
      "LOCKED — evaluate GDScript in running game. Enable: set GODOT_MCP_ALLOW_GAME_EVAL=1 in .mcp.json env. Requires full MCP agent restart (reconnect is not enough).",
  },
  {
    name: "node_call_method",
    gate: "node_call_method",
    description:
      "LOCKED — call arbitrary method on scene node. Enable: set GODOT_MCP_ALLOW_NODE_CALL_METHOD=1 in .mcp.json env. Requires full MCP agent restart (reconnect is not enough).",
  },
  {
    name: "project_set_setting",
    gate: "project_set_setting",
    description:
      "LOCKED — write ProjectSettings. Enable: set GODOT_MCP_ALLOW_PROJECT_SET_SETTING=1 in .mcp.json env. Requires full MCP agent restart (reconnect is not enough).",
  },
];

/**
 * Register locked stubs for feature-gated tools whose env var is not set.
 * - minimal profile: no stubs (pure read-only)
 * - standard / power_user: stubs for closed gates, real tools for open gates
 */
export function registerStubs(server: McpServer, profile: ProfileName): void {
  if (profile === "minimal") return;
  for (const stub of STUBS) {
    if (isEnabled(stub.gate)) continue; // Real tool registered by its module
    const envVar = envVarFor(stub.gate) ?? stub.gate;
    server.registerTool(
      stub.name,
      {
        description: stub.description,
        annotations: { openWorldHint: false },
      },
      async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: `Feature gated. Set ${envVar}=1 in .mcp.json env and restart.`,
              code: "FEATURE_GATED",
              hint: `Requires full MCP agent restart after env changes (reconnect is not enough). Set the env var in .mcp.json, then restart your agent.`,
            }),
          },
        ],
        isError: true,
      }),
    );
  }
}

/** Names of tools that have locked stubs when their gate is closed. */
export const GATED_TOOL_NAMES = STUBS.map((s) => s.name);

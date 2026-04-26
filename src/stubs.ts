/**
 * Locked stubs for feature-gated tools. When the gate is closed (or the
 * profile doesn't include the tool), a lightweight stub appears in
 * tools/list with a "LOCKED —" description prefix so the LLM can
 * discover the capability. Detailed unlock instructions live in the
 * error response (hint field), not the description.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProfileName } from "./profiles.js";
import { isEnabled, envVarFor } from "./feature_gate.js";

interface StubDef {
  name: string;
  gate: string;
  oneLiner: string;
}

const STUBS: StubDef[] = [
  {
    name: "game_eval",
    gate: "game_eval",
    oneLiner: "evaluate GDScript in running game",
  },
  {
    name: "node_call_method",
    gate: "node_call_method",
    oneLiner: "call arbitrary method on scene node",
  },
  {
    name: "project_set_setting",
    gate: "project_set_setting",
    oneLiner: "write ProjectSettings",
  },
];

/**
 * Register locked stubs for feature-gated tools.
 * - minimal: always stubs (profile is the primary blocker)
 * - standard / power_user: stubs for closed gates only
 */
export function registerStubs(server: McpServer, profile: ProfileName): void {
  for (const stub of STUBS) {
    const envVar = envVarFor(stub.gate) ?? stub.gate;

    if (profile === "minimal") {
      // Minimal doesn't include gated tools — always stub regardless of gate state
      server.registerTool(
        stub.name,
        {
          description: `LOCKED — ${stub.oneLiner}. Standard/Power User profile.`,
          annotations: { openWorldHint: false },
        },
        async () => ({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: "Not available in Minimal profile.",
                code: "PROFILE_LOCKED",
                hint: `Set GODOT_MCP_PROFILE=standard in .mcp.json env. Also requires ${envVar}=1.`,
              }),
            },
          ],
          isError: true,
        }),
      );
      continue;
    }

    if (isEnabled(stub.gate)) continue; // Real tool registered by its module

    server.registerTool(
      stub.name,
      {
        description: `LOCKED — ${stub.oneLiner}. Gate: ${envVar}.`,
        annotations: { openWorldHint: false },
      },
      async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: `Feature gated — ${envVar} is not enabled.`,
              code: "FEATURE_GATED",
              hint: `Enable via the Feature Gates panel in the Godot editor, or set ${envVar}=1 in .mcp.json env.`,
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

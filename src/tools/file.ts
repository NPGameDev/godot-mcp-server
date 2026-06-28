import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef, ToolTextResult } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { callAndWrap } from "../registration/toolDispatch.js";
import { PROJECT_FILE_PATH } from "../security/pathGuard.js";

export const fileTools: ToolDef[] = [
  {
    name: "file_delete",
    method: "file.delete",
    description:
      "Delete any file under res:// and its .import companion. Auto-closes .tscn/.scn editor tabs on 4.5+ (tab_closed:true). Use for assets not covered by scene/script/resource.delete.",
    inputSchema: {
      file_path: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    pathParams: [PROJECT_FILE_PATH],
  },
];

// ── Conditional hint for file_delete ─────────────────────────────────

/** Suggest the specialized delete tool when file_delete is used on a typed resource. */
function fileDeleteHint(filePath: string): string | undefined {
  if (/\.(?:tscn|scn)$/i.test(filePath)) {
    return "For .tscn/.scn files, prefer scene_delete — it handles open-tab cleanup.";
  }
  if (/\.(?:gd|gdshader|gdshaderinc)$/i.test(filePath)) {
    return "For scripts, prefer script_delete.";
  }
  if (/\.(?:tres|res)$/i.test(filePath)) {
    return "For resources, prefer resource_delete.";
  }
  return undefined;
}

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  const handlers = new Map<string, (input: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolTextResult>>();
  handlers.set("file_delete", async (input, signal) => {
    const filePath = typeof input.file_path === "string" ? input.file_path : "";
    return callAndWrap(bridge, "file.delete", input, { signal, successHint: fileDeleteHint(filePath) });
  });
  registerTools(server, bridge, fileTools, allowedTools, { handlers });
}

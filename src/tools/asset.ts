import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools, coercedBoolean, jsonCoerce } from "../tool_helpers.js";

export const assetTools: ToolDef[] = [
  {
    name: "asset_list",
    method: "asset.list",
    description:
      "Enumerate res:// assets with filters (path_prefix, name_glob, class_filter ancestry-aware, extension_filter). Returns [{path,class,modified_unix}]. Cap max_results 2000.",
    inputSchema: {
      path_prefix: z.string().optional(),
      name_glob: z.string().optional(),
      class_filter: z.string().optional(),
      extension_filter: z.preprocess(jsonCoerce, z.array(z.string())).optional(),
      max_results: z.coerce.number().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "asset_get_dependencies",
    method: "asset.get_dependencies",
    description:
      "Forward dependencies of a res:// resource/scene via EditorFileSystem cache. include_transitive walks deps-of-deps. Returns [{path,raw_path,class}].",
    inputSchema: {
      file_path: z.string(),
      include_transitive: coercedBoolean().optional(),
      max_results: z.coerce.number().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "asset_import",
    method: "asset.import",
    description:
      "Import binary asset (image/audio/font/3D) into res:// via source_path (absolute or res:// path) or base64_data. Triggers EditorFileSystem scan. if_exists:return|fail|replace.",
    inputSchema: {
      source_path: z.string().optional(),
      base64_data: z.string().optional(),
      dest_path: z.string(),
      if_exists: z.enum(["return", "fail", "replace"]).optional(),
      wait_for_scan_ms: z.coerce.number().optional(),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    successHint: "Verify import with resource_load. Check file system with asset_list.",
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, assetTools, allowedTools);
}

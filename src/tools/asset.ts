import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { coercedBoolean, jsonCoerce } from "../shared/schemaCoercion.js";
import { PROJECT_FILE_PATH } from "../security/pathGuard.js";
import { assetWriteFields } from "./assetWrite.js";

export const assetTools: ToolDef[] = [
  {
    name: "asset_list",
    method: "asset.list",
    description:
      "Enumerate res:// assets with filters (path_prefix, name_glob, class_filter ancestry-aware, extension_filter). Returns [{path,class,modified_unix}]. Cap max_results 2000. " +
      "+total_assets/truncated (cursor-less — narrow filters or raise max_results).",
    inputSchema: {
      path_prefix: z.string().optional(),
      name_glob: z.string().optional(),
      class_filter: z.string().optional(),
      extension_filter: z.preprocess(jsonCoerce, z.array(z.string())).optional(),
      max_results: z.coerce.number().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint:
      "A just-deindexed asset (e.g. after resource_delete) can linger in this list until EditorFileSystem re-scans — call editor_refresh to force a rescan if a deleted asset still appears.",
    pathParams: [{ param: "path_prefix", guard: "project" }],
  },
  {
    name: "asset_get_dependencies",
    method: "asset.get_dependencies",
    description:
      "Forward dependencies of a res:// resource/scene via EditorFileSystem cache. include_transitive walks deps-of-deps. Returns [{path,raw_path,class}]. " +
      "+total_dependencies/truncated (cursor-less).",
    inputSchema: {
      file_path: z.string(),
      include_transitive: coercedBoolean().optional(),
      max_results: z.coerce.number().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "asset_import",
    method: "asset.import",
    description:
      "Import binary asset (image/audio/font/3D) into res:// via exactly one of source_path (absolute or res:// path) or base64_data. Triggers EditorFileSystem scan. if_exists:return|fail|replace.",
    inputSchema: {
      source_path: z.string().optional(),
      base64_data: z.string().optional(),
      dest_path: z.string(),
      ...assetWriteFields,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    successHint: "Verify import with resource_load. Check file system with asset_list.",
    // Only dest_path is guarded. source_path is deliberately NOT declared: it is
    // an absolute filesystem path to an external asset (the toolkit reads it raw,
    // guarding only dest_path) — guarding it would false-reject intended use.
    pathParams: [{ param: "dest_path", guard: "project" }],
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, assetTools, allowedTools);
}

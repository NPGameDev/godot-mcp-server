import { z } from "zod";

/**
 * Shared file-write fields for the tools that write a res:// asset and settle
 * its import through the toolkit's `write_asset_with_settle` bracket:
 * asset_import, texture_generate, sound_generate.
 *
 * The path parameter itself is declared per-tool (asset_import uses `dest_path`;
 * the generators use `path`), so only the two identical fields live here.
 */
export const assetWriteFields = {
  if_exists: z.enum(["return", "fail", "replace"]).optional(),
  wait_for_scan_ms: z.coerce.number().optional(),
} as const;

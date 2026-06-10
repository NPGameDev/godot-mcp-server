// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers for the flow suite (41m-bis).
//
// Flows write real probe files into the dogfood project (res:// = the toolkit
// repo root, same as smoke's `res://smoke_*` probes). Every flow MUST leave the
// working tree clean — see CLAUDE.md "test tools not committed". Each flow is
// self-cleaning (try/finally), and the orchestrator does a final sweep of the
// probe dir. Probe files live under res://flow_probes/ so a single recursive
// folder.delete removes scripts, their generated .uid sidecars, and scenes.
// ═══════════════════════════════════════════════════════════════════════════

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, MAIN_SCENE } from "../helpers.js";

/** Probe directory — one recursive delete cleans every flow artifact. */
export const FLOW_PROBE_DIR = "res://flow_probes";

/** Create the probe dir, tolerating "already exists". */
export async function ensureProbeDir(ctx: TestCtx): Promise<void> {
  try {
    await ctx.bridge.call("folder.create", { folder_path: FLOW_PROBE_DIR }, CALL_TIMEOUT);
  } catch {
    // Folder may already exist from a prior run — non-fatal.
  }
}

/** Recursively delete the probe dir, tolerating "missing". Best-effort. */
export async function cleanupProbeDir(ctx: TestCtx): Promise<void> {
  try {
    await ctx.bridge.call("folder.delete", { folder_path: FLOW_PROBE_DIR, recursive: true }, CALL_TIMEOUT);
  } catch {
    // Already gone — non-fatal.
  }
}

/** Switch the active tab back to Main.tscn (so a probe scene can be deleted). */
export async function restoreMainScene(ctx: TestCtx): Promise<void> {
  try {
    await ctx.bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);
  } catch {
    // Best-effort — the next flow re-establishes its own scene.
  }
}

/** Narrow helper: did a bridge result come back as a success envelope? */
export function isOk(result: unknown): boolean {
  return (result as { success?: boolean })?.success === true;
}

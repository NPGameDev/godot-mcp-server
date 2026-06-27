/**
 * Per-instance token-file location + read (the C-TOKEN leaf).
 *
 * One responsibility: the token-file LOCATION contract — resolve the Godot
 * project name, derive the per-OS `user://` path plus the per-instance
 * `project_instance_<hash>` subdirectory, and read the session token off disk.
 * Mirrors the toolkit's GDScript `project_paths.gd` derivation byte-for-byte so
 * two worktrees of the same repo resolve to the same directory on both sides.
 *
 * Pure path/filesystem logic — no wire protocol, no channel/auth coupling.
 * `resolveTokenPath` + `resolveProjectName` are exported for direct unit testing
 * of the §10.1 token contract; `channel.ts`/`bridge.ts` import only `readToken`.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { BridgeError } from "./errors.js";

/**
 * Resolve the Godot project name.
 *
 * Precedence:
 *   1. GODOT_MCP_PROJECT_NAME env var  (set by smoke harness / CI)
 *   2. config/name in project.godot at projectPath (from registry)
 *   3. config/name in project.godot in cwd
 *   4. "[unnamed project]"  (matches Godot's actual appdata dir name)
 */
export async function resolveProjectName(projectPath?: string): Promise<string> {
  const envName = process.env.GODOT_MCP_PROJECT_NAME;
  if (envName) return envName;
  // Try the known project directory first, then fall back to cwd.
  const candidates = projectPath ? [join(projectPath, "project.godot"), "project.godot"] : ["project.godot"];
  for (const path of candidates) {
    try {
      const content = await readFile(path, "utf-8");
      const match = content.match(/config\/name="([^"]+)"/);
      if (match) return match[1];
    } catch {
      // Not found at this location — try next.
    }
  }
  return "[unnamed project]";
}

/**
 * Cross-platform Godot user:// path resolution.
 *   win32:  %APPDATA%/Godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token
 *   darwin: ~/Library/Application Support/Godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token
 *   linux:  ~/.local/share/godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token
 *
 * Per-instance: when projectPath is known, the token lives in a hash-named
 * subdirectory matching the plugin's project_paths.gd derivation. Two
 * worktrees of the same repo get distinct directories.
 */
export async function resolveTokenPath(projectPath?: string): Promise<string> {
  const envPath = process.env.GODOT_MCP_TOKEN_PATH;
  if (envPath) return envPath;

  const projectName = await resolveProjectName(projectPath);

  // Per-instance: hash the canonical project path so two worktrees of the
  // same repo (same config/name → same user://) get distinct directories.
  // The plugin writes the token to
  //   user://addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token
  // (see project_paths.gd + auth.gd), so the subdir must match here.
  let instanceDir = "addons/godot_mcp_toolkit";
  if (projectPath) {
    let canonical = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
    // Windows/macOS: lowercase to match GDScript project_paths.gd hash.
    if (process.platform === "win32" || process.platform === "darwin") canonical = canonical.toLowerCase();
    const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
    instanceDir = join("addons", "godot_mcp_toolkit", `project_instance_${hash}`);
  }

  const tokenFile = "mcp_token";

  switch (process.platform) {
    case "win32":
      return join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "Godot",
        "app_userdata",
        projectName,
        instanceDir,
        tokenFile,
      );
    case "darwin":
      return join(
        homedir(),
        "Library",
        "Application Support",
        "Godot",
        "app_userdata",
        projectName,
        instanceDir,
        tokenFile,
      );
    default:
      return join(homedir(), ".local", "share", "godot", "app_userdata", projectName, instanceDir, tokenFile);
  }
}

/**
 * Read the session token from disk. Re-reads on every call (no caching) so
 * reconnects after a plugin restart pick up the rotated token.
 */
export async function readToken(projectPath?: string): Promise<string> {
  const tokenPath = await resolveTokenPath(projectPath);
  try {
    const token = (await readFile(tokenPath, "utf-8")).trim();
    return token;
  } catch (err) {
    throw new BridgeError("AUTH_FAILED", `cannot read token file at ${tokenPath}: ${(err as Error).message}`);
  }
}

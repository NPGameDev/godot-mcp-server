/**
 * Read the per-instance session token the toolkit published into the registry.
 *
 * The toolkit is authoritative for the token's on-disk LOCATION. At its registry
 * publish sites it globalizes the `user://` token path to an absolute path —
 * honoring `application/config/use_custom_user_dir` live — and writes that into the
 * project's registry entry. This module looks up `entry.token_path`, asserts the
 * published path STRUCTURALLY (absolute, no traversal, the invariant
 * `…/project_instance_<hash>/mcp_token` shape), confirms it is a regular file, and
 * returns its contents. It does NOT re-derive the path: no project-name resolution,
 * no per-OS user-dir reconstruction, no hash recompute.
 *
 * `GODOT_MCP_TOKEN_PATH` is an explicit operator override — a trusted absolute path
 * to an existing file, read directly without the registry or the suffix shape check
 * (it may point anywhere, e.g. a test-harness temp dir).
 *
 * Pure path/filesystem logic — no wire protocol, no channel/auth coupling.
 * `assertPublishedTokenPath` is exported for direct unit testing; the transport
 * imports only `readToken`.
 */
import { readFile, stat } from "node:fs/promises";
import { BridgeError } from "../shared/errors.js";
import { lookupProject } from "../registry.js";

/** Absolute path: POSIX `/…`, Windows `<drive>:/…`, or UNC `//…` (normalize `\`→`/` first). */
const ABSOLUTE_PATH = /^([A-Za-z]:\/|\/)/;

/**
 * Validate a registry-published token path before opening it. The toolkit
 * publishes an absolute, globalized path; this re-asserts the shape a moved or
 * stale registry (or a hand-set value) could otherwise corrupt. Lexical only —
 * symlink resolution is out of scope (single-user localhost threat model). Throws
 * `AUTH_FAILED` on any violation.
 */
export function assertPublishedTokenPath(published: string): void {
  const norm = published.replace(/\\/g, "/");
  // A regex (not path.isAbsolute) keeps the check platform-independent, so a
  // Windows-shaped path validates the same on a POSIX CI runner.
  if (!ABSOLUTE_PATH.test(norm)) {
    throw new BridgeError("AUTH_FAILED", `published token path is not absolute: ${published}`);
  }
  if (norm.split("/").includes("..")) {
    throw new BridgeError("AUTH_FAILED", `published token path contains '..': ${published}`);
  }
  // Invariant suffix — a FORMAT check on the 12-hex instance segment, never a
  // recomputed hash (recomputing would re-add the cross-repo derivation this module
  // exists to remove).
  if (!/(?:^|\/)addons\/godot_mcp_toolkit\/project_instance_[0-9a-f]{12}\/mcp_token$/.test(norm)) {
    throw new BridgeError(
      "AUTH_FAILED",
      `published token path has an unexpected shape: ${published} — expected …/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token`,
    );
  }
}

/**
 * Read the session token from disk. Re-reads on every call (no caching) so a
 * reconnect after a plugin restart picks up the rotated token.
 *
 * @param projectPath absolute project root, used as the registry key. Production
 *   always passes a concrete path; the cwd fallback is a test-only convenience.
 * @returns the trimmed token contents.
 * @throws BridgeError `AUTH_FAILED` — no registry entry, an empty or malformed
 *   published path, or a missing/unreadable token file (each with a distinct,
 *   actionable message).
 */
export async function readToken(projectPath?: string): Promise<string> {
  // Operator override: a trusted absolute path read directly, bypassing the
  // registry and the suffix shape check (still required to be an existing file).
  const envPath = process.env.GODOT_MCP_TOKEN_PATH;
  if (envPath) {
    if (!ABSOLUTE_PATH.test(envPath.replace(/\\/g, "/"))) {
      throw new BridgeError("AUTH_FAILED", `GODOT_MCP_TOKEN_PATH must be an absolute path: ${envPath}`);
    }
    return readRegularFile(envPath, `GODOT_MCP_TOKEN_PATH points at no readable file: ${envPath}`);
  }

  const key = projectPath ?? process.cwd();
  const entry = lookupProject(key);
  if (!entry) {
    throw new BridgeError(
      "AUTH_FAILED",
      `no registry entry for ${key} — is the Godot editor running with the MCP toolkit plugin? Reconnect or relaunch.`,
    );
  }
  const published = entry.token_path;
  if (!published) {
    throw new BridgeError(
      "AUTH_FAILED",
      `registry entry for ${key} has no token path — the editor may not have published yet; relaunch the editor.`,
    );
  }
  assertPublishedTokenPath(published);
  return readRegularFile(
    published,
    `token file not found at published path ${published} — the project may have moved; reconnect or relaunch the editor.`,
  );
}

/**
 * Read a regular file's trimmed contents, throwing `AUTH_FAILED` with `failMsg` if
 * it is missing, not a regular file, or unreadable. Shared by the operator-override
 * and registry-published read paths so both fail with one actionable message.
 */
async function readRegularFile(path: string, failMsg: string): Promise<string> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a regular file");
    return (await readFile(path, "utf-8")).trim();
  } catch {
    throw new BridgeError("AUTH_FAILED", failMsg);
  }
}

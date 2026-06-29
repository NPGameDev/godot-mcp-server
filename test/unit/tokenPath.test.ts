/**
 * Unit tests for tokenPath.ts — the server's token-LOCATION authority.
 *
 * The toolkit publishes an absolute, globalized token path into the registry; the
 * server validates that published path STRUCTURALLY and reads it, never re-deriving
 * it. These pin:
 *   - assertPublishedTokenPath: accepts the published shape (POSIX + Windows, with
 *     `\` normalized); rejects relative, traversal, wrong-suffix, and non-12-hex
 *     instance segments — each as BridgeError("AUTH_FAILED", …).
 *   - readToken via the registry: returns the token at a conforming published path,
 *     re-reads every call, and fails LOUD (AUTH_FAILED) on a missing file, a
 *     malformed or empty token_path, or an absent entry — each naming the reason.
 *   - readToken via the GODOT_MCP_TOKEN_PATH operator override: reads the file
 *     directly (suffix check bypassed), re-reads every call, and rejects a relative
 *     or missing override loud.
 *
 * Registry cases reuse the APPDATA/XDG_DATA_HOME redirect that registryPath()
 * honors; darwin has no such override, so those cases skip there.
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { snapshotEnv } from "./helpers.js";
import { normalizePath, registryPath, type RegistryEntry } from "../../src/registry.js";
import { readToken, assertPublishedTokenPath } from "../../src/transport/tokenPath.js";
import { BridgeError } from "../../src/shared/errors.js";

// ── Hermetic environment (registry redirect; operator override OFF) ──
const REDIRECT: string | null =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : null;

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-tokpath-"));
if (REDIRECT) process.env[REDIRECT] = tmpDir;
// The registry-path cases must exercise lookupProject, not the operator override.
delete process.env.GODOT_MCP_TOKEN_PATH;

const HEX12 = "0123456789ab";
const PREFIX = "/home/u/.local/share/godot/app_userdata/Proj/addons/godot_mcp_toolkit";
const POSIX_OK = `${PREFIX}/project_instance_${HEX12}/mcp_token`;
const WIN_OK = `C:/Users/u/AppData/Roaming/Godot/app_userdata/Proj/addons/godot_mcp_toolkit/project_instance_${HEX12}/mcp_token`;
const WIN_BACKSLASH_OK = `C:\\Users\\u\\Godot\\app_userdata\\Proj\\addons\\godot_mcp_toolkit\\project_instance_${HEX12}\\mcp_token`;

function makeEntry(over: Partial<RegistryEntry>): RegistryEntry {
  return {
    port: 6550,
    token_path: "",
    pid: process.pid,
    started_at: 1000,
    runtime_port: null,
    runtime_pid: null,
    ...over,
  };
}

/** Write projects.json under the redirected registry root. No-op on darwin. */
function writeRegistry(byPath: Record<string, RegistryEntry>): void {
  if (!REDIRECT) return;
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify({ by_path: byPath }));
}

/** Create a real token file at a conforming …/project_instance_<hex>/mcp_token path. */
function makeTokenFile(slug: string, token: string): string {
  const dir = join(tmpDir, slug, "addons", "godot_mcp_toolkit", `project_instance_${HEX12}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "mcp_token");
  writeFileSync(file, token);
  return file;
}

/** assertPublishedTokenPath accepts a conforming published path. */
function guardAccepts(published: string): void {
  assert.doesNotThrow(() => assertPublishedTokenPath(published), `expected ${published} to validate`);
}

/** assertPublishedTokenPath rejects with AUTH_FAILED (optionally pinning the reason). */
function guardRejects(published: string, needle?: string): void {
  assert.throws(
    () => assertPublishedTokenPath(published),
    (err: unknown) =>
      err instanceof BridgeError &&
      err.code === "AUTH_FAILED" &&
      (needle === undefined || err.message.includes(needle)),
    `expected AUTH_FAILED for ${published}`,
  );
}

async function main() {
  console.log("tokenPath tests:");

  // ── 1. Structural guard — direct (pure) cases ──────────────────────
  guardAccepts(POSIX_OK);
  guardAccepts(WIN_OK);
  guardAccepts(WIN_BACKSLASH_OK); // `\` normalized before the checks
  guardRejects(`addons/godot_mcp_toolkit/project_instance_${HEX12}/mcp_token`, "not absolute"); // relative
  guardRejects(`${PREFIX}/project_instance_${HEX12}/../mcp_token`, "'..'"); // traversal segment
  guardRejects(`${PREFIX}/mcp_token`, "unexpected shape"); // no instance dir
  guardRejects(`${PREFIX}/project_instance_${HEX12}/other`, "unexpected shape"); // wrong filename
  guardRejects(`${PREFIX}/project_instance_XYZdef012345/mcp_token`, "unexpected shape"); // non-hex segment
  guardRejects(`${PREFIX}/project_instance_0123456789a/mcp_token`, "unexpected shape"); // 11-hex (too short)
  guardRejects(`${PREFIX}/project_instance_0123456789abc/mcp_token`, "unexpected shape"); // 13-hex (too long)
  console.log("  PASS: structural guard accepts the published shape and rejects malformed paths");

  // ── 2. readToken via the registry ──────────────────────────────────
  if (REDIRECT) {
    const okProject = "/__godot_mcp_unit_test__/tokpath-ok";
    const tokenFile = makeTokenFile("tokpath-ok", "  registry-token\n");
    writeRegistry({ [normalizePath(okProject)]: makeEntry({ token_path: tokenFile }) });
    assert.equal(await readToken(okProject), "registry-token", "reads + trims the published token");
    // Re-read every call (no caching): a rotated file is picked up.
    writeFileSync(tokenFile, "rotated-registry\n");
    assert.equal(await readToken(okProject), "rotated-registry", "re-reads the rotated token");
    // Missing file → loud AUTH_FAILED naming the published path.
    rmSync(tokenFile, { force: true });
    await assert.rejects(
      () => readToken(okProject),
      (err: unknown) => err instanceof BridgeError && err.code === "AUTH_FAILED" && err.message.includes(tokenFile),
      "missing token file → AUTH_FAILED with the path",
    );

    // A published path that fails the structural guard surfaces through readToken.
    const badProject = "/__godot_mcp_unit_test__/tokpath-badshape";
    writeRegistry({ [normalizePath(badProject)]: makeEntry({ token_path: join(tmpDir, "nope", "mcp_token") }) });
    await assert.rejects(
      () => readToken(badProject),
      (err: unknown) =>
        err instanceof BridgeError && err.code === "AUTH_FAILED" && err.message.includes("unexpected shape"),
      "malformed published path → AUTH_FAILED (guard wired into readToken)",
    );

    // Empty token_path → loud AUTH_FAILED.
    const emptyProject = "/__godot_mcp_unit_test__/tokpath-empty";
    writeRegistry({ [normalizePath(emptyProject)]: makeEntry({ token_path: "" }) });
    await assert.rejects(
      () => readToken(emptyProject),
      (err: unknown) =>
        err instanceof BridgeError && err.code === "AUTH_FAILED" && err.message.includes("no token path"),
      "empty token_path → AUTH_FAILED",
    );

    // Absent entry → loud AUTH_FAILED.
    const absentProject = "/__godot_mcp_unit_test__/tokpath-absent";
    writeRegistry({});
    await assert.rejects(
      () => readToken(absentProject),
      (err: unknown) =>
        err instanceof BridgeError && err.code === "AUTH_FAILED" && err.message.includes("no registry entry"),
      "absent entry → AUTH_FAILED",
    );
    console.log("  PASS: readToken reads a conforming published path and fails loud on every gap");
  } else {
    console.log("  SKIP (darwin: no registry path override): readToken registry cases");
  }

  // ── 3. readToken via the GODOT_MCP_TOKEN_PATH operator override ─────
  {
    const restore = snapshotEnv();
    const dir = mkdtempSync(join(tmpdir(), "tokpath-env-"));
    // A non-conforming filename on purpose: the override bypasses the suffix check.
    const overrideFile = join(dir, "mcp_token");
    try {
      process.env.GODOT_MCP_TOKEN_PATH = overrideFile;
      writeFileSync(overrideFile, "  override-abc\n");
      assert.equal(await readToken(), "override-abc", "override reads + trims");
      writeFileSync(overrideFile, "override-rotated\n");
      assert.equal(await readToken(), "override-rotated", "override re-reads every call");
      // Missing override file → loud AUTH_FAILED with the path.
      rmSync(overrideFile, { force: true });
      await assert.rejects(
        () => readToken(),
        (err: unknown) =>
          err instanceof BridgeError && err.code === "AUTH_FAILED" && err.message.includes(overrideFile),
        "missing override → AUTH_FAILED with the path",
      );
      // Relative override → loud AUTH_FAILED (must be absolute).
      process.env.GODOT_MCP_TOKEN_PATH = "relative/mcp_token";
      await assert.rejects(
        () => readToken(),
        (err: unknown) => err instanceof BridgeError && err.code === "AUTH_FAILED" && err.message.includes("absolute"),
        "relative override → AUTH_FAILED",
      );
      console.log("  PASS: the operator override reads directly, re-reads, and rejects relative/missing");
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log("All tokenPath tests passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

/**
 * Unit tests for token_path.ts — the C-TOKEN leaf carved out of bridge.ts (C0).
 * Pins the §10.1 token-LOCATION contract so the extraction stays byte-equivalent:
 * the env short-circuits, resolveProjectName precedence + config/name regex, the
 * per-OS path switch, the project_instance_<hash> SHA-256 recipe (lowercased on
 * win32/darwin), and readToken's re-read-every-call + AUTH_FAILED-with-path throw.
 *
 * Each assertion is genuinely derived (concrete paths / an independently
 * re-computed hash) — never a fn===fn tautology.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { snapshotEnv } from "./helpers.js";
import { readToken, resolveTokenPath, resolveProjectName } from "../../src/token_path.js";
import { BridgeError } from "../../src/errors.js";

/** Independent re-derivation of the per-instance hash (mirrors token_path.ts). */
function deriveHash(projectPath: string): string {
  let canonical = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (process.platform === "win32" || process.platform === "darwin") canonical = canonical.toLowerCase();
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

/** Independent re-derivation of the full token path (mirrors token_path.ts). */
function deriveTokenPath(projectPath: string, projectName: string): string {
  const instanceDir = join("addons", "godot_mcp_toolkit", `project_instance_${deriveHash(projectPath)}`);
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

// ── 1. GODOT_MCP_TOKEN_PATH short-circuit (skips the per-OS switch) ───
{
  const restore = snapshotEnv();
  try {
    const explicit = join(tmpdir(), "explicit", "mcp_token");
    process.env.GODOT_MCP_TOKEN_PATH = explicit;
    // Even with a projectPath that would otherwise drive the per-OS switch,
    // the env value wins verbatim.
    assert.equal(await resolveTokenPath("/some/other/project"), explicit);
  } finally {
    restore();
  }
}

// ── 2. GODOT_MCP_PROJECT_NAME short-circuit (precedence rung 1) ───────
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_PROJECT_NAME = "EnvWins";
    // Env beats a project.godot on disk: write one with a different name and
    // confirm the env value still comes back.
    const dir = mkdtempSync(join(tmpdir(), "tokpath-name-"));
    try {
      writeFileSync(join(dir, "project.godot"), 'config/name="FromFile"\n');
      assert.equal(await resolveProjectName(dir), "EnvWins");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    restore();
  }
}

// ── 3. resolveProjectName precedence + config/name regex ─────────────
{
  const restore = snapshotEnv();
  try {
    delete process.env.GODOT_MCP_PROJECT_NAME;
    const dir = mkdtempSync(join(tmpdir(), "tokpath-cfg-"));
    try {
      // A realistic project.godot stanza — the regex must pull "Foo Bar".
      writeFileSync(
        join(dir, "project.godot"),
        '; Engine configuration file.\n[application]\nconfig/name="Foo Bar"\nrun/main_scene="res://Main.tscn"\n',
      );
      assert.equal(await resolveProjectName(dir), "Foo Bar");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // No file at projectPath and none in cwd (the server repo root has no
    // project.godot) → the "[unnamed project]" fallback.
    const empty = mkdtempSync(join(tmpdir(), "tokpath-empty-"));
    try {
      assert.equal(await resolveProjectName(empty), "[unnamed project]");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    restore();
  }
}

// ── 4. Per-OS path switch (root + tail), env cleared ─────────────────
{
  const restore = snapshotEnv();
  try {
    delete process.env.GODOT_MCP_TOKEN_PATH;
    process.env.GODOT_MCP_PROJECT_NAME = "SwitchProj";
    const projectPath = join(tmpdir(), "switch", "project");
    const got = await resolveTokenPath(projectPath);
    // Independently reconstructed full path for the current platform.
    assert.equal(got, deriveTokenPath(projectPath, "SwitchProj"));
    // And it carries the platform-correct root + the contract tail.
    const root =
      process.platform === "win32"
        ? join("Godot", "app_userdata")
        : process.platform === "darwin"
          ? join("Application Support", "Godot", "app_userdata")
          : join(".local", "share", "godot", "app_userdata");
    assert.ok(got.includes(root), `expected platform root ${root} in ${got}`);
    assert.ok(
      got.endsWith(join("addons", "godot_mcp_toolkit", `project_instance_${deriveHash(projectPath)}`, "mcp_token")),
    );
  } finally {
    restore();
  }
}

// ── 5. project_instance_<hash> SHA-256 recipe + win32/darwin lowercase ─
{
  const restore = snapshotEnv();
  try {
    delete process.env.GODOT_MCP_TOKEN_PATH;
    process.env.GODOT_MCP_PROJECT_NAME = "HashProj";
    // A mixed-case path with a trailing slash + backslashes — exercises the
    // canonicalization (slash-normalize, trailing-slash strip) and the
    // win32/darwin lowercasing branch.
    const projectPath = "C:\\Users\\Dev\\MixedCase\\Project\\";
    const expectedHash = deriveHash(projectPath);
    const got = await resolveTokenPath(projectPath);
    assert.ok(got.includes(`project_instance_${expectedHash}`), `expected hash ${expectedHash} in ${got}`);
    // On win32/darwin the lowercased canonical yields a DIFFERENT hash than the
    // raw mixed-case input — proves the lowercasing branch actually fired.
    if (process.platform === "win32" || process.platform === "darwin") {
      const rawHash = createHash("sha256").update("C:/Users/Dev/MixedCase/Project").digest("hex").slice(0, 12);
      assert.notEqual(expectedHash, rawHash, "lowercasing branch must change the hash");
    }
  } finally {
    restore();
  }
}

// ── 6. readToken re-reads every call + throws AUTH_FAILED with the path ─
{
  const restore = snapshotEnv();
  try {
    const dir = mkdtempSync(join(tmpdir(), "tokpath-read-"));
    const tokenFile = join(dir, "mcp_token");
    try {
      process.env.GODOT_MCP_TOKEN_PATH = tokenFile;
      // Trims surrounding whitespace/newline.
      writeFileSync(tokenFile, "  secret-abc\n");
      assert.equal(await readToken(), "secret-abc");
      // Re-read every call (no caching): a rotated file is picked up.
      writeFileSync(tokenFile, "rotated-xyz\n");
      assert.equal(await readToken(), "rotated-xyz");
      // Missing file → BridgeError("AUTH_FAILED", …) with the path in the message.
      rmSync(tokenFile, { force: true });
      await assert.rejects(
        () => readToken(),
        (err: unknown) => err instanceof BridgeError && err.code === "AUTH_FAILED" && err.message.includes(tokenFile),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    restore();
  }
}

console.log("All 6 token_path tests passed.");

// scripts/inject-fixture-addon.mjs
// Inject the toolkit addon into the C# fixture so a mono editor launched against
// test/fixtures/csharp-project/ has the MCP toolkit active (WS server on 6550).
//   • Local  : dir junction/symlink to the sibling toolkit repo (live, current).
//   • CI (env.CI): recursive copy from the checked-out sibling (ephemeral).
// The injected addon is gitignored, so it can never be committed. Idempotent.
//
// Prompt-free: run via `npm run fixture:inject-addon` (plain node, never npx).
// Env:
//   TOOLKIT_ADDON_SRC  override the toolkit addons/godot_mcp_toolkit source path.
import { existsSync, rmSync, cpSync, symlinkSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const dest = resolve(repoRoot, "test/fixtures/csharp-project/addons/godot_mcp_toolkit");
const src = process.env.TOOLKIT_ADDON_SRC
  ? resolve(process.env.TOOLKIT_ADDON_SRC)
  : resolve(repoRoot, "../godot-mcp-toolkit/addons/godot_mcp_toolkit");

if (!existsSync(src)) {
  console.error(
    `[inject-addon] toolkit addon source not found: ${src}\n` +
      `Set TOOLKIT_ADDON_SRC to the toolkit repo's addons/godot_mcp_toolkit path.`,
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });

if (process.env.CI) {
  cpSync(src, dest, { recursive: true });
  console.log(`[inject-addon] CI: copied addon -> ${dest}`);
} else {
  const type = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(src, dest, type);
  console.log(`[inject-addon] local: ${type} ${dest} -> ${src}`);
}

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT } from "../helpers.js";

export async function testExtensibility(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── extensions.list endpoint ────────────────────────────────────────
  // The extensions.list command should always be registered (the
  // extension_loader always registers it). With no third-party extensions
  // discovered, it returns an empty list.
  const extResult = (await bridge.call("extensions.list", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    commands?: {
      method: string;
      description?: string;
      input_schema?: Record<string, unknown>;
      annotations?: Record<string, boolean>;
      group?: { name: string; description?: string };
    }[];
  };
  if (!extResult?.success) {
    fail(`extensions.list: expected success, got ${JSON.stringify(extResult)}`);
  } else if (!Array.isArray(extResult.commands)) {
    fail(`extensions.list: expected commands array, got ${JSON.stringify(extResult)}`);
  } else {
    pass(`extensions.list -> ${extResult.commands.length} extension(s)`);
  }

  // ── extensions.refresh (hot-reload trigger) ─────────────────────────
  // The extensions.refresh method forces a filesystem scan for extension manifests.
  // Even with no extensions installed, it should succeed.
  // (MCP tool name is "extensions_refresh"; Godot method is "extensions.refresh")
  const refreshResult = (await bridge.call("extensions.refresh", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    commands?: unknown[];
    code?: string;
  };
  if (refreshResult?.success === true) {
    pass(
      `extensions.refresh -> success (${Array.isArray(refreshResult.commands) ? refreshResult.commands.length : 0} commands found)`,
    );
  } else if (refreshResult?.code) {
    // May fail if the toolkit doesn't support extensions.refresh yet — acceptable.
    pass(`extensions.refresh -> ${refreshResult.code} (older plugin — acceptable)`);
  } else {
    fail(`extensions.refresh: unexpected response ${JSON.stringify(refreshResult)}`);
  }

  // ── Reserved namespace rejection ─────────────────────────────────────
  // Verify that the extensions endpoint doesn't list any commands under
  // reserved namespaces (the loader rejects these at load time).
  if (extResult?.success && Array.isArray(extResult.commands)) {
    const reserved = [
      "scene.",
      "script.",
      "editor.",
      "node.",
      "runtime.",
      "server.",
      "resource.",
      "folder.",
      "file.",
      "signal.",
      "playtest.",
      "project.",
      "input_map.",
      "animation.",
      "tilemap.",
      "asset.",
      "save.",
      "meta.",
      "game.",
      "diff.",
      "autoload.",
      "extensions.",
    ];
    const violations = extResult.commands.filter((c) => reserved.some((r) => c.method.startsWith(r)));
    if (violations.length > 0) {
      fail(`reserved namespace leak: ${violations.map((v) => v.method).join(", ")}`);
    } else {
      pass("no reserved-namespace extensions leaked");
    }
  }
}

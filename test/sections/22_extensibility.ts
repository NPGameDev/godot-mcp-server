import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT } from "../helpers.js";

export async function testExtensibility(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── meta.user_commands endpoint ──────────────────────────────────────
  // The meta.user_commands command should always be registered (the
  // user_commands_loader always registers it). With no user .gd files in
  // the user_commands/ folder, it returns an empty list.
  const ucResult = (await bridge.call("meta.user_commands", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    commands?: { method: string }[];
  };
  if (!ucResult?.success) {
    fail(`meta.user_commands: expected success, got ${JSON.stringify(ucResult)}`);
  } else if (!Array.isArray(ucResult.commands)) {
    fail(`meta.user_commands: expected commands array, got ${JSON.stringify(ucResult)}`);
  } else {
    pass(`meta.user_commands -> ${ucResult.commands.length} user command(s)`);
  }

  // ── Reserved namespace rejection ─────────────────────────────────────
  // Attempt to register a command under a reserved namespace via the
  // bridge should not succeed (the loader rejects reserved prefixes at
  // load time). We can't easily test this via smoke without a sample .gd
  // in the user_commands folder, so we verify that the meta endpoint
  // doesn't list any reserved-namespace commands.
  if (ucResult?.success && Array.isArray(ucResult.commands)) {
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
    ];
    const violations = ucResult.commands.filter((c) => reserved.some((r) => c.method.startsWith(r)));
    if (violations.length > 0) {
      fail(`reserved namespace leak: ${violations.map((v) => v.method).join(", ")}`);
    } else {
      pass("no reserved-namespace user commands leaked");
    }
  }
}

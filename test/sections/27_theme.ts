import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export async function testTheme(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── theme.edit happy path ──
  const themePath = "res://mcp_smoke_theme_26.tres";
  const themeResult = (await bridge.call(
    "theme.edit",
    {
      file_path: themePath,
      edits: [
        { type_name: "Button", property_type: "color", property_name: "font_color", value: { r: 1, g: 0, b: 0, a: 1 } },
        { type_name: "Label", property_type: "font_size", property_name: "font_size", value: 24 },
        {
          type_name: "Panel",
          property_type: "stylebox",
          property_name: "panel",
          value: {
            type: "StyleBoxFlat",
            bg_color: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
            corner_radius: 4,
          },
        },
      ],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; path?: string; edits_applied?: number; code?: string };
  if (themeResult?.success === true && themeResult.edits_applied === 3) {
    pass(`theme.edit happy -> edits_applied=${themeResult.edits_applied} path=${themeResult.path}`);
  } else {
    fail(`theme.edit happy: ${JSON.stringify(themeResult)}`);
  }

  // ── guard: invalid property_type ──
  assertGuard(
    ctx,
    "theme.edit invalid property_type",
    await bridge.call(
      "theme.edit",
      {
        file_path: themePath,
        edits: [{ type_name: "Button", property_type: "invalid_type", property_name: "x", value: 1 }],
      },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
    ["invalid_type", "property_type"],
  );

  // ── cleanup ──
  try {
    await bridge.call("file.delete", { file_path: themePath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}

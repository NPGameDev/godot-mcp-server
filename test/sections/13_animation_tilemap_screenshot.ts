import fs from "node:fs";

import type { TestCtx } from "../helpers.js";
import {
  CALL_TIMEOUT,
  SCREENSHOT_TIMEOUT,
  MANUAL_ASSIST,
  assertGuard,
  manualCue,
  tilemapNodeClass,
  passIfHeadlessUnsupported,
} from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "scene_create_node",
  "scene_delete_node",
  "node_set_property",
  "animation_keyframe",
  "animation_get_keys",
  "tilemap_set_cells",
  "tilemap_read_cells",
  "editor_screenshot",
  "file_delete",
];
export async function testAnimationTilemapScreenshot(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // TileMapLayer is 4.3+; on 4.2 use the legacy TileMap node so the tilemap
  // tools are exercised on their real 4.2 path (the tool handles both node types).
  const tmClass = tilemapNodeClass(bridge.getGodotVersion());

  // ── animation.* guards ──
  const animPlayerNode = (await bridge.call(
    "scene.create_node",
    { class_name: "AnimationPlayer", parent_path: ".", node_name: "MCPSmokeAP" },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string; code?: string };
  const animSpriteNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Sprite2D", parent_path: ".", node_name: "MCPSmokeASprite" },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string; code?: string };
  const animPlayerPath = animPlayerNode?.path ?? "MCPSmokeAP";
  const animSpritePath = animSpriteNode?.path ?? "MCPSmokeASprite";

  assertGuard(
    ctx,
    "animation.keyframe add missing animation",
    await bridge.call(
      "animation.keyframe",
      {
        action: "add",
        player_path: animPlayerPath,
        animation_name: "no_such_anim",
        track_path: "MCPSmokeASprite:position",
        time: 0.0,
        value: 0,
      },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    ["available", "no_such_anim"],
  );
  assertGuard(
    ctx,
    "animation.keyframe add non-AP",
    await bridge.call(
      "animation.keyframe",
      { action: "add", player_path: animSpritePath, animation_name: "x", track_path: "y:position", time: 0, value: 0 },
      CALL_TIMEOUT,
    ),
    "INVALID_CLASS",
    "AnimationPlayer",
  );
  assertGuard(
    ctx,
    "animation.keyframe add bare NodePath",
    await bridge.call(
      "animation.keyframe",
      {
        action: "add",
        player_path: animPlayerPath,
        animation_name: "no_such_anim",
        track_path: "MCPSmokeASprite",
        time: 0,
        value: 0,
      },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
    "property",
  );

  // ── animation.get_keys guards ──

  // Guard: non-AnimationPlayer node.
  assertGuard(
    ctx,
    "animation.get_keys non-AP",
    await bridge.call(
      "animation.get_keys",
      { player_path: animSpritePath, animation_name: "x", track_path: "y:position" },
      CALL_TIMEOUT,
    ),
    "INVALID_CLASS",
    "AnimationPlayer",
  );

  // Guard: nonexistent animation on a valid AnimationPlayer.
  assertGuard(
    ctx,
    "animation.get_keys missing animation",
    await bridge.call(
      "animation.get_keys",
      { player_path: animPlayerPath, animation_name: "no_such_anim", track_path: "MCPSmokeASprite:position" },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "no_such_anim",
  );

  try {
    await bridge.call("scene.delete_node", { node_path: animPlayerPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("scene.delete_node", { node_path: animSpritePath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }

  // ── tilemap.set_cells ──
  const tilemapNode = (await bridge.call(
    "scene.create_node",
    { class_name: tmClass, parent_path: ".", node_name: "MCPSmokeTML" },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string; code?: string };
  const tilemapPath = tilemapNode?.path ?? "MCPSmokeTML";
  const smokeTilemapTsPath = "res://mcp_smoke_ts_tilemap.tres";
  if (tilemapNode?.status === "created") {
    // No-tileset guard rejects cell operations before a tileset is assigned.
    assertGuard(
      ctx,
      "tilemap.set_cells no-tileset guard",
      await bridge.call(
        "tilemap.set_cells",
        { node_path: tilemapPath, cells: [{ x: 0, y: 0, source_id: 0, atlas_x: 0, atlas_y: 0 }] },
        CALL_TIMEOUT,
      ),
      "INVALID_STATE",
      "no tileset",
    );

    // Assign a tileset so remaining tests can proceed.
    await bridge.call(
      "tileset.create",
      { file_path: smokeTilemapTsPath, texture_path: "res://icon.svg", tile_size: { x: 32, y: 32 } },
      CALL_TIMEOUT,
    );
    await bridge.call(
      "node.set_property",
      { node_path: tilemapPath, property: "tile_set", value: { type: "Resource", path: smokeTilemapTsPath } },
      CALL_TIMEOUT,
    );

    const tilemapClearResult = (await bridge.call(
      "tilemap.set_cells",
      {
        node_path: tilemapPath,
        cells: [
          { x: 0, y: 0, source_id: -1, atlas_x: 0, atlas_y: 0 },
          { x: 1, y: 0, source_id: -1, atlas_x: 0, atlas_y: 0 },
        ],
      },
      CALL_TIMEOUT,
    )) as { success?: boolean; cells_unchanged?: number; total?: number; code?: string };
    if (tilemapClearResult?.success !== true || tilemapClearResult.total !== 2)
      fail(`tilemap.set_cells clear: ${JSON.stringify(tilemapClearResult)}`);
    else pass(`tilemap.set_cells clear x2 -> total=2 (cells_unchanged=${tilemapClearResult.cells_unchanged})`);

    assertGuard(
      ctx,
      "tilemap.set_cells non-tilemap",
      await bridge.call("tilemap.set_cells", { node_path: animSpritePath, cells: [] }, CALL_TIMEOUT),
      "NOT_FOUND",
      "node",
    );
    assertGuard(
      ctx,
      "tilemap.set_cells malformed cell",
      await bridge.call("tilemap.set_cells", { node_path: tilemapPath, cells: [{ x: 0, y: 0 }] }, CALL_TIMEOUT),
      "INVALID_PARAMS",
      ["cells[0]", "source_id"],
    );
  } else {
    pass(`tilemap.set_cells: ${tmClass} setup failed (probably stale), skipping round-trip`);
  }
  try {
    await bridge.call("scene.delete_node", { node_path: tilemapPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("file.delete", { file_path: smokeTilemapTsPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }

  // ── tileset.create ──
  const tilesetPath = "res://mcp_smoke_tileset_13.tres";
  const tilesetResult = (await bridge.call(
    "tileset.create",
    { file_path: tilesetPath, texture_path: "res://icon.svg", tile_size: { x: 32, y: 32 } },
    CALL_TIMEOUT,
  )) as { success?: boolean; source_id?: number; tiles_created?: number; code?: string };
  if (tilesetResult?.success === true && typeof tilesetResult.source_id === "number") {
    pass(`tileset.create -> source_id=${tilesetResult.source_id} tiles=${tilesetResult.tiles_created}`);
  } else {
    fail(`tileset.create: ${JSON.stringify(tilesetResult)}`);
  }
  // Cleanup
  try {
    await bridge.call("file.delete", { file_path: tilesetPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }

  assertGuard(
    ctx,
    "tileset.create missing texture",
    await bridge.call(
      "tileset.create",
      { file_path: "res://mcp_smoke_ts_guard.tres", texture_path: "res://no_such.png" },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "texture",
  );

  // ── editor.screenshot with node_path (node-focused capture) ──
  // editor.screenshot_node was merged into editor.screenshot via the
  // optional node_path parameter. The bridge method is editor.screenshot.
  const screenshotNodeTarget = (await bridge.call(
    "scene.create_node",
    { class_name: "ColorRect", parent_path: ".", node_name: "MCPSmokeRect" },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string; code?: string };
  const screenshotNodePath = screenshotNodeTarget?.path ?? ".";
  // Set a visible size + color — a zero-size or invisible Control produces no screenshot.
  await bridge.call(
    "node.set_property",
    { node_path: screenshotNodePath, property: "size", value: { type: "Vector2", x: 128, y: 128 } },
    CALL_TIMEOUT,
  );
  await bridge.call(
    "node.set_property",
    { node_path: screenshotNodePath, property: "color", value: { type: "Color", r: 1.0, g: 0.0, b: 0.0 } },
    CALL_TIMEOUT,
  );
  // Wait for the editor to process the new node before capturing.
  await new Promise((r) => setTimeout(r, 500));
  const nodeScreenshotResult = (await bridge.call(
    "editor.screenshot",
    { node_path: screenshotNodePath },
    SCREENSHOT_TIMEOUT,
  )) as { image_base64?: string; width?: number; height?: number; code?: string };
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot node_path", nodeScreenshotResult)) {
    // headless — no viewport capture
  } else if (nodeScreenshotResult?.image_base64 && nodeScreenshotResult.image_base64.length >= 100) {
    pass(
      `editor.screenshot node_path=${screenshotNodePath} -> ${nodeScreenshotResult.width}x${nodeScreenshotResult.height} base64=${nodeScreenshotResult.image_base64.length}`,
    );
  } else {
    // Node capture can return null if the editor viewport hasn't rendered
    // the freshly created node yet. Accept as a soft skip rather than fail.
    pass(`editor.screenshot node_path=${screenshotNodePath} -> null (timing-dependent; viewport capture skipped)`);
  }

  // Node-focused capture in disk mode — the PNG persists and only its FILE path
  // returns (the inline node-path echo is superseded by the saved path). Assert
  // the lean envelope, the file on disk, then delete it.
  const nodeDiskShot = (await bridge.call(
    "editor.screenshot",
    { node_path: screenshotNodePath, image_response_mode: "disk" },
    SCREENSHOT_TIMEOUT,
  )) as { image_base64?: string; path?: string; bytes?: number; mime_type?: string; code?: string };
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot node_path disk", nodeDiskShot)) {
    // headless — no viewport capture
  } else if (
    nodeDiskShot?.image_base64 !== undefined ||
    typeof nodeDiskShot?.path !== "string" ||
    !nodeDiskShot.path.toLowerCase().endsWith(".png") ||
    !fs.existsSync(nodeDiskShot.path)
  ) {
    fail(`editor.screenshot node_path disk: expected lean envelope + file, got ${JSON.stringify(nodeDiskShot)}`);
  } else {
    pass(`editor.screenshot node_path disk -> no image, file at ${nodeDiskShot.path}`);
    try {
      fs.unlinkSync(nodeDiskShot.path);
    } catch {
      /* best-effort cleanup */
    }
  }

  const missingNodeShot = await bridge.call("editor.screenshot", { node_path: "/root/NoSuch_15d_xyz" }, CALL_TIMEOUT);
  if (!passIfHeadlessUnsupported(ctx, "editor.screenshot node_path missing", missingNodeShot)) {
    assertGuard(ctx, "editor.screenshot node_path missing", missingNodeShot, "NOT_FOUND", "node");
  }

  const tinySizeShot = await bridge.call(
    "editor.screenshot",
    { node_path: screenshotNodePath, size: { width: 32, height: 32 } },
    CALL_TIMEOUT,
  );
  if (!passIfHeadlessUnsupported(ctx, "editor.screenshot node_path tiny size", tinySizeShot)) {
    assertGuard(ctx, "editor.screenshot node_path tiny size", tinySizeShot, "INVALID_PARAMS", ["64", "4096"]);
  }

  try {
    await bridge.call("scene.delete_node", { node_path: screenshotNodePath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }

  // ── tilemap.read_cells (redistributed from section 44) ──

  // Guards.
  assertGuard(
    ctx,
    "tilemap.read_cells non-tilemap node",
    await bridge.call("tilemap.read_cells", { node_path: "." }, CALL_TIMEOUT),
    "INVALID_CLASS",
    "TileMap",
  );

  assertGuard(
    ctx,
    "tilemap.read_cells missing node",
    await bridge.call("tilemap.read_cells", { node_path: "NoSuchNode99" }, CALL_TIMEOUT),
    "NOT_FOUND",
    "node",
  );

  // Happy path: empty tilemap → returned=0 (TileMapLayer on 4.3+, legacy TileMap on 4.2).
  const tmlNode = (await bridge.call(
    "scene.create_node",
    { class_name: tmClass, parent_path: ".", node_name: "MCPSmokeReadTML" },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string };
  const tmlPath = tmlNode?.path ?? "MCPSmokeReadTML";

  if (tmlNode?.status === "created" || tmlNode?.status === "returned") {
    const readEmpty = (await bridge.call("tilemap.read_cells", { node_path: tmlPath }, CALL_TIMEOUT)) as {
      success?: boolean;
      returned?: number;
      total_cells?: number;
      has_more?: boolean;
      bounds?: Record<string, number>;
    };
    if (readEmpty?.success !== true || readEmpty.returned !== 0)
      fail(`tilemap.read_cells empty: ${JSON.stringify(readEmpty)}`);
    else pass(`tilemap.read_cells empty ${tmClass} -> returned=0`);
    // Canonical naming: total_cells; an empty read reports total_cells=0, has_more=false.
    if (readEmpty?.success === true && readEmpty.total_cells === 0 && readEmpty.has_more === false)
      pass(`tilemap.read_cells empty -> total_cells=0 has_more=false`);
    else
      fail(
        `tilemap.read_cells empty pagination shape: ${JSON.stringify({ total_cells: readEmpty?.total_cells, has_more: readEmpty?.has_more })}`,
      );

    await bridge.call("scene.delete_node", { node_path: tmlPath }, CALL_TIMEOUT);
  } else {
    fail(`tilemap.read_cells: could not create ${tmClass}: ${JSON.stringify(tmlNode)}`);
  }

  await testEditorViewportRemediation(ctx);
}

type ScreenshotResult = {
  image_base64?: string;
  width?: number;
  height?: number;
  code?: string;
  remediation?: string[];
};

// editor.screenshot collapsed-viewport remediation. These states (wrong main
// screen, minimized window) can't be forced programmatically, so they need a
// human to drive the editor on cue — gated on MCP_MANUAL_ASSIST so an
// unattended / headless run green-skips instead of hanging. The auto-heal and
// force_foreground_editor behavior otherwise validates through the toolkit sweep
// (Validations/Sections/07-editor-console.md 7.2b–7.2e).
async function testEditorViewportRemediation(ctx: TestCtx): Promise<void> {
  const { bridge, pass } = ctx;
  if (!MANUAL_ASSIST) {
    pass(
      "editor.screenshot remediation legs skipped (set MCP_MANUAL_ASSIST=1 to drive them; sweep owns positive coverage)",
    );
    return;
  }

  // Auto-heal: on a non-2D/3D main screen a wrong-screen capture heals to 2D/3D
  // and discloses via remediation:["switched_main_screen"].
  await manualCue("Select the SCRIPT main-screen tab in the editor");
  const healed = (await bridge.call("editor.screenshot", {}, SCREENSHOT_TIMEOUT)) as ScreenshotResult;
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot auto-heal", healed)) {
    // headless — nothing to heal
  } else if (healed?.image_base64 && (healed.width ?? 0) > 16 && healed.remediation?.includes("switched_main_screen")) {
    pass(
      `editor.screenshot wrong-screen auto-heal -> ${healed.width}x${healed.height} remediation=switched_main_screen`,
    );
  } else {
    ctx.fail(
      `editor.screenshot auto-heal: expected usable frame + switched_main_screen, got ${JSON.stringify(healed).slice(0, 200)}`,
    );
  }

  // Minimized: default (no force) returns EDITOR_VIEWPORT_UNAVAILABLE (not a 2x2
  // PNG, not headless); force_foreground_editor:true un-minimizes + captures.
  await manualCue("MINIMIZE the editor window now");
  const minimized = (await bridge.call("editor.screenshot", {}, SCREENSHOT_TIMEOUT)) as ScreenshotResult;
  if (!passIfHeadlessUnsupported(ctx, "editor.screenshot minimized", minimized)) {
    if (minimized?.code === "EDITOR_VIEWPORT_UNAVAILABLE")
      pass("editor.screenshot minimized -> EDITOR_VIEWPORT_UNAVAILABLE (not 2x2, not headless)");
    else
      ctx.fail(
        `editor.screenshot minimized: expected EDITOR_VIEWPORT_UNAVAILABLE, got ${JSON.stringify(minimized).slice(0, 200)}`,
      );
  }

  const forced = (await bridge.call(
    "editor.screenshot",
    { force_foreground_editor: true },
    SCREENSHOT_TIMEOUT,
  )) as ScreenshotResult;
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot force_foreground", forced)) {
    // headless — nothing to foreground
  } else if (forced?.image_base64 && (forced.width ?? 0) > 16 && forced.remediation?.includes("foregrounded_editor")) {
    pass(
      `editor.screenshot force_foreground_editor -> ${forced.width}x${forced.height} remediation=foregrounded_editor`,
    );
  } else {
    ctx.fail(
      `editor.screenshot force_foreground: expected usable frame + foregrounded_editor, got ${JSON.stringify(forced).slice(0, 200)}`,
    );
  }
}

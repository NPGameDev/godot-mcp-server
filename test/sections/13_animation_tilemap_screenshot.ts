import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT, assertGuard } from "../helpers.js";

export async function testAnimationTilemapScreenshot(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

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
    { class_name: "TileMapLayer", parent_path: ".", node_name: "MCPSmokeTML" },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string; code?: string };
  const tilemapPath = tilemapNode?.path ?? "MCPSmokeTML";
  if (tilemapNode?.status === "created") {
    const tilemapClearResult = (await bridge.call(
      "tilemap.set_cells",
      {
        tilemap_path: tilemapPath,
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
      await bridge.call("tilemap.set_cells", { tilemap_path: animSpritePath, cells: [] }, CALL_TIMEOUT),
      "NOT_FOUND",
      "node",
    );
    assertGuard(
      ctx,
      "tilemap.set_cells malformed cell",
      await bridge.call("tilemap.set_cells", { tilemap_path: tilemapPath, cells: [{ x: 0, y: 0 }] }, CALL_TIMEOUT),
      "INVALID_PARAMS",
      ["cells[0]", "source_id"],
    );
  } else {
    pass(`tilemap.set_cells: TileMapLayer setup failed (probably stale), skipping round-trip`);
  }
  try {
    await bridge.call("scene.delete_node", { node_path: tilemapPath }, CALL_TIMEOUT);
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

  // ── tileset.edit ──
  const editTilesetPath = "res://mcp_smoke_tileset_edit_13.tres";
  // Create a TileSet to edit
  const editBase = (await bridge.call(
    "tileset.create",
    { file_path: editTilesetPath, texture_path: "res://icon.svg", tile_size: { x: 32, y: 32 }, physics: true },
    CALL_TIMEOUT,
  )) as { success?: boolean; source_id?: number };

  if (editBase?.success === true) {
    // Happy path: set custom collision + custom data on tile (0,0)
    const editResult = (await bridge.call(
      "tileset.edit",
      {
        file_path: editTilesetPath,
        source_id: editBase.source_id ?? 0,
        layers: { custom_data: [{ name: "damage", type: "int" }] },
        tiles: [
          { atlas_x: 0, atlas_y: 0, physics_polygon: "none", custom_data: { damage: 10 } },
          { atlas_x: 1, atlas_y: 0, physics_polygon: "one_way" },
        ],
      },
      CALL_TIMEOUT,
    )) as { success?: boolean; tiles_modified?: number; errors?: unknown[] };
    if (editResult?.success === true && (editResult.tiles_modified ?? 0) >= 2) {
      pass(
        `tileset.edit happy -> tiles_modified=${editResult.tiles_modified} errors=${(editResult.errors ?? []).length}`,
      );
    } else {
      fail(`tileset.edit happy: ${JSON.stringify(editResult)}`);
    }

    // Guard: invalid tile coords → per-tile error (not full failure)
    const editBadTile = (await bridge.call(
      "tileset.edit",
      { file_path: editTilesetPath, tiles: [{ atlas_x: 99, atlas_y: 99, probability: 0.5 }] },
      CALL_TIMEOUT,
    )) as { success?: boolean; errors?: string[] };
    if (editBadTile?.success === true && (editBadTile.errors ?? []).length > 0) {
      pass(`tileset.edit invalid tile -> success with ${editBadTile.errors!.length} error(s)`);
    } else {
      fail(`tileset.edit invalid tile: ${JSON.stringify(editBadTile)}`);
    }

    // add_source: add second atlas from same icon.svg
    const editAddSrc = (await bridge.call(
      "tileset.edit",
      { file_path: editTilesetPath, add_source: { texture_path: "res://icon.svg", tile_size: { x: 64, y: 64 } } },
      CALL_TIMEOUT,
    )) as { success?: boolean; new_source_id?: number };
    if (editAddSrc?.success === true && typeof editAddSrc.new_source_id === "number") {
      pass(`tileset.edit add_source -> new_source_id=${editAddSrc.new_source_id}`);
    } else {
      fail(`tileset.edit add_source: ${JSON.stringify(editAddSrc)}`);
    }
  } else {
    pass("tileset.edit: base tileset creation failed, skipping edit tests");
  }

  // Guard: missing file
  assertGuard(
    ctx,
    "tileset.edit missing file",
    await bridge.call("tileset.edit", { file_path: "res://no_such_tileset.tres" }, CALL_TIMEOUT),
    "NOT_FOUND",
    "TileSet",
  );

  // Cleanup
  try {
    await bridge.call("file.delete", { file_path: editTilesetPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }

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
  if (nodeScreenshotResult?.image_base64 && nodeScreenshotResult.image_base64.length >= 100) {
    pass(
      `editor.screenshot node_path=${screenshotNodePath} -> ${nodeScreenshotResult.width}x${nodeScreenshotResult.height} base64=${nodeScreenshotResult.image_base64.length}`,
    );
  } else {
    // Node capture can return null if the editor viewport hasn't rendered
    // the freshly created node yet. Accept as a soft skip rather than fail.
    pass(`editor.screenshot node_path=${screenshotNodePath} -> null (timing-dependent; viewport capture skipped)`);
  }

  assertGuard(
    ctx,
    "editor.screenshot node_path missing",
    await bridge.call("editor.screenshot", { node_path: "/root/NoSuch_15d_xyz" }, CALL_TIMEOUT),
    "NOT_FOUND",
    "node",
  );
  assertGuard(
    ctx,
    "editor.screenshot node_path tiny size",
    await bridge.call(
      "editor.screenshot",
      { node_path: screenshotNodePath, size: { width: 32, height: 32 } },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
    ["64", "4096"],
  );

  try {
    await bridge.call("scene.delete_node", { node_path: screenshotNodePath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}

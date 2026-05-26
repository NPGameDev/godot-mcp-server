import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "tileset_create",
  "tileset_add_source",
  "tileset_remove_source",
  "tileset_add_alternative",
  "tileset_remove_alternative",
  "tileset_setup_layers",
  "tileset_edit_physics",
  "tileset_edit_terrain",
  "tileset_edit_navigation",
  "tileset_edit_visuals",
  "tileset_edit_custom_data",
  "file_delete",
];

export async function testTileset(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const tsPath = "res://mcp_smoke_tileset_45.tres";

  // ── tileset_create ──
  const createResult = (await bridge.call(
    "tileset.create",
    { file_path: tsPath, texture_path: "res://icon.svg", tile_size: { x: 32, y: 32 }, physics: true },
    CALL_TIMEOUT,
  )) as { success?: boolean; source_id?: number; tiles_created?: number };
  if (createResult?.success !== true) {
    fail(`tileset_create: ${JSON.stringify(createResult)}`);
    return; // can't test anything else without a tileset
  }
  pass(`tileset_create -> source_id=${createResult.source_id} tiles=${createResult.tiles_created}`);
  const srcId = createResult.source_id ?? 0;

  // ── tileset_create guard: bad texture ──
  assertGuard(
    ctx,
    "tileset_create bad texture",
    await bridge.call(
      "tileset.create",
      { file_path: "res://mcp_smoke_ts_guard.tres", texture_path: "res://no_such.png" },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "texture",
  );

  // ── tileset_setup_layers ──
  const layersResult = (await bridge.call(
    "tileset.setup_layers",
    {
      file_path: tsPath,
      terrain_sets: [{ mode: "match_corners_and_sides", terrains: ["grass", "dirt"] }],
      custom_data: [
        { name: "damage", type: "int" },
        { name: "walkable", type: "bool" },
      ],
      navigation_layers: 1,
    },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  if (layersResult?.success === true) {
    pass("tileset_setup_layers happy");
  } else {
    fail(`tileset_setup_layers: ${JSON.stringify(layersResult)}`);
  }

  // ── tileset_edit_physics ──
  const physicsResult = (await bridge.call(
    "tileset.edit_physics",
    {
      file_path: tsPath,
      source_id: srcId,
      tiles: [
        { atlas_x: 0, atlas_y: 0, physics_polygon: "none" },
        { atlas_x: 1, atlas_y: 0, physics_polygon: "one_way" },
      ],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; tiles_modified?: number; errors?: unknown[] };
  if (physicsResult?.success === true && (physicsResult.tiles_modified ?? 0) >= 2) {
    pass(`tileset_edit_physics -> tiles_modified=${physicsResult.tiles_modified}`);
  } else {
    fail(`tileset_edit_physics: ${JSON.stringify(physicsResult)}`);
  }

  // ── tileset_edit_physics guard: invalid tile ──
  const physBad = (await bridge.call(
    "tileset.edit_physics",
    { file_path: tsPath, tiles: [{ atlas_x: 99, atlas_y: 99, physics_polygon: "full" }] },
    CALL_TIMEOUT,
  )) as { success?: boolean; errors?: string[] };
  if (physBad?.success === true && (physBad.errors ?? []).length > 0) {
    pass(`tileset_edit_physics invalid tile -> ${physBad.errors!.length} error(s)`);
  } else {
    fail(`tileset_edit_physics invalid tile: ${JSON.stringify(physBad)}`);
  }

  // ── tileset_edit_terrain ──
  const terrainResult = (await bridge.call(
    "tileset.edit_terrain",
    {
      file_path: tsPath,
      source_id: srcId,
      tiles: [{ atlas_x: 0, atlas_y: 0, terrain_set: 0, terrain: 0 }],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; tiles_modified?: number };
  if (terrainResult?.success === true && (terrainResult.tiles_modified ?? 0) >= 1) {
    pass(`tileset_edit_terrain -> tiles_modified=${terrainResult.tiles_modified}`);
  } else {
    fail(`tileset_edit_terrain: ${JSON.stringify(terrainResult)}`);
  }

  // ── tileset_edit_navigation ──
  const navResult = (await bridge.call(
    "tileset.edit_navigation",
    {
      file_path: tsPath,
      source_id: srcId,
      tiles: [{ atlas_x: 0, atlas_y: 0, navigation_polygon: "full" }],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; tiles_modified?: number };
  if (navResult?.success === true && (navResult.tiles_modified ?? 0) >= 1) {
    pass(`tileset_edit_navigation -> tiles_modified=${navResult.tiles_modified}`);
  } else {
    fail(`tileset_edit_navigation: ${JSON.stringify(navResult)}`);
  }

  // ── tileset_edit_visuals ──
  const visualResult = (await bridge.call(
    "tileset.edit_visuals",
    {
      file_path: tsPath,
      source_id: srcId,
      tiles: [{ atlas_x: 1, atlas_y: 0, probability: 0.5 }],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; tiles_modified?: number };
  if (visualResult?.success === true && (visualResult.tiles_modified ?? 0) >= 1) {
    pass(`tileset_edit_visuals -> tiles_modified=${visualResult.tiles_modified}`);
  } else {
    fail(`tileset_edit_visuals: ${JSON.stringify(visualResult)}`);
  }

  // ── tileset_edit_custom_data ──
  const cdResult = (await bridge.call(
    "tileset.edit_custom_data",
    {
      file_path: tsPath,
      source_id: srcId,
      tiles: [{ atlas_x: 0, atlas_y: 0, custom_data: { damage: 10, walkable: true } }],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; tiles_modified?: number };
  if (cdResult?.success === true && (cdResult.tiles_modified ?? 0) >= 1) {
    pass(`tileset_edit_custom_data -> tiles_modified=${cdResult.tiles_modified}`);
  } else {
    fail(`tileset_edit_custom_data: ${JSON.stringify(cdResult)}`);
  }

  // ── tileset_add_source ──
  const addSrcResult = (await bridge.call(
    "tileset.add_source",
    { file_path: tsPath, texture_path: "res://icon.svg", tile_size: { x: 64, y: 64 } },
    CALL_TIMEOUT,
  )) as { success?: boolean; new_source_id?: number };
  if (addSrcResult?.success === true && typeof addSrcResult.new_source_id === "number") {
    pass(`tileset_add_source -> new_source_id=${addSrcResult.new_source_id}`);
  } else {
    fail(`tileset_add_source: ${JSON.stringify(addSrcResult)}`);
  }
  const addedSourceId = addSrcResult?.new_source_id;

  // ── tileset_remove_source ──
  if (typeof addedSourceId === "number") {
    const rmSrcResult = (await bridge.call(
      "tileset.remove_source",
      { file_path: tsPath, source_id: addedSourceId },
      CALL_TIMEOUT,
    )) as { success?: boolean; removed_source_id?: number };
    if (rmSrcResult?.success === true && rmSrcResult.removed_source_id === addedSourceId) {
      pass(`tileset_remove_source -> removed_source_id=${rmSrcResult.removed_source_id}`);
    } else {
      fail(`tileset_remove_source: ${JSON.stringify(rmSrcResult)}`);
    }
  } else {
    pass("tileset_remove_source: skipped (no source to remove)");
  }

  // ── tileset_remove_source guard: invalid source ──
  assertGuard(
    ctx,
    "tileset_remove_source invalid source",
    await bridge.call("tileset.remove_source", { file_path: tsPath, source_id: 999 }, CALL_TIMEOUT),
    "NOT_FOUND",
    "source",
  );

  // ── tileset_add_alternative ──
  const addAltResult = (await bridge.call(
    "tileset.add_alternative",
    { file_path: tsPath, source_id: srcId, atlas_x: 0, atlas_y: 0, flip_h: true },
    CALL_TIMEOUT,
  )) as { success?: boolean; tile?: { atlas_x: number; atlas_y: number } };
  if (addAltResult?.success === true) {
    pass("tileset_add_alternative happy");
  } else {
    fail(`tileset_add_alternative: ${JSON.stringify(addAltResult)}`);
  }

  // ── tileset_remove_alternative ──
  // Alternative id 1 is the first alternative (0 is the base tile)
  const rmAltResult = (await bridge.call(
    "tileset.remove_alternative",
    { file_path: tsPath, source_id: srcId, atlas_x: 0, atlas_y: 0, alternative_id: 1 },
    CALL_TIMEOUT,
  )) as { success?: boolean; removed_alternative_id?: number };
  if (rmAltResult?.success === true && rmAltResult.removed_alternative_id === 1) {
    pass(`tileset_remove_alternative -> removed_alternative_id=${rmAltResult.removed_alternative_id}`);
  } else {
    fail(`tileset_remove_alternative: ${JSON.stringify(rmAltResult)}`);
  }

  // ── tileset_remove_alternative guard: invalid alt ──
  assertGuard(
    ctx,
    "tileset_remove_alternative invalid alt",
    await bridge.call(
      "tileset.remove_alternative",
      { file_path: tsPath, source_id: srcId, atlas_x: 0, atlas_y: 0, alternative_id: 999 },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "alternative",
  );

  // ── guard: missing file (any split tool) ──
  assertGuard(
    ctx,
    "tileset_edit_physics missing file",
    await bridge.call(
      "tileset.edit_physics",
      { file_path: "res://no_such_tileset.tres", tiles: [{ atlas_x: 0, atlas_y: 0, physics_polygon: "full" }] },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "TileSet",
  );

  // ── Cleanup ──
  try {
    await bridge.call("file.delete", { file_path: tsPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}

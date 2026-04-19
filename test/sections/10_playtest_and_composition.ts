import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT, MAIN_SCENE, assertGuard, unwrapUntrusted } from "../helpers.js";

export async function testPlaytestAndComposition(ctx: TestCtx, ncmGated: boolean): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const instChildPath = "res://smoke_inst_child.tscn";
  const smokeTexPath = "res://smoke_texture.tres";

  // Orphan cleanup from previous aborted runs.
  try { await bridge.call("game.stop", {}, CALL_TIMEOUT); } catch { /* noop */ }
  for (const orphan of ["smoke_inst_child", "CellA", "Renamed", "CoercionSprite"]) {
    try { await bridge.call("scene.delete_node", { node_path: orphan }, CALL_TIMEOUT); } catch { /* noop */ }
  }
  try { await bridge.call("resource.delete", { file_path: smokeTexPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.delete", { file_path: instChildPath }, CALL_TIMEOUT); } catch { /* noop */ }
  await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);

  // ── game.start / game.stop ──
  const gameStartResult = await bridge.call("game.start", { scene_path: "current", wait_for_runtime: false }, SCREENSHOT_TIMEOUT) as { success?: boolean; target?: string; runtime_ready?: boolean; runtime_port?: number; code?: string; error?: string };
  if (gameStartResult?.success !== true || gameStartResult.target !== "current") fail(`game.start target=current: ${JSON.stringify(gameStartResult)}`);
  else pass(`game.start target=current -> success (runtime_ready=${gameStartResult.runtime_ready})`);

  await new Promise((res) => setTimeout(res, 500));
  assertGuard(ctx, "game.start while already running", await bridge.call("game.start", {}, CALL_TIMEOUT), "ALREADY_PLAYING", "game.stop");

  const gameStopFirst = await bridge.call("game.stop", {}, CALL_TIMEOUT) as { success?: boolean; was_running?: boolean; status?: string; code?: string };
  if (gameStopFirst?.success !== true || gameStopFirst.was_running !== true) fail(`game.stop first: expected was_running=true, got ${JSON.stringify(gameStopFirst)}`);
  else if (gameStopFirst.status !== undefined) fail(`game.stop must NOT carry status (got ${gameStopFirst.status})`);
  else pass(`game.stop first -> was_running=true (no status field)`);

  await new Promise((res) => setTimeout(res, 1000));

  const gameStopIdempotent = await bridge.call("game.stop", {}, CALL_TIMEOUT) as { success?: boolean; was_running?: boolean; code?: string };
  if (gameStopIdempotent?.success !== true || gameStopIdempotent.was_running !== false) fail(`game.stop idempotent: expected was_running=false, got ${JSON.stringify(gameStopIdempotent)}`);
  else pass(`game.stop idempotent -> was_running=false`);

  // game.start guard rejections.
  assertGuard(ctx, "game.start target=bogus", await bridge.call("game.start", { scene_path: "bogus" }, CALL_TIMEOUT), "PATH_DENIED", "res://");
  assertGuard(ctx, "game.start missing res:// scene", await bridge.call("game.start", { scene_path: "res://no_such_game_smoke.tscn" }, CALL_TIMEOUT), "NOT_FOUND", "scene.create");
  assertGuard(ctx, "game.start .tres extension", await bridge.call("game.start", { scene_path: "res://bogus_smoke_scene.tres" }, CALL_TIMEOUT), "INVALID_PATH", ".tscn");

  // ── scene.instantiate ──
  const childSceneCreated = await bridge.call("scene.create", { file_path: instChildPath, root_type: "Node2D" }, CALL_TIMEOUT) as { status?: string; code?: string };
  if (childSceneCreated?.status !== "created") fail(`scene.create ${instChildPath}: ${JSON.stringify(childSceneCreated)}`);
  else pass(`scene.create ${instChildPath} -> status='created' (Node2D root)`);

  const defaultName = "smoke_inst_child";
  const instantiateFresh = await bridge.call("scene.instantiate", { parent_path: ".", packed_path: instChildPath }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; class_name?: string; code?: string };
  if (instantiateFresh?.status !== "created" || instantiateFresh.path !== defaultName || instantiateFresh.class_name !== "Node2D") {
    fail(`scene.instantiate fresh: expected status='created' path='${defaultName}' class_name='Node2D', got ${JSON.stringify(instantiateFresh)}`);
  } else pass(`scene.instantiate fresh -> status='created' at ${instantiateFresh.path}`);

  const instantiateIdempotent = await bridge.call("scene.instantiate", { parent_path: ".", packed_path: instChildPath }, CALL_TIMEOUT) as { status?: string; path?: string; code?: string };
  if (instantiateIdempotent?.status !== "returned" || instantiateIdempotent.path !== defaultName) fail(`scene.instantiate idempotent: expected status='returned' path='${defaultName}', got ${JSON.stringify(instantiateIdempotent)}`);
  else if (instantiateIdempotent.code !== undefined) fail(`scene.instantiate returned must not carry code (got ${instantiateIdempotent.code})`);
  else pass(`scene.instantiate idempotent -> status='returned' (code absent)`);

  // Ownership: save → reload → verify child persists.
  const saveAfterInstantiate = await bridge.call("editor.save_scene", {}, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!saveAfterInstantiate?.ok) fail(`editor.save_scene after instantiate: ${JSON.stringify(saveAfterInstantiate)}`);
  await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);
  const rawReloaded = await bridge.call("scene.get_tree", null, CALL_TIMEOUT) as { tree?: string; children?: { name?: string }[]; code?: string };
  const reloadedTree = (rawReloaded?.tree ? unwrapUntrusted(rawReloaded.tree) : rawReloaded) as { children?: { name?: string }[] };
  if (!reloadedTree?.children?.some((c) => c.name === defaultName)) fail(`instantiated child missing after save+reload: ${JSON.stringify(reloadedTree?.children?.map((c) => c.name))}`);
  else pass(`scene.instantiate owner-set survives save+reload`);

  // Named instantiate with transform coercion.
  await bridge.call("scene.delete_node", { node_path: defaultName }, CALL_TIMEOUT);
  const instantiateNamed = await bridge.call("scene.instantiate", {
    parent_path: ".", packed_path: instChildPath, as_name: "CellA",
    transform: { position: { type: "Vector2", x: 32, y: 48 } },
  }, CALL_TIMEOUT) as { status?: string; path?: string; class_name?: string; code?: string };
  if (instantiateNamed?.status !== "created" || instantiateNamed.path !== "CellA") fail(`scene.instantiate as_name='CellA': expected path='CellA', got ${JSON.stringify(instantiateNamed)}`);
  else pass(`scene.instantiate as_name='CellA' -> ${instantiateNamed.path}`);

  await bridge.call("editor.save_scene", {}, CALL_TIMEOUT);
  await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);
  const cellPosition = await bridge.call("node.get_property", { node_path: "CellA", property: "position" }, CALL_TIMEOUT) as { value?: { type?: string; x?: number; y?: number }; code?: string };
  if (cellPosition?.value?.type !== "Vector2" || cellPosition.value.x !== 32 || cellPosition.value.y !== 48) {
    fail(`scene.instantiate transform Vector2 round-trip: expected Vector2(32,48), got ${JSON.stringify(cellPosition)}`);
  } else pass(`scene.instantiate transform Vector2 round-trip -> x=32 y=48`);

  // scene.instantiate guard rejections.
  assertGuard(ctx, "scene.instantiate /tmp packed_path", await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "/tmp/foo.tscn" }, CALL_TIMEOUT), "PATH_DENIED", "absolute");
  assertGuard(ctx, "scene.instantiate .tres packed_path", await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "res://bogus_smoke.tres" }, CALL_TIMEOUT), "INVALID_PATH", ["resource.create", ".tscn"]);
  assertGuard(ctx, "scene.instantiate missing packed_path", await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "res://no_such_inst_smoke.tscn" }, CALL_TIMEOUT), "NOT_FOUND", "scene.create");
  assertGuard(ctx, "scene.instantiate bogus parent_path", await bridge.call("scene.instantiate", { parent_path: "NoSuchParent_xyz", packed_path: instChildPath }, CALL_TIMEOUT), "NOT_FOUND", "parent_path");

  // ── node.call_method (feature-gated iter 19) ──
  if (ncmGated) {
    pass("node.call_method -> FEATURE_DISABLED (skipping functional tests)");
  } else {
    const callGetName = await bridge.call("node.call_method", { node_path: ".", method_name: "get_name" }, CALL_TIMEOUT) as { success?: boolean; result?: unknown };
    if (callGetName?.success !== true || callGetName.result !== "Main") fail(`node.call_method .get_name on Main: expected "Main", got ${JSON.stringify(callGetName)}`);
    else pass(`node.call_method .get_name -> "Main"`);

    const callSetName = await bridge.call("node.call_method", { node_path: "CellA", method_name: "set_name", args: ["Renamed"] }, CALL_TIMEOUT) as { success?: boolean; code?: string };
    if (callSetName?.success !== true) fail(`node.call_method set_name: ${JSON.stringify(callSetName)}`);
    const renamedProperty = await bridge.call("node.get_property", { node_path: "Renamed", property: "name" }, CALL_TIMEOUT) as { value?: string; code?: string };
    if (renamedProperty?.value !== "Renamed") fail(`set_name round-trip: expected name='Renamed' at path='Renamed', got ${JSON.stringify(renamedProperty)}`);
    else pass(`node.call_method set_name round-trip -> "Renamed"`);

    assertGuard(ctx, "node.call_method bogus method", await bridge.call("node.call_method", { node_path: ".", method_name: "no_such_method_xyz" }, CALL_TIMEOUT), "INVALID_METHOD", "scene.get_tree");
    assertGuard(ctx, "node.call_method bogus path", await bridge.call("node.call_method", { node_path: "NoSuchNode_xyz", method_name: "get_name" }, CALL_TIMEOUT), "NOT_FOUND", "NoSuchNode_xyz");
  }

  // ── Resource-value coercion ──
  const textureCreated = await bridge.call("resource.create", { file_path: smokeTexPath, resource_class: "GradientTexture2D", properties: { width: 32, height: 32 } }, CALL_TIMEOUT) as { status?: string; code?: string };
  if (textureCreated?.status !== "created") fail(`resource.create ${smokeTexPath}: ${JSON.stringify(textureCreated)}`);
  else pass(`resource.create ${smokeTexPath} -> status='created' (GradientTexture2D)`);

  const coercionSpriteNode = await bridge.call("scene.create_node", { class_name: "Sprite2D", parent_path: ".", node_name: "CoercionSprite" }, CALL_TIMEOUT) as { status?: string; path?: string; code?: string };
  if (coercionSpriteNode?.status !== "created") fail(`scene.create_node Sprite2D: ${JSON.stringify(coercionSpriteNode)}`);
  const coercionSpritePath = coercionSpriteNode?.path ?? "CoercionSprite";

  const textureBindResult = await bridge.call("node.set_property", { node_path: coercionSpritePath, property: "texture", value: { type: "Resource", path: smokeTexPath } }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!textureBindResult?.ok) fail(`node.set_property texture via Resource dict: ${JSON.stringify(textureBindResult)}`);
  else pass(`node.set_property texture <- {type:Resource,path:${smokeTexPath}}`);

  const textureReadResult = await bridge.call("node.get_property", { node_path: coercionSpritePath, property: "texture" }, CALL_TIMEOUT) as { value?: { type?: string; path?: string; class?: string }; code?: string };
  if (textureReadResult?.value?.type !== "Resource" || textureReadResult.value.path !== smokeTexPath || textureReadResult.value.class !== "GradientTexture2D") {
    fail(`node.get_property texture coercion round-trip: expected {type:Resource,path:${smokeTexPath},class:GradientTexture2D}, got ${JSON.stringify(textureReadResult)}`);
  } else pass(`node.get_property texture -> {type:Resource,class:GradientTexture2D} round-trip`);

  if (!ncmGated) {
    const callSetTexture = await bridge.call("node.call_method", { node_path: coercionSpritePath, method_name: "set_texture", args: [{ type: "Resource", path: smokeTexPath }] }, CALL_TIMEOUT) as { success?: boolean; code?: string };
    if (callSetTexture?.success !== true) fail(`node.call_method set_texture via Resource arg: ${JSON.stringify(callSetTexture)}`);
    else pass(`node.call_method set_texture (Resource arg coercion) ok`);
  }

  // Color coercion.
  const colorSetResult = await bridge.call("node.set_property", { node_path: coercionSpritePath, property: "modulate", value: { type: "Color", r: 1.0, g: 0.5, b: 0.0 } }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!colorSetResult?.ok) fail(`node.set_property modulate <- Color dict: ${JSON.stringify(colorSetResult)}`);
  const colorReadResult = await bridge.call("node.get_property", { node_path: coercionSpritePath, property: "modulate" }, CALL_TIMEOUT) as { value?: { type?: string; r?: number; g?: number; b?: number; a?: number }; code?: string };
  if (colorReadResult?.value?.type !== "Color" || colorReadResult.value.r !== 1.0 || colorReadResult.value.g !== 0.5 || colorReadResult.value.b !== 0.0 || colorReadResult.value.a !== 1.0) {
    fail(`Color round-trip: expected {type:Color,r:1,g:0.5,b:0,a:1}, got ${JSON.stringify(colorReadResult)}`);
  } else pass(`Color coercion round-trip -> r=1 g=0.5 b=0 a=1`);

  assertGuard(ctx, "node.set_property Resource missing path",
    await bridge.call("node.set_property", { node_path: coercionSpritePath, property: "texture", value: { type: "Resource", path: "res://no_such_coerce_smoke.tres" } }, CALL_TIMEOUT),
    "LOAD_FAILED", "resource.create");

  // ── Self-cleanup ──
  try { await bridge.call("scene.delete_node", { node_path: coercionSpritePath }, CALL_TIMEOUT); } catch { /* noop */ }
  for (const name of ["Renamed", "CellA", "SmokeInstChild"]) {
    try { await bridge.call("scene.delete_node", { node_path: name }, CALL_TIMEOUT); } catch { /* noop */ }
  }
  try { await bridge.call("editor.save_scene", {}, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("resource.delete", { file_path: smokeTexPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.delete", { file_path: instChildPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("game.stop", {}, CALL_TIMEOUT); } catch { /* noop */ }
  pass(`playtest + composition cleanup complete`);
}

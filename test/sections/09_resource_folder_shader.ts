import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard, unwrapUntrusted } from "../helpers.js";

export async function testResourceFolderShader(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const resourcePath = "res://smoke_resource.tres";
  const folderRoot = "res://smoke_dir";
  const folderDeep = `${folderRoot}/nested/deep`;
  const shaderPath = "res://smoke.gdshader";
  const shaderIncPath = "res://smoke.gdshaderinc";

  // Orphan cleanup.
  try {
    await bridge.call("resource.delete", { file_path: resourcePath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.delete", { file_path: shaderPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.delete", { file_path: shaderIncPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("folder.delete", { folder_path: folderRoot, recursive: true }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }

  // resource.write create (upsert — file does not exist yet).
  const resourceCreated = (await bridge.call(
    "resource.write",
    { file_path: resourcePath, type: "Resource", properties: { resource_name: "smoke" } },
    CALL_TIMEOUT,
  )) as {
    success?: boolean;
    status?: string;
    path?: string;
    resource_class?: string;
    warnings?: string[];
    code?: string;
  };
  if (resourceCreated?.status !== "created" || resourceCreated.resource_class !== "Resource")
    fail(`resource.write create: expected status='created' class='Resource', got ${JSON.stringify(resourceCreated)}`);
  else if (!Array.isArray(resourceCreated.warnings) || resourceCreated.warnings.length !== 0)
    fail(`resource.write create: expected warnings=[], got ${JSON.stringify(resourceCreated.warnings)}`);
  else pass(`resource.write create -> status='created' class=Resource warnings=0`);

  // resource.write update (upsert — file exists, no status field).
  const resourceUpdated = (await bridge.call(
    "resource.write",
    { file_path: resourcePath, properties: { resource_name: "smoke2" } },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string; code?: string };
  if (resourceUpdated?.success !== true)
    fail(`resource.write update: expected success=true, got ${JSON.stringify(resourceUpdated)}`);
  else if (resourceUpdated.status !== undefined)
    fail(`resource.write update must NOT carry status (upsert update): got ${resourceUpdated.status}`);
  else pass(`resource.write update -> success, no status field`);

  // Guard rejections.
  assertGuard(
    ctx,
    "resource.write /tmp path",
    await bridge.call("resource.write", { file_path: "/tmp/foo.tres", type: "Resource" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "absolute",
  );
  assertGuard(
    ctx,
    "resource.write .gd extension",
    await bridge.call("resource.write", { file_path: "res://foo.gd", type: "Resource" }, CALL_TIMEOUT),
    "INVALID_PATH",
    "script.write",
  );
  assertGuard(
    ctx,
    "resource.write missing parent dir",
    await bridge.call(
      "resource.write",
      { file_path: "res://no_such_dir_smoke/foo.tres", type: "Resource" },
      CALL_TIMEOUT,
    ),
    "PARENT_NOT_FOUND",
    "folder.create",
  );
  assertGuard(
    ctx,
    "resource.write bogus class",
    await bridge.call("resource.write", { file_path: "res://smoke_bogus.tres", type: "BogusClass" }, CALL_TIMEOUT),
    "INVALID_CLASS",
    ["ClassDB", "ProjectSettings"],
  );
  assertGuard(
    ctx,
    "resource.write Node2D (not a Resource)",
    await bridge.call("resource.write", { file_path: "res://smoke_node2d.tres", type: "Node2D" }, CALL_TIMEOUT),
    "NOT_A_RESOURCE",
    "base chain",
  );

  // Unknown-key warning.
  const warnPath = "res://smoke_warn.tres";
  try {
    await bridge.call("resource.delete", { file_path: warnPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  const resourceWithWarning = (await bridge.call(
    "resource.write",
    { file_path: warnPath, type: "Resource", properties: { bogus_key: 42 } },
    CALL_TIMEOUT,
  )) as { status?: string; warnings?: string[]; code?: string };
  if (resourceWithWarning?.status !== "created")
    fail(`resource.write warn probe: expected status='created', got ${JSON.stringify(resourceWithWarning)}`);
  else if (
    !Array.isArray(resourceWithWarning.warnings) ||
    resourceWithWarning.warnings.length !== 1 ||
    !resourceWithWarning.warnings[0].includes("bogus_key") ||
    !resourceWithWarning.warnings[0].includes("Resource")
  ) {
    fail(
      `resource.write unknown-key warning: expected warnings[0] mentioning bogus_key + Resource, got ${JSON.stringify(resourceWithWarning.warnings)}`,
    );
  } else pass(`resource.write unknown key -> warnings[0] names 'bogus_key' + 'Resource'`);
  await bridge.call("resource.delete", { file_path: warnPath }, CALL_TIMEOUT);

  // resource.write update with property change (replace the Resource with a Curve first).
  await bridge.call("resource.delete", { file_path: resourcePath }, CALL_TIMEOUT);
  await bridge.call(
    "resource.write",
    { file_path: resourcePath, type: "Curve", properties: { bake_resolution: 100 } },
    CALL_TIMEOUT,
  );
  const resourceSaved = (await bridge.call(
    "resource.write",
    { file_path: resourcePath, properties: { bake_resolution: 200 } },
    CALL_TIMEOUT,
  )) as { success?: boolean; resource_class?: string; warnings?: string[]; status?: string; code?: string };
  if (resourceSaved?.success !== true || resourceSaved.resource_class !== "Curve")
    fail(`resource.write update round-trip: ${JSON.stringify(resourceSaved)}`);
  else if (resourceSaved.status !== undefined)
    fail(`resource.write update must NOT carry status: got ${resourceSaved.status}`);
  else if (!Array.isArray(resourceSaved.warnings) || resourceSaved.warnings.length !== 0)
    fail(`resource.write update: expected warnings=[], got ${JSON.stringify(resourceSaved.warnings)}`);
  else pass(`resource.write update round-trip -> class=Curve, no warnings, no status field`);

  const resourceLoaded = (await bridge.call("resource.load", { file_path: resourcePath }, CALL_TIMEOUT)) as {
    properties?: unknown;
    code?: string;
  };
  const loadedProps = unwrapUntrusted(resourceLoaded?.properties) as { bake_resolution?: number } | undefined;
  if (loadedProps?.bake_resolution !== 200)
    fail(`resource.load after write: expected bake_resolution=200, got ${JSON.stringify(loadedProps)}`);
  else pass(`resource.load after write -> bake_resolution=200`);

  // resource.write on missing file without type → error suggesting type param.
  const writeMissing = (await bridge.call(
    "resource.write",
    { file_path: "res://no_such_smoke.tres", properties: {} },
    CALL_TIMEOUT,
  )) as { code?: string; error?: string };
  if (writeMissing?.code !== "NOT_FOUND" || !writeMissing.error?.includes("type"))
    fail(`resource.write missing file: expected NOT_FOUND mentioning 'type', got ${JSON.stringify(writeMissing)}`);
  else pass(`resource.write missing file -> NOT_FOUND (message steers to 'type')`);

  // resource.delete round-trip.
  const resourceDeleted = (await bridge.call("resource.delete", { file_path: resourcePath }, CALL_TIMEOUT)) as {
    success?: boolean;
    path?: string;
    code?: string;
  };
  if (resourceDeleted?.success !== true || resourceDeleted.path !== resourcePath)
    fail(`resource.delete: ${JSON.stringify(resourceDeleted)}`);
  else pass(`resource.delete ${resourcePath}`);
  const resourceDeleteRepeat = (await bridge.call("resource.delete", { file_path: resourcePath }, CALL_TIMEOUT)) as {
    success?: boolean;
    code?: string;
  };
  if (resourceDeleteRepeat?.code !== "NOT_FOUND")
    fail(`resource.delete repeat: expected NOT_FOUND, got ${JSON.stringify(resourceDeleteRepeat)}`);
  else pass(`resource.delete repeat -> NOT_FOUND`);
  assertGuard(
    ctx,
    "resource.delete .tscn extension",
    await bridge.call("resource.delete", { file_path: "res://bogus.tscn" }, CALL_TIMEOUT),
    "INVALID_PATH",
    "scene.delete",
  );
  assertGuard(
    ctx,
    "resource.delete .gd extension",
    await bridge.call("resource.delete", { file_path: "res://bogus.gd" }, CALL_TIMEOUT),
    "INVALID_PATH",
    "script.delete",
  );

  // folder.create — recursive + idempotency.
  const folderCreated = (await bridge.call("folder.create", { folder_path: folderDeep }, CALL_TIMEOUT)) as {
    success?: boolean;
    status?: string;
    path?: string;
    code?: string;
  };
  if (folderCreated?.status !== "created" || folderCreated.path !== folderDeep)
    fail(`folder.create recursive: expected status='created' path=${folderDeep}, got ${JSON.stringify(folderCreated)}`);
  else pass(`folder.create recursive ${folderDeep} -> status='created'`);
  const folderIdempotent = (await bridge.call("folder.create", { folder_path: folderDeep }, CALL_TIMEOUT)) as {
    status?: string;
    code?: string;
  };
  if (folderIdempotent?.status !== "returned")
    fail(`folder.create idempotency: expected status='returned', got ${JSON.stringify(folderIdempotent)}`);
  else if (folderIdempotent.code !== undefined)
    fail(`folder.create returned must not carry code (got ${folderIdempotent.code})`);
  else pass(`folder.create idempotent -> status='returned' (code absent)`);
  assertGuard(
    ctx,
    "folder.create /tmp path",
    await bridge.call("folder.create", { folder_path: "/tmp/smoke_bogus" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "absolute",
  );

  // folder.delete — PATH_IN_USE refusal + clean teardown via scene.close.
  const pathInUseDir = "res://smoke_path_in_use";
  const pathInUseProbe = `${pathInUseDir}/probe.tscn`;
  try {
    await bridge.call("folder.create", { folder_path: pathInUseDir }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  await bridge.call(
    "scene.create",
    { file_path: pathInUseProbe, root_type: "Node", if_exists: "return" },
    CALL_TIMEOUT,
  );
  await bridge.call("scene.open", { file_path: pathInUseProbe }, CALL_TIMEOUT);
  const folderInUse = (await bridge.call(
    "folder.delete",
    { folder_path: pathInUseDir, recursive: true },
    CALL_TIMEOUT,
  )) as { code?: string; error?: string };
  if (folderInUse?.code !== "PATH_IN_USE" || !folderInUse.error?.includes(pathInUseProbe)) {
    fail(
      `folder.delete on folder containing edited scene: expected PATH_IN_USE naming ${pathInUseProbe}, got ${JSON.stringify(folderInUse)}`,
    );
  } else pass(`folder.delete refuses folder containing edited scene -> PATH_IN_USE`);
  const pathInUseClose = (await bridge.call("scene.close", { file_path: pathInUseProbe }, CALL_TIMEOUT)) as {
    success?: boolean;
  };
  if (!pathInUseClose?.success) fail(`PATH_IN_USE probe scene.close: ${JSON.stringify(pathInUseClose)}`);
  await bridge.call("scene.delete", { file_path: pathInUseProbe }, CALL_TIMEOUT);
  await bridge.call("folder.delete", { folder_path: pathInUseDir, recursive: true }, CALL_TIMEOUT);
  pass("PATH_IN_USE probe: clean teardown via scene.close + delete");

  // folder.delete guards.
  assertGuard(
    ctx,
    "folder.delete project root",
    await bridge.call("folder.delete", { folder_path: "res://" }, CALL_TIMEOUT),
    "FOLDER_PROTECTED",
    "root",
  );
  assertGuard(
    ctx,
    "folder.delete res://addons",
    await bridge.call("folder.delete", { folder_path: "res://addons" }, CALL_TIMEOUT),
    "FOLDER_PROTECTED",
    "addons",
  );
  assertGuard(
    ctx,
    "folder.delete toolkit plugin dir",
    await bridge.call("folder.delete", { folder_path: "res://addons/godot_mcp_toolkit" }, CALL_TIMEOUT),
    "FOLDER_PROTECTED",
    "godot_mcp_toolkit",
  );
  assertGuard(
    ctx,
    "folder.delete non-empty without recursive",
    await bridge.call("folder.delete", { folder_path: folderRoot }, CALL_TIMEOUT),
    "DIR_NOT_EMPTY",
    "recursive:true",
  );

  // folder.delete — empty leaf success.
  const folderDeleteLeaf = (await bridge.call("folder.delete", { folder_path: folderDeep }, CALL_TIMEOUT)) as {
    success?: boolean;
    path?: string;
    files_deleted?: number;
    directories_deleted?: number;
    code?: string;
  };
  if (
    folderDeleteLeaf?.success !== true ||
    folderDeleteLeaf.files_deleted !== 0 ||
    folderDeleteLeaf.directories_deleted !== 0
  ) {
    fail(`folder.delete empty leaf: expected success with zero counts, got ${JSON.stringify(folderDeleteLeaf)}`);
  } else pass(`folder.delete empty leaf ${folderDeep} -> files=0 dirs=0`);

  const folderDeleteRecursive = (await bridge.call(
    "folder.delete",
    { folder_path: folderRoot, recursive: true },
    CALL_TIMEOUT,
  )) as { success?: boolean; files_deleted?: number; directories_deleted?: number; code?: string };
  if (folderDeleteRecursive?.success !== true)
    fail(`folder.delete recursive: ${JSON.stringify(folderDeleteRecursive)}`);
  else
    pass(
      `folder.delete recursive ${folderRoot} -> files=${folderDeleteRecursive.files_deleted} dirs=${folderDeleteRecursive.directories_deleted}`,
    );

  // Shader allowlist.
  const shaderWriteResult = (await bridge.call(
    "script.write",
    { file_path: shaderPath, content: "shader_type canvas_item;\n" },
    CALL_TIMEOUT,
  )) as { ok?: boolean; code?: string };
  if (!shaderWriteResult?.ok) fail(`script.write .gdshader: ${JSON.stringify(shaderWriteResult)}`);
  else pass(`script.write .gdshader ok`);
  const shaderIncWriteResult = (await bridge.call(
    "script.write",
    { file_path: shaderIncPath, content: "// smoke include\n" },
    CALL_TIMEOUT,
  )) as { ok?: boolean; code?: string };
  if (!shaderIncWriteResult?.ok) fail(`script.write .gdshaderinc: ${JSON.stringify(shaderIncWriteResult)}`);
  else pass(`script.write .gdshaderinc ok`);
  assertGuard(
    ctx,
    "script.write .txt extension (new guard)",
    await bridge.call("script.write", { file_path: "res://smoke_bogus.txt", content: "x" }, CALL_TIMEOUT),
    "INVALID_PATH",
    ".gd",
  );
  const shaderDeleted = (await bridge.call("script.delete", { file_path: shaderPath }, CALL_TIMEOUT)) as {
    success?: boolean;
    code?: string;
  };
  if (shaderDeleted?.success !== true) fail(`script.delete .gdshader: ${JSON.stringify(shaderDeleted)}`);
  else pass(`script.delete .gdshader ok`);
  const shaderIncDeleted = (await bridge.call("script.delete", { file_path: shaderIncPath }, CALL_TIMEOUT)) as {
    success?: boolean;
    code?: string;
  };
  if (shaderIncDeleted?.success !== true) fail(`script.delete .gdshaderinc: ${JSON.stringify(shaderIncDeleted)}`);
  else pass(`script.delete .gdshaderinc ok`);

  // Belt-and-braces cleanup.
  try {
    await bridge.call("resource.delete", { file_path: resourcePath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("resource.delete", { file_path: warnPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.delete", { file_path: shaderPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.delete", { file_path: shaderIncPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("folder.delete", { folder_path: folderRoot, recursive: true }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}

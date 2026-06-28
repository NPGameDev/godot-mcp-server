import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Bridge } from "../shared/types.js";
import { registerGroupSystem } from "../groups/groups.js";

import * as animation from "../tools/animation.js";
import * as asset from "../tools/asset.js";
import * as diff from "../tools/diff.js";
import * as editor from "../tools/editor.js";
import * as file from "../tools/file.js";
import * as folder from "../tools/folder.js";
import * as inputMap from "../tools/inputMap.js";
import * as node from "../tools/node.js";
import * as playtest from "../tools/playtest.js";
import * as resource from "../tools/resource.js";
import * as runtime from "../tools/runtime.js";
import * as scene from "../tools/scene.js";
import * as script from "../tools/script.js";
import * as signal from "../tools/signals.js";
import * as save from "../tools/save.js";
import * as tilemap from "../tools/tilemap.js";
import * as tileset from "../tools/tileset.js";
import * as classdb from "../tools/classdb.js";
import * as nodeManagement from "../tools/nodeManagement.js";
import * as sceneQuery from "../tools/sceneQuery.js";
import * as spatial from "../tools/spatial.js";
import * as texture from "../tools/texture.js";
import * as sound from "../tools/sound.js";

// ── Built-in tool-surface registration (shared by startup + reload) ──
// The single place every built-in <module>.register(...) call is enumerated,
// plus the discover_tools group system. Pure delegation — no state. Callers
// (composition root + the config-reload path) supply server/bridge and the
// live registration inputs (moduleAllowed / readOnly).

/** Register every built-in tool module onto the server (scene, node, script, … sound — 23 modules). */
export function registerBuiltinModules(server: McpServer, bridge: Bridge, moduleAllowed: Set<string>): void {
  scene.register(server, bridge, moduleAllowed);
  node.register(server, bridge, moduleAllowed);
  script.register(server, bridge, moduleAllowed);
  editor.register(server, bridge, moduleAllowed);
  resource.register(server, bridge, moduleAllowed);
  folder.register(server, bridge, moduleAllowed);
  diff.register(server, bridge, moduleAllowed);
  playtest.register(server, bridge, moduleAllowed);
  tilemap.register(server, bridge, moduleAllowed);
  tileset.register(server, bridge, moduleAllowed);
  asset.register(server, bridge, moduleAllowed);
  runtime.register(server, bridge, moduleAllowed);
  signal.register(server, bridge, moduleAllowed);
  animation.register(server, bridge, moduleAllowed);
  inputMap.register(server, bridge, moduleAllowed);
  file.register(server, bridge, moduleAllowed);
  save.register(server, bridge, moduleAllowed);
  classdb.register(server, bridge, moduleAllowed);
  nodeManagement.register(server, bridge, moduleAllowed);
  sceneQuery.register(server, bridge, moduleAllowed);
  spatial.register(server, bridge, moduleAllowed);
  texture.register(server, bridge, moduleAllowed);
  sound.register(server, bridge, moduleAllowed);
}

/** Register the discover_tools group system (idempotent; re-callable to refresh its description). */
export function registerGroups(server: McpServer, bridge: Bridge, readOnly: boolean): void {
  // Register discover_tools with built-in groups BEFORE transport
  // connects, so it's in the initial tools/list response — no extra
  // notification needed for the common case (no extensions).
  // If extensions are later discovered, registerGroupSystem is called
  // again (idempotent) which updates the description.
  registerGroupSystem(server, bridge, readOnly);
}

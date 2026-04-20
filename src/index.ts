#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createBridge } from "./bridge.js";
import { selectedProfile, resolveAllowedTools, isReadOnly, MUTATING_TOOLS } from "./profiles.js";
import { registerGroupSystem, registerAllGroupTools, GROUP_TOOL_NAMES } from "./groups.js";
import { registerStubs } from "./stubs.js";

import * as animation from "./tools/animation.js";
import * as asset from "./tools/asset.js";
import * as diff from "./tools/diff.js";
import * as editor from "./tools/editor.js";
import * as file from "./tools/file.js";
import * as folder from "./tools/folder.js";
import * as inputMap from "./tools/input_map.js";
import * as node from "./tools/node.js";
import * as playtest from "./tools/playtest.js";
import * as resource from "./tools/resource.js";
import * as runtime from "./tools/runtime.js";
import * as scene from "./tools/scene.js";
import * as script from "./tools/script.js";
import * as signal from "./tools/signals.js";
import * as save from "./tools/save.js";
import * as tilemap from "./tools/tilemap.js";

// All module tool-def arrays (gate-conditional arrays may be empty at
// import time when their env var is unset — that is correct: gated tools
// get stubs via registerStubs instead).
const ALL_MODULE_DEFS = [
  animation.animationTools, asset.assetTools, diff.diffTools,
  editor.editorTools, file.fileTools, folder.folderTools,
  inputMap.inputMapTools, node.nodeTools, playtest.playtestTools,
  resource.resourceTools, runtime.runtimeTools, scene.sceneTools,
  script.scriptTools, signal.signalTools, save.saveTools,
  tilemap.tilemapTools,
];

// --- Profile resolution ---
const profile = selectedProfile();
const readOnly = isReadOnly();

// Build the allowed-tool set. resolveAllowedTools returns null for the
// full profile (= register everything). We always need an explicit set
// so we can subtract group tools before passing to module registers.
let allowedTools = resolveAllowedTools(profile, readOnly);
if (allowedTools === null) {
  allowedTools = new Set<string>();
  for (const defs of ALL_MODULE_DEFS) {
    for (const t of defs) allowedTools.add(t.name);
  }
  if (readOnly) {
    for (const name of MUTATING_TOOLS) allowedTools.delete(name);
  }
}

// Module register() handles non-group tools only; group tools are
// registered by groups.ts (either eagerly or via enable_tool_group).
const moduleAllowed = new Set(allowedTools);
for (const name of GROUP_TOOL_NAMES) moduleAllowed.delete(name);

// --- Bridge / server setup ---
const port = process.env.GODOT_MCP_PORT ?? "6505";
const runtimePort = process.env.GODOT_MCP_RUNTIME_PORT ?? "9090";
const bridge = createBridge(
  `ws://127.0.0.1:${port}`,
  `ws://127.0.0.1:${runtimePort}`,
);

const server = new McpServer({ name: "godot-mcp-toolkit", version: "0.1.0" });

// --- Register core (non-group) tools ---
scene.register(server, bridge, moduleAllowed);
node.register(server, bridge, moduleAllowed);
script.register(server, bridge, moduleAllowed);
editor.register(server, bridge, moduleAllowed);
resource.register(server, bridge, moduleAllowed);
folder.register(server, bridge, moduleAllowed);
diff.register(server, bridge, moduleAllowed);
playtest.register(server, bridge, moduleAllowed);
tilemap.register(server, bridge, moduleAllowed);
asset.register(server, bridge, moduleAllowed);
runtime.register(server, bridge, moduleAllowed);
signal.register(server, bridge, moduleAllowed);
animation.register(server, bridge, moduleAllowed);
inputMap.register(server, bridge, moduleAllowed);
file.register(server, bridge, moduleAllowed);
save.register(server, bridge, moduleAllowed);

// --- Group tools ---
if (profile === "full") {
  registerAllGroupTools(server, bridge, readOnly);
} else if (profile !== "minimal") {
  registerGroupSystem(server, bridge, readOnly);
}

// --- Locked stubs for gated tools (non-minimal only) ---
registerStubs(server, profile);

process.stderr.write(
  `[godot-mcp] profile=${profile} readOnly=${readOnly} tools=${moduleAllowed.size}+groups\n`,
);

// --- Lifecycle ---
async function shutdown(): Promise<void> {
  try {
    await bridge.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);

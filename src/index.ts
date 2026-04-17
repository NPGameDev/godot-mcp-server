#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { Profile } from "./types.js";
import { createBridge } from "./bridge.js";
import * as animationTools from "./tools/animation.js";
import * as assetTools from "./tools/asset.js";
import * as diffTools from "./tools/diff.js";
import * as editorTools from "./tools/editor.js";
import * as fileTools from "./tools/file.js";
import * as folderTools from "./tools/folder.js";
import * as inputMapTools from "./tools/input_map.js";
import * as nodeTools from "./tools/node.js";
import * as playtestTools from "./tools/playtest.js";
import * as resourceTools from "./tools/resource.js";
import * as runtimeTools from "./tools/runtime.js";
import * as sceneTools from "./tools/scene.js";
import * as scriptTools from "./tools/script.js";
import * as signalTools from "./tools/signals.js";
import * as tilemapTools from "./tools/tilemap.js";

// --lite opts into a ~15-tool token-sensitive catalogue; default is the
// full catalogue. Precursor to a richer profile system.
const profile: Profile = process.argv.includes("--lite") ? "lite" : "full";

const port = process.env.GODOT_MCP_PORT ?? "6505";
const runtimePort = process.env.GODOT_MCP_RUNTIME_PORT ?? "9090";
const bridge = createBridge(
  `ws://127.0.0.1:${port}`,
  `ws://127.0.0.1:${runtimePort}`,
);

const server = new McpServer({ name: "godot-mcp-toolkit", version: "0.1.0" });

sceneTools.register(server, bridge, profile);
nodeTools.register(server, bridge, profile);
scriptTools.register(server, bridge, profile);
editorTools.register(server, bridge, profile);
runtimeTools.register(server, bridge, profile);
signalTools.register(server, bridge, profile);
resourceTools.register(server, bridge, profile);
folderTools.register(server, bridge, profile);
diffTools.register(server, bridge, profile);
playtestTools.register(server, bridge, profile);
inputMapTools.register(server, bridge, profile);
animationTools.register(server, bridge, profile);
tilemapTools.register(server, bridge, profile);
assetTools.register(server, bridge, profile);
fileTools.register(server, bridge, profile);

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

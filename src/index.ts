#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBridge } from "./bridge.js";
import * as sceneTools from "./tools/scene.js";
import * as nodeTools from "./tools/node.js";
import * as scriptTools from "./tools/script.js";
import * as editorTools from "./tools/editor.js";
import * as runtimeTools from "./tools/runtime.js";

const port = process.env.GODOT_MCP_PORT ?? "6505";
const runtimePort = process.env.GODOT_MCP_RUNTIME_PORT ?? "9090";
const bridge = createBridge(
  `ws://127.0.0.1:${port}`,
  `ws://127.0.0.1:${runtimePort}`,
);

const server = new McpServer({ name: "godot-mcp-toolkit", version: "0.1.0" });

sceneTools.register(server, bridge);
nodeTools.register(server, bridge);
scriptTools.register(server, bridge);
editorTools.register(server, bridge);
runtimeTools.register(server, bridge);

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

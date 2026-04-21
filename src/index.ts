#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createBridge } from "./bridge.js";
import { lookupProject } from "./registry.js";
import { selectedProfile, resolveAllowedTools, isReadOnly, MUTATING_TOOLS } from "./profiles.js";
import { registerGroupSystem, registerAllGroupTools, GROUP_TOOL_NAMES } from "./groups.js";
import { registerStubs } from "./stubs.js";
import { createHookPipeline } from "./hooks.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { init as initRoots, registerRoots } from "./roots.js";
import type { ToolTextResult } from "./types.js";
import { callAndWrap } from "./types.js";

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
import * as classdb from "./tools/classdb.js";

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
  classdb.classdbTools,
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
// Registry-based discovery. GODOT_MCP_PORT bypasses registry for
// backwards compat. Otherwise resolve via the system-wide projects.json.
const explicitPort = process.env.GODOT_MCP_PORT;
const explicitRuntimePort = process.env.GODOT_MCP_RUNTIME_PORT ?? null;
const projectPath = process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();

let editorPort: string;
if (explicitPort) {
  editorPort = explicitPort;
} else {
  const entry = lookupProject(projectPath);
  if (entry) {
    editorPort = String(entry.port);
    process.stderr.write(
      `[godot-mcp] registry: ${projectPath} → port ${editorPort}\n`,
    );
  } else {
    editorPort = "6505";
    process.stderr.write(
      `[godot-mcp] registry: no entry for ${projectPath}; falling back to port ${editorPort}\n`,
    );
  }
}

const bridge = createBridge(`ws://127.0.0.1:${editorPort}`, {
  projectPath,
  explicitRuntimePort,
  explicitEditorPort: !!explicitPort,
});

const server = new McpServer(
  { name: "godot-mcp-toolkit", version: "0.1.0" },
  { capabilities: { tools: { listChanged: true } } },
);

// --- Hook pipeline ---
const hookPipeline = createHookPipeline();
const _origRegisterTool = server.registerTool.bind(server);
(server as any).registerTool = (
  name: string,
  config: Parameters<typeof server.registerTool>[1],
  handler: (input: any) => Promise<ToolTextResult>,
) => {
  _origRegisterTool(name, config, (input: any) =>
    hookPipeline.execute(
      { name, input: (input ?? {}) as Record<string, unknown> },
      () => handler(input),
    ),
  );
};

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
classdb.register(server, bridge, moduleAllowed);

// --- Group tools ---
if (profile === "full") {
  registerAllGroupTools(server, bridge, readOnly);
} else if (profile !== "minimal") {
  registerGroupSystem(server, bridge, readOnly);
}

registerStubs(server, profile);

registerPrompts(server);
registerResources(server, bridge);
initRoots(projectPath);
registerRoots(server);

process.stderr.write(
  `[godot-mcp] profile=${profile} readOnly=${readOnly} tools=${moduleAllowed.size}+groups hooks=${hookPipeline.length}\n`,
);

// --- User command discovery ---
// After the server starts, discover user-defined commands from the toolkit
// and register them as MCP tools. Non-blocking: if the editor is unreachable,
// built-in tools still work and user commands will be missing.
async function discoverUserCommands(): Promise<void> {
  try {
    const result = (await bridge.call("meta.user_commands", {}, 5000)) as {
      success?: boolean;
      commands?: { method: string }[];
    };
    if (!result?.success || !Array.isArray(result.commands)) return;
    let registered = 0;
    for (const cmd of result.commands) {
      const toolName = cmd.method.replace(/\./g, "_");
      server.registerTool(
        toolName,
        {
          description: `User command: ${cmd.method}`,
          inputSchema: {},
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        (input: unknown) => callAndWrap(bridge, cmd.method, input),
      );
      registered++;
    }
    if (registered > 0) {
      process.stderr.write(
        `[godot-mcp] registered ${registered} user command(s)\n`,
      );
      server.sendToolListChanged();
    }
  } catch {
    // Editor unreachable or meta.user_commands not available — not an error.
  }
}

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

discoverUserCommands();

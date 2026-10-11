/**
 * The seam between the resolved startup configuration and the bridge. Preflight
 * resolves the project path, the ports and the response caps on its own; this one
 * function assembles them into what `createBridge` takes, so a resolved value
 * cannot be dropped on its way to the bridge without a unit test noticing.
 * Type-only imports: it adds no runtime edge from `startup/` to `transport/`.
 *
 * @module
 */

import type { BridgeOptions } from "../transport/bridge.js";
import type { ResolvedPortConfig } from "./portConfig.js";
import type { ResponseCaps } from "./startupEnv.js";

/**
 * Build the bridge options from the resolved startup configuration: the project
 * path, the dial ports, and the response caps the environment sets.
 *
 * @param projectPath - the Godot project the bridge discovers ports for
 * @param ports - the resolved dial configuration (pins and their sources)
 * @param caps - the env-set response caps, from `resolveResponseCaps`; each
 *   defined cap becomes an env override the bridge pushes after every editor auth
 * @returns the options the composition root hands to `createBridge`
 */
export function buildBridgeOptions(projectPath: string, ports: ResolvedPortConfig, caps: ResponseCaps): BridgeOptions {
  return {
    projectPath,
    explicitRuntimePort: ports.runtimePort,
    explicitEditorPort: ports.editorPinned,
    scriptReadLimitBytes: caps.scriptReadLimitBytes,
    wsBufferLimitBytes: caps.wsBufferLimitBytes,
  };
}

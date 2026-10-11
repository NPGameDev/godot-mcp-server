/**
 * The one rule for which Godot project this server serves. Every module that needs
 * the served project resolves it here, so they cannot disagree about it.
 * A leaf with no imports: modules outside `startup/` may depend on it without
 * pulling in the startup preflight.
 *
 * @module
 */

/**
 * Resolve the project path: `GODOT_MCP_PROJECT_PATH` when it is set and non-empty,
 * otherwise `cwd`. An empty variable counts as unset, because a project path of
 * `""` can never authenticate against an editor. A whitespace-only value is kept
 * as a path: only the empty string is treated as absent, so an unusual path is
 * reported as given rather than silently replaced.
 */
export function resolveProjectPath(env: NodeJS.ProcessEnv, cwd: string): string {
  return env.GODOT_MCP_PROJECT_PATH || cwd;
}

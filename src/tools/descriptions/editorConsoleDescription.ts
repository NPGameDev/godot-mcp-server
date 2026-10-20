/**
 * The `editor_get_console` tool description, tailored to the connected Godot version:
 * which output each `source` reads depends on the engine.
 *
 * @module
 */
import { GODOT_LOG_FILE_FLAG_MIN, GODOT_LOGGER_CAPTURE_MIN } from "../../shared/engineThresholds.js";
import { isVersionAtLeast, type GodotVer } from "../../shared/version.js";

/** The parameters and paging note that hold on every version. */
const CONSOLE_COMMON_TAIL =
  "level_filter, since_id, text_filter (is_regex=true for regex). Carries returned/total_lines/has_more + next_id — page via since_id. " +
  "Primary post-crash diagnostic tool — reads runtime errors even after game_stop.";

/**
 * Describe `editor_get_console` for the connected editor.
 *
 * @param version - the connected Godot version, or `null` while it is not yet known
 * @returns the full text for that version. `null` yields the generic text that is true
 *   on every version; it is the tool's static `description`.
 */
export function describeEditorConsole(version: GodotVer | null): string {
  return `${describeConsoleSources(version)} ${CONSOLE_COMMON_TAIL}`;
}

/** What each `source` reads on the connected editor: the version-dependent opening. */
function describeConsoleSources(version: GodotVer | null): string {
  if (version == null) {
    return (
      "Tail editor Output. source='buffer' (default): live editor console on 4.5+, game-log tail on 4.2-4.4. " +
      "source='file': the newest log — the game's, or the editor's own when launched with --log-file (4.3+; not 4.4 on Windows)."
    );
  }
  if (isVersionAtLeast(version, GODOT_LOGGER_CAPTURE_MIN)) {
    return (
      "Tail editor Output. source='buffer' (default): live editor console. " +
      "source='file': the newest log — the game's, or the editor's own when launched with --log-file."
    );
  }
  if (isVersionAtLeast(version, GODOT_LOG_FILE_FLAG_MIN)) {
    return (
      "Tail editor Output. source='buffer' (default): game-log tail. " +
      "source='file': the newest log — the game's, or the editor's own when launched with --log-file (not 4.4 on Windows)."
    );
  }
  return "Tail editor Output. source='buffer' (default): game-log tail. source='file': the game-written log.";
}

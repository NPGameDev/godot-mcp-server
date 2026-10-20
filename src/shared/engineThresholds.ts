/**
 * Godot versions (`major.minor`) at which engine behaviour the server describes to the
 * agent changes. Compare them with `isVersionAtLeast` from `version.ts`.
 *
 * @module
 */

/** First Godot version with the `--log-file` editor command-line flag, which makes the
 *  editor write its own output to a log file. */
export const GODOT_LOG_FILE_FLAG_MIN = "4.3";

/** First Godot version with `OS.add_logger`, so the editor's live console and a
 *  GDScript compile error's line can be captured. */
export const GODOT_LOGGER_CAPTURE_MIN = "4.5";

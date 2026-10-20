/**
 * The `script_check` tool description, tailored to the connected Godot version.
 *
 * @module
 */
import { GODOT_LOGGER_CAPTURE_MIN } from "../../shared/engineThresholds.js";
import { isVersionAtLeast, type GodotVer } from "../../shared/version.js";

/**
 * Describe `script_check` for the connected editor.
 *
 * @param version - the connected Godot version, or `null` while it is not yet known
 * @returns the text for that version. `null` yields the generic text that is true on
 *   every version; it is the tool's static `description`.
 */
export function describeScriptCheck(version: GodotVer | null): string {
  if (version == null) {
    return (
      "Offline GDScript validation — pass/fail + diagnostics. A class_name clash always carries its line (1-based); " +
      "a compile error only on 4.5+. Columns are lsp_diagnostics' domain. Works headless."
    );
  }
  if (isVersionAtLeast(version, GODOT_LOGGER_CAPTURE_MIN)) {
    return (
      "Offline GDScript validation — pass/fail + diagnostics, each error with its line (1-based). " +
      "Columns are lsp_diagnostics' domain. Works headless."
    );
  }
  return (
    "Offline GDScript validation — pass/fail + diagnostics. A class_name clash carries its line (1-based); " +
    "a compile error carries none. Columns are lsp_diagnostics' domain. Works headless."
  );
}

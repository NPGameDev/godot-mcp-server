// ── Group-loaded session state ───────────────────────────────────────
//
// Leaf module (no imports) holding which on-demand tool groups have been
// activated this session. A separate leaf so tool-def modules (e.g.
// tools/playtest.ts) can read load state via isGroupLoaded() WITHOUT importing
// the heavy groups.ts — which would form an import cycle once groups.ts derives
// its tool lookup from catalogue.ts
// (catalogue → tools/playtest → groups → catalogue). groups.ts mutates
// `loadedGroups` directly (shared Set); it is never reassigned.

/** Names of built-in groups activated this session (via discover_tools). */
export const loadedGroups = new Set<string>();

/** Whether a built-in group has been activated this session. */
export function isGroupLoaded(name: string): boolean {
  return loadedGroups.has(name);
}

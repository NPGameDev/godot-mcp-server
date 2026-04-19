/**
 * Untrusted-content envelope wrapper (I5) — TypeScript mirror of
 * addons/godot_mcp_toolkit/untrusted.gd.
 *
 * Wraps user-authored / project-authored content before it reaches the
 * LLM. Not applicable for iter 18 outputs (all wrapping happens
 * GDScript-side), but available for iter 20 server-originated scrubbing.
 */

export function untrustedWrap(
  kind: string,
  source: string,
  body: string,
): string {
  return `<untrusted kind="${kind}" source="${source}">\n${body}\n</untrusted>`;
}

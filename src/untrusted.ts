import { randomBytes } from "crypto";

/**
 * Untrusted-content envelope wrapper — TypeScript mirror of
 * addons/godot_mcp_toolkit/untrusted.gd.
 *
 * Wraps user-authored / project-authored content before it reaches the
 * LLM in a nonce-tagged envelope to prevent tag-breakout injection.
 * Most wrapping happens GDScript-side, but this is available for
 * server-originated wrapping.
 */

/** Matches any <untrusted...> or </untrusted...> tag variant. */
const ENVELOPE_TAG_RE = /<\s*\/?\s*untrusted(?:-[0-9a-f]*)?(?:\s[^>]*)?\s*>/gi;

function generateNonce(): string {
  return randomBytes(4).toString("hex");
}

function scrubEnvelopeTags(text: string): string {
  return text.replace(ENVELOPE_TAG_RE, "[scrubbed-envelope-tag]");
}

export function untrustedWrap(kind: string, source: string, body: string): string {
  const nonce = generateNonce();
  const scrubbed = scrubEnvelopeTags(body);
  return `<untrusted-${nonce} kind="${kind}" source="${source}">\n${scrubbed}\n</untrusted-${nonce}>`;
}

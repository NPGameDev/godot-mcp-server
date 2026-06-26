/**
 * LSP status reporter — pushes the GDScript-LSP verdict to the editor dock
 * (editor.set_lsp_status, ADR 0008). The editor can't read its own LSP bind
 * status, so the server reports it.
 *
 * Two verdict sources share a single lastLspKey dedup so frequent LSP calls
 * don't spam the bridge:
 *   - Verified verdicts from actual LSP tool calls — wired via setLspStatusReporter
 *     at construction (the real connection result, accurate across versions).
 *   - The registry-derived verdict (reportRegistryVerdict) — fast, no LSP
 *     connection; pushed on bridge connect/reconnect so a freshly-connected editor
 *     gets the current status, later refined by the verified result.
 *
 * Construction also wires the version-tailored conflict-hint getter
 * (setGodotVersionGetter: 4.5+ auto-rebind vs 4.2-4.4 distinct-port).
 */
import { getLspStatus, setGodotVersionGetter, type LspStatus } from "./lsp_client.js";
import { setLspStatusReporter } from "./tools/lsp.js";
import type { Bridge } from "./types.js";

export interface LspStatusReporter {
  /** Push the registry-derived verdict (fast, no LSP connection) — used on bridge connect/reconnect. */
  reportRegistryVerdict(): void;
}

/** Wires the verified-verdict reporter (setLspStatusReporter, de-duped via
 *  lastLspKey) and the version-tailored conflict-hint getter (setGodotVersionGetter)
 *  at construction, then returns the registry-verdict pusher. */
export function createLspStatusReporter(deps: { bridge: Bridge; projectPath: string }): LspStatusReporter {
  const { bridge, projectPath } = deps;

  // Push the GDScript LSP verdict to the editor dock (editor.set_lsp_status, ADR
  // 0008) — the editor can't read its own LSP bind status, so the server reports it.
  function sendLspStatus(s: LspStatus): void {
    try {
      void bridge.call("editor.set_lsp_status", s, 3000).catch(() => {});
    } catch {
      /* never let UI status reporting disrupt the bridge */
    }
  }

  // Verified verdicts from actual LSP tool calls (the real connection result —
  // accurate across versions), de-duped so frequent LSP calls don't spam the bridge.
  let lastLspKey = "";
  setLspStatusReporter((s: LspStatus) => {
    const key = `${s.state}:${s.host}:${s.port}`;
    if (key === lastLspKey) return;
    lastLspKey = key;
    sendLspStatus(s);
  });
  // Version-tailored LSP conflict hints (4.5+ auto-rebind vs 4.2-4.4 distinct-port).
  setGodotVersionGetter(() => bridge.getGodotVersion());

  return {
    /** On bridge connect/reconnect: push the registry verdict (fast, no LSP
     *  connection) so a freshly-connected editor gets the current status; later LSP
     *  tool calls refine it with the verified result. */
    reportRegistryVerdict(): void {
      const s = getLspStatus(projectPath);
      lastLspKey = `${s.state}:${s.host}:${s.port}`;
      sendLspStatus(s);
    },
  };
}

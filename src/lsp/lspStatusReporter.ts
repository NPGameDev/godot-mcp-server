/**
 * LSP status reporter — pushes the GDScript-LSP verdict to the editor dock
 * (editor.set_lsp_status). The editor can't read its own LSP bind status, so
 * the server reports it.
 *
 * Two verdict sources share a single lastLspKey dedup so frequent LSP calls
 * don't spam the bridge:
 *   - Verified verdicts from actual LSP tool calls — wired via setLspStatusReporter
 *     at construction (the real connection result, accurate across versions).
 *   - The registry-derived verdict (reportRegistryVerdict) — no LSP handshake,
 *     just resolution; pushed on bridge connect/reconnect so a freshly-connected
 *     editor gets the current status, later refined by the verified result.
 *
 * Construction also wires the version-tailored conflict-hint getter
 * (setGodotVersionGetter: 4.5 auto-rebind vs distinct-port everywhere else).
 */
import { getLspStatus, setGodotVersionGetter, type LspStatus } from "./lspClient.js";
import { setLspStatusReporter } from "../tools/lsp.js";
import type { Bridge } from "../shared/types.js";

export interface LspStatusReporter {
  /** Push the registry-derived verdict — used on bridge connect/reconnect. Opens no
   *  LSP connection, but does probe peer WS ports (bounded at 300 ms each, run
   *  concurrently), so it resolves asynchronously and yields to any verified verdict
   *  that lands first. */
  reportRegistryVerdict(): void;
}

/** Wires the verified-verdict reporter (setLspStatusReporter, de-duped via
 *  lastLspKey) and the version-tailored conflict-hint getter (setGodotVersionGetter)
 *  at construction, then returns the registry-verdict pusher. */
export function createLspStatusReporter(deps: { bridge: Bridge; projectPath: string }): LspStatusReporter {
  const { bridge, projectPath } = deps;

  // Push the GDScript LSP verdict to the editor dock (editor.set_lsp_status) —
  // the editor can't read its own LSP bind status, so the server reports it.
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
  // Counts verified verdicts, NOT pushes: it is bumped before the de-dupe check, so
  // a verdict that merely confirms the current key still registers. A registry
  // verdict resolving later compares this to the value it captured at launch, which
  // lastLspKey alone cannot express — a confirming verified verdict leaves the key
  // byte-identical, and the registry verdict would then overwrite verified truth.
  let verifiedVerdicts = 0;
  setLspStatusReporter((s: LspStatus) => {
    verifiedVerdicts++;
    const key = `${s.state}:${s.host}:${s.port}`;
    if (key === lastLspKey) return;
    lastLspKey = key;
    sendLspStatus(s);
  });
  // Version-tailored LSP conflict hints (4.5 auto-rebind vs distinct-port everywhere else).
  setGodotVersionGetter(() => bridge.getGodotVersion());

  return {
    /** On bridge connect/reconnect: push the registry verdict (resolution only, no
     *  LSP handshake) so a freshly-connected editor gets the current status; later
     *  LSP tool calls refine it with the verified result. */
    reportRegistryVerdict(): void {
      // Fire-and-forget: computing the verdict probes peer WS ports, so it is
      // async, but a dock status push must never delay or fail the bridge connect
      // that triggered it.
      const verdictsAtLaunch = verifiedVerdicts;
      void getLspStatus(projectPath)
        .then((s) => {
          // Any verified verdict that landed while the probes were in flight came
          // from a real connection, so it outranks this one — drop ours rather than
          // regress the dock to a registry-derived guess. A single fail-closed
          // indeterminate probe is enough to turn this verdict into `conflict`.
          if (verifiedVerdicts !== verdictsAtLaunch) return;
          lastLspKey = `${s.state}:${s.host}:${s.port}`;
          sendLspStatus(s);
        })
        .catch(() => {});
    },
  };
}

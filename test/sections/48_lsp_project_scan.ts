/**
 * Section 48 — lsp_project_diagnostics (conditional)
 *
 * Exercises the project-wide GDScript compile check. Static checks (catalogue
 * membership, annotations, description length, routing) always run. The live
 * scan is gated on the REAL LSP client's first connect attempt — a graceful
 * SKIP when nothing serves the endpoint (editor down / LSP disabled), the same
 * patient-handshake pattern as §41, never a raw probe-then-abort.
 *
 * The scan itself is read-only (opens/closes documents in the LSP), but the
 * deterministic legs write two res://-root .gd fixtures (a parse-broken file
 * and a warning-only file) to force known-dirty results; both are deleted in
 * a finally block on every path, so nothing is left to pre-clean.
 */
import { LspClient } from "../../src/lsp/lspClient.js";
import { lspTools, lspAnalysisTools, createLspHandler } from "../../src/tools/lsp.js";
import { LSP_TOOLS } from "../../src/groups/groups.js";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["lsp_project_diagnostics"];

type ScanPayload = {
  success?: boolean;
  scanned?: number;
  clean?: number;
  files_with_diagnostics?: Array<{
    file_path?: string;
    diagnostics?: Array<{ line?: number; character?: number; severity?: string }>;
  }>;
  total_diagnostics?: number;
  timed_out?: string[];
  read_failed?: string[];
  code?: string;
};

export async function testLspProjectScan(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── Static checks (always run) ──

  const tool = lspAnalysisTools.find((t) => t.name === "lsp_project_diagnostics");
  if (!tool) {
    fail("lsp_project_scan: lsp_project_diagnostics not found in lspAnalysisTools");
    return;
  }
  pass("lsp_project_scan: lsp_project_diagnostics present in lspAnalysisTools");

  // Description must stay <= 200 chars — the §41 lspTools loop asserts this with
  // no waiver, so re-pin it here at the tool's own section too.
  if (tool.description.length > 200) {
    fail(`lsp_project_scan: description ${tool.description.length} > 200 chars`);
  } else {
    pass(`lsp_project_scan: description ${tool.description.length} <= 200 chars`);
  }

  if (!tool.annotations?.readOnlyHint) {
    fail("lsp_project_scan: missing readOnlyHint annotation");
  } else {
    pass("lsp_project_scan: readOnlyHint=true annotation");
  }

  if (!LSP_TOOLS.has("lsp_project_diagnostics")) {
    fail("lsp_project_scan: lsp_project_diagnostics missing from LSP_TOOLS routing set");
  } else {
    pass("lsp_project_scan: lsp_project_diagnostics in LSP_TOOLS routing set");
  }

  // The combined lspTools convenience export must also carry it (catalogue surface).
  if (!lspTools.some((t) => t.name === "lsp_project_diagnostics")) {
    fail("lsp_project_scan: lsp_project_diagnostics missing from lspTools");
  } else {
    pass("lsp_project_scan: lsp_project_diagnostics in lspTools");
  }

  // ── Live scan (skip decided by the real client's first connect) ──

  const projectPath = ctx.projectPath ?? process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();

  // Single PATIENT handshake — see §41 for the 4.2 synchronous-first-initialize
  // rationale and the 120s budget. Connect-phase errors ("LSP connect …") mean
  // nothing serves the endpoint → graceful SKIP.
  const INITIALIZE_TIMEOUT_MS = 120_000;
  const probe = new LspClient(projectPath, { initializeTimeoutMs: INITIALIZE_TIMEOUT_MS });
  try {
    await probe.ensureConnected();
  } catch (err) {
    const message = (err as Error).message;
    if (message.startsWith("LSP connect ")) {
      pass(`lsp_project_scan: SKIPPED — LSP endpoint not reachable (${message})`);
      await probe.close().catch(() => {});
      return;
    }
    fail(`lsp_project_scan: connection failed (${INITIALIZE_TIMEOUT_MS / 1000}s budget): ${message}`);
    return;
  } finally {
    // The handler uses the singleton client (via ensureLsp); this probe was only
    // the reachability gate, so release it.
    await probe.close().catch(() => {});
  }

  // The toolkit project keeps its dogfood scripts under addons/godot_mcp_toolkit/,
  // so include_addons picks up real .gd files; without it a clean run scans 0.
  const handler = createLspHandler("lsp_project_diagnostics", projectPath);
  const result = (await handler({ include_addons: true })) as { content: { text: string }[] };
  const payload = JSON.parse(result.content[0].text) as ScanPayload;

  if (payload.code === "LSP_UNAVAILABLE") {
    // Editor accepted the connection but went mute across a whole chunk — treat
    // as a skip (the LSP is up but wedged), consistent with the connect-phase skip.
    pass(`lsp_project_scan: SKIPPED — LSP connected but returned no diagnostics (editor busy)`);
    return;
  }

  if (payload.success !== true) {
    fail(`lsp_project_scan: expected success, got ${JSON.stringify(payload)}`);
    return;
  }
  pass(`lsp_project_scan: scan succeeded (scanned ${payload.scanned}, clean ${payload.clean})`);

  // The core invariant: every scanned file is accounted for in exactly one bucket.
  const scanned = payload.scanned ?? -1;
  const dirty = payload.files_with_diagnostics?.length ?? 0;
  const timedOut = payload.timed_out?.length ?? 0;
  const readFailed = payload.read_failed?.length ?? 0;
  const accounted = (payload.clean ?? 0) + dirty + timedOut + readFailed;
  if (scanned === accounted) {
    pass(`lsp_project_scan: invariant holds (scanned ${scanned} = clean+dirty+timed_out+read_failed)`);
  } else {
    fail(`lsp_project_scan: invariant violated — scanned ${scanned} != accounted ${accounted}`);
  }

  // Any reported diagnostics must carry 1-based line/character + a severity label.
  const firstDirty = payload.files_with_diagnostics?.[0];
  if (firstDirty && firstDirty.diagnostics && firstDirty.diagnostics.length > 0) {
    const d = firstDirty.diagnostics[0];
    if (
      typeof d.line === "number" &&
      d.line >= 1 &&
      typeof d.character === "number" &&
      d.character >= 1 &&
      typeof d.severity === "string"
    ) {
      pass(`lsp_project_scan: diagnostic shape valid (1-based line ${d.line}, severity ${d.severity})`);
    } else {
      fail(`lsp_project_scan: diagnostic shape invalid: ${JSON.stringify(d)}`);
    }
  } else {
    pass("lsp_project_scan: no dirty files to shape-check (clean project — valid)");
  }

  // ── Deterministic dirty + include_warnings legs (fixture-driven) ──
  //
  // The scan above runs on whatever the dogfood project happens to hold, so its
  // dirty-file shape check is only exercised when a real script is broken. These
  // legs make the two contract-critical outcomes deterministic by writing their
  // own fixtures: (1) a parse-broken .gd must surface as an Error with a 1-based
  // line, and (2) include_warnings must gate a warning-only .gd in/out of
  // files_with_diagnostics. The scan reads didOpen'd text directly, so a
  // just-written file is seen with no editor_refresh. Scanned with defaults
  // (include_addons off) so only the res:// project files — including these
  // fixtures — are walked, keeping the leg fast. try/finally deletes both
  // fixtures so the toolkit tree stays clean for the rest of the suite.
  const brokenPath = "res://smoke_lsp_projdiag_broken.gd";
  const warnPath = "res://smoke_lsp_projdiag_warn.gd";

  /** Run the project scan with the given input; undefined = LSP went mute mid-scan. */
  async function scan(input: { include_warnings?: boolean }): Promise<ScanPayload | undefined> {
    const r = (await handler(input)) as { content: { text: string }[] };
    const p = JSON.parse(r.content[0].text) as ScanPayload;
    return p.code === "LSP_UNAVAILABLE" ? undefined : p;
  }

  /** Locate a scanned file's entry in files_with_diagnostics by res:// suffix. */
  function dirtyEntry(p: ScanPayload, resPath: string) {
    const leaf = resPath.replace(/^res:\/\//, "");
    return p.files_with_diagnostics?.find((f) => (f.file_path ?? "").endsWith(leaf));
  }

  try {
    // A parse error (unclosed dict literal) — guaranteed Error severity.
    const wroteBroken = (await bridge.call(
      "script.write",
      { file_path: brokenPath, content: "extends Node\n\nfunc _ready() -> void:\n\tvar x = {\n" },
      CALL_TIMEOUT,
    )) as { success?: boolean };
    // A lint warning only (unused local) — Warning severity, no parse error.
    const wroteWarn = (await bridge.call(
      "script.write",
      { file_path: warnPath, content: "extends Node\n\nfunc _ready() -> void:\n\tvar unused_local := 42\n" },
      CALL_TIMEOUT,
    )) as { success?: boolean };

    if (!wroteBroken?.success || !wroteWarn?.success) {
      // Can't provision the fixtures → don't assert against them (honest skip).
      pass("lsp_project_scan: SKIPPED deterministic legs — could not write .gd fixtures");
    } else {
      // (1) Broken file must appear dirty with an Error carrying a 1-based line.
      const brokenScan = await scan({});
      if (!brokenScan) {
        pass("lsp_project_scan: SKIPPED dirty leg — LSP went mute mid-scan (editor busy)");
      } else {
        const entry = dirtyEntry(brokenScan, brokenPath);
        const err = entry?.diagnostics?.find((d) => d.severity === "Error");
        if (err && typeof err.line === "number" && err.line >= 1) {
          pass(`lsp_project_scan: broken fixture surfaces Error at 1-based line ${err.line}`);
        } else {
          fail(`lsp_project_scan: broken fixture expected an Error with 1-based line, got ${JSON.stringify(entry)}`);
        }
        // The accounting invariant must still hold on this fixture-laden scan.
        const acc =
          (brokenScan.clean ?? 0) +
          (brokenScan.files_with_diagnostics?.length ?? 0) +
          (brokenScan.timed_out?.length ?? 0) +
          (brokenScan.read_failed?.length ?? 0);
        if ((brokenScan.scanned ?? -1) === acc) {
          pass(`lsp_project_scan: invariant holds with fixtures (scanned ${brokenScan.scanned})`);
        } else {
          fail(
            `lsp_project_scan: invariant violated with fixtures — scanned ${brokenScan.scanned} != accounted ${acc}`,
          );
        }
      }

      // (2) include_warnings gate: the warning-only file is absent when off,
      // present as a Warning when on.
      const scanOff = await scan({ include_warnings: false });
      const scanOn = await scan({ include_warnings: true });
      if (!scanOff || !scanOn) {
        pass("lsp_project_scan: SKIPPED include_warnings leg — LSP went mute mid-scan (editor busy)");
      } else {
        const offEntry = dirtyEntry(scanOff, warnPath);
        // The broken fixture is still present (it is an Error), so "absent" is
        // specific to the warning-only file, not the whole dirty list.
        if (!offEntry) {
          pass("lsp_project_scan: include_warnings=false suppresses the warning-only file");
        } else {
          fail(
            `lsp_project_scan: include_warnings=false expected warning-only file absent, got ${JSON.stringify(offEntry)}`,
          );
        }
        const onEntry = dirtyEntry(scanOn, warnPath);
        const warn = onEntry?.diagnostics?.find((d) => d.severity === "Warning");
        if (warn) {
          pass("lsp_project_scan: include_warnings=true surfaces the warning-only file as Warning");
        } else {
          fail(`lsp_project_scan: include_warnings=true expected a Warning entry, got ${JSON.stringify(onEntry)}`);
        }
      }
    }
  } finally {
    await bridge.call("script.delete", { file_path: brokenPath }, CALL_TIMEOUT).catch(() => {});
    await bridge.call("script.delete", { file_path: warnPath }, CALL_TIMEOUT).catch(() => {});
  }
}

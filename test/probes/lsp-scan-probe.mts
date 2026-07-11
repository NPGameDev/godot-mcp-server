// Handler-level LSP scan probe: drives the real lsp_project_diagnostics
// handler (singleton LspClient and all) against a live editor and prints the
// raw result payload — the full error text, not a smoke section's summary of
// its code. Pair with lsp-raw-probe.cjs: raw probe green + this red localizes
// a defect to the client/handler layer; both red points at the editor side.
//
// Usage: node_modules/.bin/tsx test/probes/lsp-scan-probe.mts [projectPath]
//   default project: the dogfood playground
import { createLspHandler } from "../../src/tools/lsp.js";

const projectPath =
  process.argv[2] ?? "C:/Users/nicol/OneDrive/Desktop/Personal/AIWithGodot/godot-mcp-dogfood-playground";

const handler = createLspHandler("lsp_project_diagnostics", projectPath);
const t0 = Date.now();
const result = (await handler({})) as { content: { text: string }[] };
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`[scan-probe] project: ${projectPath}`);
console.log(`[scan-probe] elapsed: ${elapsed}s`);
console.log("[scan-probe] raw payload:");
console.log(JSON.stringify(JSON.parse(result.content[0].text), null, 2));
process.exit(0);

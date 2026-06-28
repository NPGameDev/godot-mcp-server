// lsp_code_analysis group — built-in group definition (data module).
import type { GroupDef } from "../groupTypes.js";

export const lspCodeAnalysisGroup: GroupDef = {
  name: "lsp_code_analysis",
  description: "GDScript diagnostics, symbols, and hover info via the language server",
  tools: ["lsp_diagnostics", "lsp_symbols", "lsp_hover"],
  keywords: [
    "lsp",
    "diagnostics",
    "symbols",
    "hover",
    "type",
    "gdscript",
    "shader",
    "gdshader",
    "errors",
    "warnings",
    "validate",
    "analyze",
  ],
};

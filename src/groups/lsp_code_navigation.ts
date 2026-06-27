// lsp_code_navigation group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const lspCodeNavigationGroup: GroupDef = {
  name: "lsp_code_navigation",
  description: "Code completion, go-to-definition, and find references via the language server",
  tools: ["lsp_completion", "lsp_definition", "lsp_references"],
  keywords: [
    "completion",
    "definition",
    "references",
    "go to definition",
    "find references",
    "autocomplete",
    "navigate",
    "cross-file",
  ],
};

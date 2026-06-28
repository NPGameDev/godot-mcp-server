/**
 * Pure LSP enum → human-readable label mappings: diagnostic severity, symbol
 * kind, and completion-item kind, plus document-symbol tree formatting. Leaf
 * module — zero project dependencies, consumed by the LSP tool layer.
 */

/** Severity number → human-readable label. */
export function severityLabel(severity: number): string {
  switch (severity) {
    case 1:
      return "Error";
    case 2:
      return "Warning";
    case 3:
      return "Information";
    case 4:
      return "Hint";
    default:
      return "Unknown";
  }
}

export function formatSymbol(sym: unknown): Record<string, unknown> {
  const s = sym as {
    name?: string;
    kind?: number;
    range?: { start?: { line?: number }; end?: { line?: number } };
    children?: unknown[];
  };
  const result: Record<string, unknown> = {
    name: s.name ?? "",
    kind: symbolKindLabel(s.kind),
    start_line: (s.range?.start?.line ?? 0) + 1,
    end_line: (s.range?.end?.line ?? 0) + 1,
  };
  if (s.children && s.children.length > 0) {
    result.children = s.children.map(formatSymbol);
  }
  return result;
}

export function symbolKindLabel(kind?: number): string {
  const kinds: Record<number, string> = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Constructor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Constant",
    15: "String",
    16: "Number",
    17: "Boolean",
    18: "Array",
    19: "Object",
    20: "Key",
    21: "Null",
    22: "EnumMember",
    23: "Struct",
    24: "Event",
    25: "Operator",
    26: "TypeParameter",
  };
  return kinds[kind ?? 0] ?? "Unknown";
}

export function completionKindLabel(kind?: number): string {
  const kinds: Record<number, string> = {
    1: "Text",
    2: "Method",
    3: "Function",
    4: "Constructor",
    5: "Field",
    6: "Variable",
    7: "Class",
    8: "Interface",
    9: "Module",
    10: "Property",
    11: "Unit",
    12: "Value",
    13: "Enum",
    14: "Keyword",
    15: "Snippet",
    16: "Color",
    17: "File",
    18: "Reference",
    19: "Folder",
    20: "EnumMember",
    21: "Constant",
    22: "Struct",
    23: "Event",
    24: "Operator",
    25: "TypeParameter",
  };
  return kinds[kind ?? 0] ?? "Unknown";
}

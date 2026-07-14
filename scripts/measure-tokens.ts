#!/usr/bin/env tsx
/**
 * Token measurement — quantifies MCP catalogue (tools/list) costs per surface.
 *
 * Run: `npm run measure:tokens` (never bare `npx`).
 *
 * Outputs a Markdown report with per-surface catalogue sizes, per-tool
 * breakdowns, and version-annotation overhead. Surfaces:
 *   - startup surface — eager tools + both meta tools (discover_tools, extensions_refresh)
 *   - full surface — startup + every on-demand group tool
 *   - read-only mode — mutating tools hidden
 *
 * The cost is the actual `tools/list` payload the server sends: the Zod shapes
 * converted to JSON Schema exactly as the MCP SDK serializes them (the server
 * applies no separate schema minification). Rerun after adding or modifying tools.
 */

// Dynamic imports.
const { z } = await import("zod");
const { EAGER_TOOLS, isAllowedInReadOnly } = await import("../src/security/profiles.js");
const { GROUPS } = await import("../src/groups/groups.js");
const { ALL_TOOL_DEFS } = await import("../src/registration/catalogue.js");

// ── Types ────────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  godotMinVersion?: string;
  godotMaxVersion?: string;
}

interface McpToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

interface ToolMeasurement {
  name: string;
  descriptionLen: number;
  schemaBytes: number;
  totalBytes: number;
  hasVersionAnnotation: boolean;
}

interface SurfaceCost {
  toolCount: number;
  totalBytes: number;
  estimatedTokens: number;
}

// ── Collect all tool definitions ─────────────────────────────────────
// Single-sourced from the canonical catalogue (ALL_TOOL_DEFS) so the measured
// set can never drift from --tools-count or the runtime surface.

const ALL_DEFS: readonly ToolDef[] = ALL_TOOL_DEFS;
const byName = new Map(ALL_DEFS.map((t) => [t.name, t]));

// ── Helpers ──────────────────────────────────────────────────────────

function toJsonSchema(zodShape: Record<string, unknown>): Record<string, unknown> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return z.toJSONSchema(z.object(zodShape as any)) as Record<string, unknown>;
  } catch {
    return { type: "object", properties: {} };
  }
}

function toMcpEntry(tool: ToolDef): McpToolEntry {
  const entry: McpToolEntry = {
    name: tool.name,
    description: tool.description,
    inputSchema: toJsonSchema(tool.inputSchema),
  };
  if (tool.annotations) entry.annotations = tool.annotations;
  return entry;
}

function bytes(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

function tokens(b: number): number {
  return Math.ceil(b / 4);
}

function measure(tool: ToolDef): ToolMeasurement {
  const entry = toMcpEntry(tool);
  return {
    name: tool.name,
    descriptionLen: tool.description.length,
    schemaBytes: bytes(entry.inputSchema),
    totalBytes: bytes(entry),
    hasVersionAnnotation: tool.godotMinVersion != null || tool.godotMaxVersion != null,
  };
}

function surfaceCost(defs: ToolDef[], extras: McpToolEntry[] = []): SurfaceCost {
  const all = [...defs.map(toMcpEntry), ...extras];
  const b = bytes(all);
  return { toolCount: all.length, totalBytes: b, estimatedTokens: tokens(b) };
}

// ── Synthetic meta-tool entries ─────────────────────────────────────
// The two always-on meta tools (discover_tools, extensions_refresh) are
// registered outside the ToolDef arrays, so they are defined here to measure
// the startup surface accurately (eager + both meta tools, matching the
// --tools-count "Startup surface" definition).

const DISCOVER_TOOLS_ENTRY: McpToolEntry = {
  name: "discover_tools",
  description:
    "Search and activate tool groups by keyword or name. " +
    "Pass request to search by domain ('animation', 'save game data') or groups to activate by name. " +
    "No params → full catalog. reset: true → deactivate all groups.",
  inputSchema: {
    type: "object",
    properties: {
      request: {
        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        description: "Search by keyword — a domain, task, or Godot concept.",
      },
      groups: {
        type: "array",
        items: { type: "string" },
        description: "Group names to activate: " + GROUPS.map((g) => g.name).join(", "),
      },
      activate: { type: "boolean", description: "Auto-activate matching groups. Default true." },
      reset: {
        anyOf: [{ const: true }, { type: "array", items: { type: "string" } }],
        description: "Deactivate groups. true = reset all.",
      },
    },
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

const EXTENSIONS_REFRESH_ENTRY: McpToolEntry = {
  name: "extensions_refresh",
  description:
    "Force a filesystem rescan and re-discover extension scripts. " +
    "Call after creating, modifying, or deleting extension files from outside the Godot editor. " +
    "Returns the updated list of extension commands.",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, idempotentHint: true },
};

const META_ENTRIES: McpToolEntry[] = [DISCOVER_TOOLS_ENTRY, EXTENSIONS_REFRESH_ENTRY];

// ── Build surface catalogues ─────────────────────────────────────────

// Read-only mode: tools with readOnlyHint: true (annotation-derived, no hardcoded list).
const readOnlyDefs = ALL_DEFS.filter((t) => isAllowedInReadOnly(t.annotations));

// Startup surface: the eager tools (+ both meta tools, added as extras).
const startupDefs = EAGER_TOOLS.map((n) => byName.get(n)).filter(Boolean) as ToolDef[];

// Group tools loaded on demand.
const groupToolNames = new Set(GROUPS.flatMap((g) => g.tools));
const groupDefs = ALL_DEFS.filter((t) => groupToolNames.has(t.name));

// ── Measure everything ───────────────────────────────────────────────

const allMeasurements = ALL_DEFS.map(measure);

const startup = surfaceCost(startupDefs, META_ENTRIES);
const fullSurface = surfaceCost([...startupDefs, ...groupDefs], META_ENTRIES);
const readOnly = surfaceCost(readOnlyDefs);

const versionAnnotatedTools = ALL_DEFS.filter((t) => t.godotMinVersion != null || t.godotMaxVersion != null);

// ── Generate report ──────────────────────────────────────────────────

const out: string[] = [];
const emit = (s: string): void => {
  out.push(s);
};

emit("# Token Efficiency Report");
emit("");
emit(`> Generated ${new Date().toISOString().slice(0, 10)} — rerun with \`npm run measure:tokens\``);
emit("");

emit("## Catalogue cost by surface");
emit("");
emit(
  "Token estimates use the standard chars/4 heuristic. The cost is the JSON-Schema `tools/list` payload the SDK sends.",
);
emit("");
emit("| Surface | Tools | Bytes | Est. tokens |");
emit("|---------|------:|------:|------------:|");
emit(
  `| Startup surface | ${startup.toolCount} | ${startup.totalBytes.toLocaleString()} | ~${startup.estimatedTokens.toLocaleString()} |`,
);
emit(
  `| Full surface | ${fullSurface.toolCount} | ${fullSurface.totalBytes.toLocaleString()} | ~${fullSurface.estimatedTokens.toLocaleString()} |`,
);
emit(
  `| Read-only mode | ${readOnly.toolCount} | ${readOnly.totalBytes.toLocaleString()} | ~${readOnly.estimatedTokens.toLocaleString()} |`,
);
emit("");

emit("## Surface recommendations");
emit("");
emit("| Use case | Recommended surface | Why |");
emit("|----------|--------------------:|-----|");
emit(
  `| Code review / exploration | Read-only mode (${readOnly.estimatedTokens.toLocaleString()} tokens) | Read-only tools cover scene inspection, script reading, class lookup |`,
);
emit(
  `| Day-to-day development | Startup surface (${startup.estimatedTokens.toLocaleString()} tokens) | Core editing tools + on-demand groups for specialized work |`,
);
emit(
  `| Full engine access | Full surface (${fullSurface.estimatedTokens.toLocaleString()} tokens) | All tools including unsafe operations; use with awareness |`,
);
emit("");

emit("## On-demand group costs (startup surface)");
emit("");
emit("Groups are loaded via `discover_tools` and persist for the session.");
emit("");
emit("| Group | Tools | Incremental bytes | Incremental tokens |");
emit("|-------|------:|------------------:|-------------------:|");
for (const group of GROUPS) {
  const groupEntries = group.tools
    .map((n) => byName.get(n))
    .filter((t): t is ToolDef => t !== undefined)
    .map(toMcpEntry);
  const groupBytes = bytes(groupEntries);
  emit(
    `| ${group.name} | ${group.tools.length} | ${groupBytes.toLocaleString()} | ~${tokens(groupBytes).toLocaleString()} |`,
  );
}
emit("");

emit("## Per-tool breakdown (sorted by size)");
emit("");
emit("| Tool | Desc len | Schema bytes | Total bytes | Est. tokens |");
emit("|------|---------:|-------------:|------------:|------------:|");
const sorted = [...allMeasurements].sort((a, b) => b.totalBytes - a.totalBytes);
for (const m of sorted) {
  emit(`| ${m.name} | ${m.descriptionLen} | ${m.schemaBytes} | ${m.totalBytes} | ~${tokens(m.totalBytes)} |`);
}
emit("");

const heaviest = sorted[0];
const lightest = sorted[sorted.length - 1];
const avgBytes = Math.round(sorted.reduce((s, m) => s + m.totalBytes, 0) / sorted.length);
const avgDesc = Math.round(sorted.reduce((s, m) => s + m.descriptionLen, 0) / sorted.length);
emit("## Extremes");
emit("");
emit(
  `- **Heaviest tool:** \`${heaviest.name}\` — ${heaviest.totalBytes} bytes (~${tokens(heaviest.totalBytes)} tokens)`,
);
emit(
  `- **Lightest tool:** \`${lightest.name}\` — ${lightest.totalBytes} bytes (~${tokens(lightest.totalBytes)} tokens)`,
);
emit(`- **Average:** ${avgBytes} bytes (~${tokens(avgBytes)} tokens) per tool`);
emit(
  `- **Description lengths:** avg ${avgDesc} chars, max ${Math.max(...sorted.map((m) => m.descriptionLen))} chars (I2 limit: 200)`,
);
emit("");

emit("## Version annotation overhead");
emit("");
emit(`${versionAnnotatedTools.length} tool(s) carry version-gate annotations:`);
emit("");
for (const t of versionAnnotatedTools) {
  const bounds: string[] = [];
  if (t.godotMinVersion) bounds.push(`min ${t.godotMinVersion}`);
  if (t.godotMaxVersion) bounds.push(`max ${t.godotMaxVersion}`);
  emit(`- \`${t.name}\` — ${bounds.join(", ")}`);
}
emit("");
emit("Version gating happens at registration time — incompatible tools never appear in `tools/list`.");
emit("");

emit("## Methodology");
emit("");
emit(
  "- **Schema conversion:** Zod schemas → JSON Schema via `z.toJSONSchema()` (Zod 4 built-in), matching the MCP wire format",
);
emit("- **Byte measurement:** UTF-8 encoded `JSON.stringify()` of the tools array");
emit("- **Token estimate:** bytes / 4 (standard heuristic; actual tokenization varies by model)");
emit(
  "- **Measurement scope:** MCP `tools/list` response payload only (excludes JSON-RPC envelope, prompts, resources)",
);
emit("");

console.log(out.join("\n"));

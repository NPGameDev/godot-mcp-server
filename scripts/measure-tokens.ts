#!/usr/bin/env tsx
/**
 * Token measurement — quantifies MCP catalogue (tools/list) costs per profile.
 *
 * Usage: node_modules/.bin/tsx scripts/measure-tokens.ts
 *
 * Outputs a markdown report with per-profile catalogue sizes, per-tool
 * breakdowns, minification savings, and version-annotation overhead.
 * Rerun after adding or modifying tools to check impact.
 */

// Dynamic imports.
const { z } = await import("zod");
const { minifySchema } = await import("../src/schema_min.js");
const { EAGER_TOOLS, isAllowedInReadOnly } = await import("../src/security/profiles.js");
const { GROUPS } = await import("../src/groups.js");

const { animationTools } = await import("../src/tools/animation.js");
const { assetTools } = await import("../src/tools/asset.js");
const { classdbTools } = await import("../src/tools/classdb.js");
const { diffTools } = await import("../src/tools/diff.js");
const { editorTools } = await import("../src/tools/editor.js");
const { fileTools } = await import("../src/tools/file.js");
const { folderTools } = await import("../src/tools/folder.js");
const { inputMapTools } = await import("../src/tools/input_map.js");
const { nodeTools } = await import("../src/tools/node.js");
const { playtestTools } = await import("../src/tools/playtest.js");
const { resourceTools } = await import("../src/tools/resource.js");
const { runtimeTools } = await import("../src/tools/runtime.js");
const { saveTools } = await import("../src/tools/save.js");
const { sceneTools } = await import("../src/tools/scene.js");
const { scriptTools } = await import("../src/tools/script.js");
const { signalTools } = await import("../src/tools/signals.js");
const { tilemapTools } = await import("../src/tools/tilemap.js");

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
  totalBytesMinified: number;
  hasVersionAnnotation: boolean;
}

// ── Collect all tool definitions ─────────────────────────────────────

const ALL_DEFS: ToolDef[] = [
  ...animationTools,
  ...assetTools,
  ...classdbTools,
  ...diffTools,
  ...editorTools,
  ...fileTools,
  ...folderTools,
  ...inputMapTools,
  ...nodeTools,
  ...playtestTools,
  ...resourceTools,
  ...runtimeTools,
  ...saveTools,
  ...sceneTools,
  ...scriptTools,
  ...signalTools,
  ...tilemapTools,
] as ToolDef[];

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

function toMcpEntry(tool: ToolDef, minify = false): McpToolEntry {
  let schema = toJsonSchema(tool.inputSchema);
  if (minify) schema = minifySchema(schema);
  const entry: McpToolEntry = { name: tool.name, description: tool.description, inputSchema: schema };
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
  const entryMin = toMcpEntry(tool, true);
  return {
    name: tool.name,
    descriptionLen: tool.description.length,
    schemaBytes: bytes(entry.inputSchema),
    totalBytes: bytes(entry),
    totalBytesMinified: bytes(entryMin),
    hasVersionAnnotation: tool.godotMinVersion != null || tool.godotMaxVersion != null,
  };
}

// ── Synthetic entry (discover_tools) ────────────────────────────────
// discover_tools is defined inline in groups.ts and doesn't appear in
// the ToolDef arrays. We define it here for accurate standard-profile
// measurement.

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

// ── Build profile catalogues ─────────────────────────────────────────

// Read-only: tools with readOnlyHint: true (annotation-derived, no hardcoded list)
const readOnlyDefs = ALL_DEFS.filter((t) => isAllowedInReadOnly(t.annotations));

// Standard (default): EAGER_TOOLS + discover_tools
const standardDefs = EAGER_TOOLS.map((n) => byName.get(n)).filter(Boolean) as ToolDef[];

// Full: every tool from every module
const fullDefs = ALL_DEFS;

// Group tools available on-demand in standard profile
const groupToolNames = new Set(GROUPS.flatMap((g) => g.tools));
const groupDefs = ALL_DEFS.filter((t) => groupToolNames.has(t.name));

// ── Measure everything ───────────────────────────────────────────────

const allMeasurements = ALL_DEFS.map(measure);
const measurementByName = new Map(allMeasurements.map((m) => [m.name, m]));

function profileCost(
  defs: ToolDef[],
  extras: McpToolEntry[] = [],
  minify = false,
): { toolCount: number; totalBytes: number; estimatedTokens: number } {
  const toolEntries = defs.map((t) => toMcpEntry(t, minify));
  const all = [...toolEntries, ...extras];
  const catalogue = JSON.stringify(all);
  const b = new TextEncoder().encode(catalogue).length;
  return { toolCount: all.length, totalBytes: b, estimatedTokens: tokens(b) };
}

const readOnly = profileCost(readOnlyDefs);
const readOnlyMin = profileCost(readOnlyDefs, [], true);
const standard = profileCost(standardDefs, [DISCOVER_TOOLS_ENTRY]);
const standardMin = profileCost(standardDefs, [DISCOVER_TOOLS_ENTRY], true);
const full = profileCost(fullDefs);
const fullMin = profileCost(fullDefs, [], true);

// Standard + all groups loaded
const standardWithGroups = profileCost([...standardDefs, ...groupDefs], [DISCOVER_TOOLS_ENTRY]);
const standardWithGroupsMin = profileCost([...standardDefs, ...groupDefs], [DISCOVER_TOOLS_ENTRY], true);

// Version annotation overhead: compare full catalogue with and without
// version-gated tools' extra annotation data
const versionAnnotatedTools = ALL_DEFS.filter((t) => t.godotMinVersion != null || t.godotMaxVersion != null);

// ── Generate report ──────────────────────────────────────────────────

const out: string[] = [];
const emit = (s: string) => out.push(s);

emit("# Token Efficiency Report");
emit("");
emit(
  `> Generated ${new Date().toISOString().slice(0, 10)} — rerun with \`node_modules/.bin/tsx scripts/measure-tokens.ts\``,
);
emit("");

// Summary table
emit("## Catalogue cost by profile");
emit("");
emit("Token estimates use the standard chars/4 heuristic.");
emit("");
emit("| Profile | Tools | Bytes | Est. tokens | Minified bytes | Minified tokens | Savings |");
emit("|---------|------:|------:|------------:|---------------:|----------------:|--------:|");
emit(
  `| Read-only | ${readOnly.toolCount} | ${readOnly.totalBytes.toLocaleString()} | ~${readOnly.estimatedTokens.toLocaleString()} | ${readOnlyMin.totalBytes.toLocaleString()} | ~${readOnlyMin.estimatedTokens.toLocaleString()} | ${pct(readOnly.totalBytes, readOnlyMin.totalBytes)} |`,
);
emit(
  `| Standard | ${standard.toolCount} | ${standard.totalBytes.toLocaleString()} | ~${standard.estimatedTokens.toLocaleString()} | ${standardMin.totalBytes.toLocaleString()} | ~${standardMin.estimatedTokens.toLocaleString()} | ${pct(standard.totalBytes, standardMin.totalBytes)} |`,
);
emit(
  `| Standard + all groups | ${standardWithGroups.toolCount} | ${standardWithGroups.totalBytes.toLocaleString()} | ~${standardWithGroups.estimatedTokens.toLocaleString()} | ${standardWithGroupsMin.totalBytes.toLocaleString()} | ~${standardWithGroupsMin.estimatedTokens.toLocaleString()} | ${pct(standardWithGroups.totalBytes, standardWithGroupsMin.totalBytes)} |`,
);
emit(
  `| Power User | ${full.toolCount} | ${full.totalBytes.toLocaleString()} | ~${full.estimatedTokens.toLocaleString()} | ${fullMin.totalBytes.toLocaleString()} | ~${fullMin.estimatedTokens.toLocaleString()} | ${pct(full.totalBytes, fullMin.totalBytes)} |`,
);
emit("");

// Profile recommendations
emit("## Profile recommendations");
emit("");
emit("| Use case | Recommended profile | Why |");
emit("|----------|--------------------:|-----|");
emit(
  `| Code review / exploration | Read-only (${readOnlyMin.estimatedTokens.toLocaleString()} tokens) | Read-only tools cover scene inspection, script reading, class lookup |`,
);
emit(
  `| Day-to-day development | Standard (${standardMin.estimatedTokens.toLocaleString()} tokens) | Core editing tools + on-demand groups for specialized work |`,
);
emit(
  `| Full engine access | Power User (${fullMin.estimatedTokens.toLocaleString()} tokens) | All tools including unsafe operations; use with awareness |`,
);
emit("");

// On-demand groups
emit("## On-demand group costs (standard profile)");
emit("");
emit("Groups are loaded via `discover_tools` and persist for the session.");
emit("");
emit("| Group | Tools | Incremental bytes | Incremental tokens |");
emit("|-------|------:|------------------:|-------------------:|");
for (const group of GROUPS) {
  const groupMeasurements = group.tools
    .map((n) => byName.get(n))
    .filter(Boolean)
    .map((t) => toMcpEntry(t!, true));
  const groupBytes = bytes(groupMeasurements);
  emit(
    `| ${group.name} | ${group.tools.length} | ${groupBytes.toLocaleString()} | ~${tokens(groupBytes).toLocaleString()} |`,
  );
}
emit("");

// Per-tool breakdown (sorted by total size, minified)
emit("## Per-tool breakdown (minified, sorted by size)");
emit("");
emit("| Tool | Desc len | Schema bytes | Total bytes | Est. tokens |");
emit("|------|----------|-------------|-------------|-------------|");
const sorted = [...allMeasurements].sort((a, b) => b.totalBytesMinified - a.totalBytesMinified);
for (const m of sorted) {
  emit(
    `| ${m.name} | ${m.descriptionLen} | ${m.schemaBytes} | ${m.totalBytesMinified} | ~${tokens(m.totalBytesMinified)} |`,
  );
}
emit("");

// Heaviest and lightest
const heaviest = sorted[0];
const lightest = sorted[sorted.length - 1];
emit("## Extremes");
emit("");
emit(
  `- **Heaviest tool:** \`${heaviest.name}\` — ${heaviest.totalBytesMinified} bytes (~${tokens(heaviest.totalBytesMinified)} tokens)`,
);
emit(
  `- **Lightest tool:** \`${lightest.name}\` — ${lightest.totalBytesMinified} bytes (~${tokens(lightest.totalBytesMinified)} tokens)`,
);
emit(
  `- **Average:** ${Math.round(sorted.reduce((s, m) => s + m.totalBytesMinified, 0) / sorted.length)} bytes (~${tokens(Math.round(sorted.reduce((s, m) => s + m.totalBytesMinified, 0) / sorted.length))} tokens) per tool`,
);
emit(
  `- **Description lengths:** avg ${Math.round(sorted.reduce((s, m) => s + m.descriptionLen, 0) / sorted.length)} chars, max ${Math.max(...sorted.map((m) => m.descriptionLen))} chars (I2 limit: 200)`,
);
emit("");

// Version annotation overhead
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
// Version fields are strings in the ToolDef ("major.minor" format).
// The server filters at registration time — incompatible tools never
// appear in tools/list.
const vAnnotated = versionAnnotatedTools.map(measure);
const totalVersionDescOverhead = vAnnotated.reduce((s, m) => {
  return s + m.descriptionLen;
}, 0);
emit(`Total description bytes for version-annotated tools: ${totalVersionDescOverhead}`);
emit(`Version gating is done at registration time — incompatible tools are excluded from tools/list entirely.`);
emit("");

// Minification detail
emit("## Schema minification impact");
emit("");
emit("Minification applies these transforms to inputSchema:");
emit("- Drop `additionalProperties: false`");
emit("- Drop `$schema` keys");
emit("- Compress parameter descriptions to first sentence (<=80 chars)");
emit("- Remove empty `required` arrays");
emit("");
emit("| Profile | Before | After | Saved | Reduction |");
emit("|---------|-------:|------:|------:|----------:|");
emit(
  `| Read-only | ${readOnly.totalBytes.toLocaleString()} | ${readOnlyMin.totalBytes.toLocaleString()} | ${(readOnly.totalBytes - readOnlyMin.totalBytes).toLocaleString()} | ${pct(readOnly.totalBytes, readOnlyMin.totalBytes)} |`,
);
emit(
  `| Standard | ${standard.totalBytes.toLocaleString()} | ${standardMin.totalBytes.toLocaleString()} | ${(standard.totalBytes - standardMin.totalBytes).toLocaleString()} | ${pct(standard.totalBytes, standardMin.totalBytes)} |`,
);
emit(
  `| Power User | ${full.totalBytes.toLocaleString()} | ${fullMin.totalBytes.toLocaleString()} | ${(full.totalBytes - fullMin.totalBytes).toLocaleString()} | ${pct(full.totalBytes, fullMin.totalBytes)} |`,
);
emit("");

// Methodology
emit("## Methodology");
emit("");
emit("- **Schema conversion:** Zod schemas → JSON Schema via `z.toJSONSchema()` (Zod 4 built-in)");
emit("- **Byte measurement:** UTF-8 encoded `JSON.stringify()` of the tools array");
emit("- **Token estimate:** bytes / 4 (standard heuristic; actual tokenization varies by model)");
emit("- **Minification:** `minifySchema()` from `src/schema_min.ts` applied to inputSchema objects");
emit(
  "- **Measurement scope:** MCP `tools/list` response payload only (excludes JSON-RPC envelope, prompts, resources)",
);
emit("");

console.log(out.join("\n"));

// ── Helpers ──────────────────────────────────────────────────────────

function pct(before: number, after: number): string {
  const saved = ((before - after) / before) * 100;
  return `${saved.toFixed(1)}%`;
}

#!/usr/bin/env tsx
/**
 * Tool-reference generator — emits docs/tool-reference/README.md from the
 * canonical tool catalogue so the browsable per-tool reference can never drift
 * from the actual surface.
 *
 * Run: `npm run docs:tools` (never bare `npx`).
 *
 * The output is committed generated Markdown, so it is produced deterministically:
 * no timestamps, commit SHAs, environment, or unsorted map order leak in, and
 * regenerating with an unchanged source yields a byte-identical file. Hand-curated
 * example payloads live inside protected `<!-- examples:start -->…<!-- examples:end -->`
 * islands, keyed per tool, that survive regeneration verbatim.
 *
 * Structure: a pure {@link buildDoc} core that turns the catalogue (plus any
 * existing file's islands) into the document string, and a thin {@link main} that
 * reads the current file, calls buildDoc, and writes the result.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { ALL_TOOL_DEFS } from "../src/registration/catalogue.js";
import { GROUPS } from "../src/groups/groupCatalogue.js";
import { EAGER_TOOLS } from "../src/security/profiles.js";
import { countBuiltinOperations, operationCountOf, operationsOf } from "../src/registration/operations.js";
import type { ToolDef } from "../src/shared/types.js";

// ── Output location ──────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(HERE, "../docs/tool-reference/README.md");

// ── Document model ───────────────────────────────────────────────────

/** One section of the reference — a group, or the eager/meta startup surface. */
interface Section {
  title: string;
  description?: string;
  tools: readonly ToolDef[];
}

/** A single JSON-Schema property as rendered into the params table. */
interface ParamRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

// ── Pure builder ─────────────────────────────────────────────────────

/**
 * Build the whole tool-reference document from the catalogue.
 *
 * @param defs the canonical catalogue (`ALL_TOOL_DEFS`)
 * @param groups the ordered built-in group catalogue (`GROUPS`)
 * @param eager the eager tool-name set (startup surface)
 * @param existingContent the current file's text, if any — its example islands are
 *   preserved verbatim in the output
 * @returns the complete Markdown document
 * @remarks Deterministic by construction: sections follow the `defs`/`groups`
 *   declared order, param rows are sorted by name, and no volatile value is emitted.
 */
export function buildDoc(
  defs: readonly ToolDef[],
  groups: readonly { name: string; description?: string; tools: readonly string[] }[],
  eager: ReadonlySet<string>,
  existingContent?: string,
): string {
  const byName = new Map(defs.map((t) => [t.name, t]));
  const islands = existingContent ? parseIslands(existingContent) : new Map<string, string>();
  const sections = buildSections(defs, groups, eager, byName);

  const lines: string[] = [];
  emitHeader(lines, defs);
  for (const section of sections) emitSection(lines, section, eager, groups, islands);
  return lines.join("\n") + "\n";
}

/** Partition the catalogue into the startup (eager) section plus one section per group. */
function buildSections(
  defs: readonly ToolDef[],
  groups: readonly { name: string; description?: string; tools: readonly string[] }[],
  eager: ReadonlySet<string>,
  byName: ReadonlyMap<string, ToolDef>,
): Section[] {
  const sections: Section[] = [];

  const eagerTools = defs.filter((t) => eager.has(t.name));
  sections.push({
    title: "Startup surface (eager)",
    description:
      "Registered up front — always in the initial `tools/list`. The two meta tools " +
      "(`discover_tools`, `extensions_refresh`) are also eager but defined outside the catalogue.",
    tools: eagerTools,
  });

  for (const group of groups) {
    const groupTools = group.tools.map((name) => byName.get(name)).filter((t): t is ToolDef => t !== undefined);
    sections.push({ title: `Group: ${group.name}`, description: group.description, tools: groupTools });
  }
  return sections;
}

// ── Header ───────────────────────────────────────────────────────────

function emitHeader(lines: string[], defs: readonly ToolDef[]): void {
  lines.push("---");
  lines.push("title: Tool Reference");
  lines.push("permalink: /tool-reference/");
  lines.push("nav_order: 3");
  lines.push("---");
  lines.push("");
  lines.push("# Godot MCP Server — Tool Reference");
  lines.push("");
  lines.push(
    "Generated from the tool catalogue (`src/registration/catalogue.ts`) — regenerate with " +
      "`npm run docs:tools`. This is the per-tool **reference**; for the subsystem **explanation** " +
      "see [Architecture](../architecture/README.md).",
  );
  lines.push("");
  lines.push(
    `**${defs.length} built-in tools** exposing **${countBuiltinOperations(defs)} operations** — ` +
      "an action-consolidated tool packs several operations behind one discriminator, so the operation " +
      'count runs ahead of the tool count. Counts are a ceiling ("up to"); some tools and operations ' +
      "are Godot-version-gated and absent on older editors.",
  );
  lines.push("");
}

// ── Sections ─────────────────────────────────────────────────────────

function emitSection(
  lines: string[],
  section: Section,
  eager: ReadonlySet<string>,
  groups: readonly { name: string; tools: readonly string[] }[],
  islands: ReadonlyMap<string, string>,
): void {
  const operationTally = section.tools.reduce((sum, t) => sum + operationCountOf(t), 0);
  lines.push(`## ${section.title}`);
  lines.push("");
  if (section.description) {
    lines.push(section.description);
    lines.push("");
  }
  lines.push(`_${section.tools.length} tool${section.tools.length === 1 ? "" : "s"}, ${operationTally} operations._`);
  lines.push("");
  for (const tool of section.tools) emitTool(lines, tool, eager, groups, islands);
}

// ── Per-tool block ───────────────────────────────────────────────────

function emitTool(
  lines: string[],
  tool: ToolDef,
  eager: ReadonlySet<string>,
  groups: readonly { name: string; tools: readonly string[] }[],
  islands: ReadonlyMap<string, string>,
): void {
  lines.push(`<!-- tool:${tool.name} -->`);
  lines.push(`### \`${tool.name}\``);
  lines.push("");
  lines.push(tool.description.replace(/\r?\n/g, " ").trim());
  lines.push("");

  const badges = toolBadges(tool, eager, groups);
  if (badges.length > 0) {
    lines.push(badges.join(" · "));
    lines.push("");
  }

  emitOperations(lines, tool);
  emitParams(lines, tool);
  emitExampleIsland(lines, tool, islands);
}

/** Fixed-order badge list: surface, group, version gate, annotations. */
function toolBadges(
  tool: ToolDef,
  eager: ReadonlySet<string>,
  groups: readonly { name: string; tools: readonly string[] }[],
): string[] {
  const badges: string[] = [];
  if (eager.has(tool.name)) badges.push("**eager**");
  const group = groups.find((g) => g.tools.includes(tool.name));
  if (group) badges.push(`on-demand (group: \`${group.name}\`)`);
  if (tool.godotMinVersion) badges.push(`Godot ${tool.godotMinVersion}+`);
  if (tool.godotMaxVersion) badges.push(`up to Godot ${tool.godotMaxVersion}`);
  if (tool.annotations?.readOnlyHint) badges.push("read-only");
  if (tool.annotations?.destructiveHint) badges.push("destructive");
  if (tool.annotations?.idempotentHint) badges.push("idempotent");
  return badges;
}

function emitOperations(lines: string[], tool: ToolDef): void {
  const ops = operationsOf(tool);
  if (ops.length === 0) {
    lines.push("_1 operation._");
    lines.push("");
    return;
  }
  const discriminator = tool.operationParam ? `\`${tool.operationParam}\`` : "operation";
  lines.push(`**${ops.length} operations** (${discriminator}): ${ops.map((o) => `\`${o}\``).join(", ")}`);
  lines.push("");
}

function emitParams(lines: string[], tool: ToolDef): void {
  const rows = paramRows(tool);
  if (rows.length === 0) {
    lines.push("_No parameters._");
    lines.push("");
    return;
  }
  lines.push("| Param | Type | Required | Description |");
  lines.push("|-------|------|----------|-------------|");
  for (const row of rows) {
    const required = row.required ? "yes" : "no";
    lines.push(`| \`${row.name}\` | ${row.type} | ${required} | ${escapeCell(row.description)} |`);
  }
  lines.push("");
}

/** Convert a tool's Zod shape to sorted param rows via the codebase JSON-Schema idiom. */
function paramRows(tool: ToolDef): ParamRow[] {
  const json = toJsonSchema(tool.inputSchema);
  const properties = (json.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(Array.isArray(json.required) ? (json.required as string[]) : []);
  return Object.keys(properties)
    .sort()
    .map((name) => ({
      name,
      type: schemaType(properties[name]),
      required: required.has(name),
      description: typeof properties[name].description === "string" ? (properties[name].description as string) : "",
    }));
}

// ── Protected islands ────────────────────────────────────────────────

const ISLAND_START = "<!-- examples:start -->";
const ISLAND_END = "<!-- examples:end -->";
const TOOL_ANCHOR = /^<!-- tool:(.+?) -->$/;

/**
 * Capture the verbatim body of each tool's example island from an existing
 * document, keyed by the tool anchor that owns it. Matching on the anchor (not
 * position) keeps an island bound to its tool across reordering.
 */
function parseIslands(content: string): Map<string, string> {
  const islands = new Map<string, string>();
  const lines = content.split("\n");
  let currentTool: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const anchor = TOOL_ANCHOR.exec(lines[i].trim());
    if (anchor) {
      currentTool = anchor[1];
      continue;
    }
    if (currentTool && lines[i].trim() === ISLAND_START) {
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && lines[j].trim() !== ISLAND_END; j++) body.push(lines[j]);
      islands.set(currentTool, body.join("\n"));
      i = j;
      currentTool = undefined;
    }
  }
  return islands;
}

/** Emit the example island, preserving any captured hand-curated body verbatim. */
function emitExampleIsland(lines: string[], tool: ToolDef, islands: ReadonlyMap<string, string>): void {
  lines.push(ISLAND_START);
  const preserved = islands.get(tool.name);
  if (preserved !== undefined && preserved.length > 0) {
    for (const line of preserved.split("\n")) lines.push(line);
  }
  lines.push(ISLAND_END);
  lines.push("");
}

// ── Schema helpers ───────────────────────────────────────────────────

/** Convert a Zod shape to JSON Schema; an unconvertible shape degrades to an empty object. */
function toJsonSchema(inputSchema: ToolDef["inputSchema"]): Record<string, unknown> {
  try {
    return z.toJSONSchema(z.object(inputSchema)) as Record<string, unknown>;
  } catch {
    return { type: "object", properties: {} };
  }
}

/** A human-readable type label for a JSON-Schema property node. */
function schemaType(node: Record<string, unknown>): string {
  if (Array.isArray(node.enum)) return "enum";
  if (typeof node.type === "string") return node.type;
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) return "union";
  return "any";
}

/** Escape a value for a Markdown table cell: pipes and newlines break table layout. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

// ── Entry point ──────────────────────────────────────────────────────

/** Read the current document (if any) and rebuild it, preserving its islands. */
function render(existing: string | undefined): string {
  return buildDoc(ALL_TOOL_DEFS, GROUPS, new Set(EAGER_TOOLS), existing);
}

function readExisting(): string | undefined {
  try {
    return readFileSync(OUTPUT_PATH, "utf8");
  } catch {
    return undefined; // First run — no file yet.
  }
}

/** Regenerate the document in place. */
function write(): void {
  const doc = render(readExisting());
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, doc, "utf8");
  process.stdout.write(
    `Wrote ${OUTPUT_PATH} (${ALL_TOOL_DEFS.length} tools, ${countBuiltinOperations(ALL_TOOL_DEFS)} operations)\n`,
  );
}

/**
 * Verify the committed document is up to date without writing: rebuild it
 * in memory (preserving its islands) and compare against the on-disk bytes.
 * Exits nonzero on drift — the prettier-`--check` pattern, so a stale generated
 * doc is caught on demand. No filesystem-write or git side effects.
 */
function check(): void {
  const existing = readExisting();
  if (existing === undefined) {
    process.stderr.write(`DRIFT: ${OUTPUT_PATH} does not exist — run \`npm run docs:tools\`\n`);
    process.exit(1);
  }
  const rebuilt = render(existing);
  if (rebuilt === existing) {
    process.stdout.write(`PASS: ${OUTPUT_PATH} is up to date with the catalogue\n`);
    return;
  }
  process.stderr.write(`DRIFT: ${OUTPUT_PATH} is stale — run \`npm run docs:tools\` and commit the result\n`);
  process.exit(1);
}

function main(): void {
  if (process.argv.includes("--check")) check();
  else write();
}

main();

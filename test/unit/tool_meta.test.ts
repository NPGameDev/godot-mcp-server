/**
 * Unit tests for tool_meta.ts — metadata enrichment for discover_tools.
 * Tests enrichGroupResults and enrichCoreMatches with mock data.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import type { ToolDef } from "../../src/types.js";
import type { ExtensionCmd } from "../../src/groups.js";
import { enrichGroupResults, type GroupResult } from "../../src/tool_meta.js";

// ── Test fixtures ────────────────────────────────────────────────────

function makeToolDef(name: string, desc: string, schema: Record<string, z.ZodTypeAny> = {}): ToolDef {
  return {
    name,
    method: `test.${name}`,
    description: desc,
    inputSchema: schema,
    annotations: { readOnlyHint: true },
  };
}

function makeExtCmd(name: string, desc: string): ExtensionCmd {
  return {
    method: `ext.${name}`,
    toolName: name,
    description: desc,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "File path" } },
      required: ["path"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  };
}

const allDefs = new Map<string, ToolDef>([
  ["scene_get_tree", makeToolDef("scene_get_tree", "Get scene tree", { path: z.string().optional() })],
  ["script_read", makeToolDef("script_read", "Read a script", { path: z.string() })],
]);

const extGroupCommands = new Map<string, ExtensionCmd>([["ext_custom", makeExtCmd("ext_custom", "Custom extension")]]);

// ── enrichGroupResults ───────────────────────────────────────────────

// Activated group with include_schemas=true → enriched tools
{
  const results: GroupResult[] = [
    {
      name: "scene",
      status: "activated",
      tools: [{ name: "scene_get_tree" }],
    },
  ];

  const enriched = enrichGroupResults(results, true, allDefs, extGroupCommands);
  assert.equal(enriched.length, 1);
  const tool = enriched[0].tools[0];
  assert.equal(tool.name, "scene_get_tree");
  assert.ok(tool.description, "Should have description");
  assert.ok(tool.parameters, "Should have parameters");
  assert.ok(tool.annotations, "Should have annotations");
}

// Activated group with include_schemas=false → name + description only
{
  const results: GroupResult[] = [
    {
      name: "scene",
      status: "activated",
      tools: [{ name: "scene_get_tree" }],
    },
  ];

  const enriched = enrichGroupResults(results, false, allDefs, extGroupCommands);
  const tool = enriched[0].tools[0];
  assert.equal(tool.name, "scene_get_tree");
  assert.ok(tool.description, "Should have description");
  assert.equal(tool.parameters, undefined, "Should NOT have parameters");
}

// already_loaded group also gets enriched
{
  const results: GroupResult[] = [
    {
      name: "scene",
      status: "already_loaded",
      tools: [{ name: "scene_get_tree" }],
    },
  ];

  const enriched = enrichGroupResults(results, true, allDefs, extGroupCommands);
  assert.ok(enriched[0].tools[0].parameters, "already_loaded should be enriched");
}

// Available group → NOT enriched (tools stay as {name})
{
  const results: GroupResult[] = [
    {
      name: "scene",
      status: "available",
      tools: [{ name: "scene_get_tree" }],
    },
  ];

  const enriched = enrichGroupResults(results, true, allDefs, extGroupCommands);
  const tool = enriched[0].tools[0];
  assert.equal(tool.name, "scene_get_tree");
  assert.equal(tool.parameters, undefined, "Available tools should NOT have parameters");
}

// Extension command enrichment
{
  const results: GroupResult[] = [
    {
      name: "extensions",
      status: "activated",
      tools: [{ name: "ext_custom" }],
    },
  ];

  const enriched = enrichGroupResults(results, true, allDefs, extGroupCommands);
  const tool = enriched[0].tools[0];
  assert.equal(tool.name, "ext_custom");
  assert.ok(tool.description, "Extension should have description");
  assert.ok(tool.parameters, "Extension should have parameters");
  assert.ok(tool.parameters!.path, "Should have path parameter");
  assert.equal(tool.parameters!.path.type, "string");
  assert.equal(tool.parameters!.path.required, true);
}

// Unknown tool (not in allDefs or extGroupCommands) → fallback (unchanged)
{
  const results: GroupResult[] = [
    {
      name: "unknown",
      status: "activated",
      tools: [{ name: "mystery_tool" }],
    },
  ];

  const enriched = enrichGroupResults(results, true, allDefs, extGroupCommands);
  const tool = enriched[0].tools[0];
  assert.equal(tool.name, "mystery_tool");
  assert.equal(tool.parameters, undefined);
}

// Multiple groups with mixed statuses
{
  const results: GroupResult[] = [
    {
      name: "scene",
      status: "activated",
      tools: [{ name: "scene_get_tree" }, { name: "script_read" }],
    },
    {
      name: "ext",
      status: "available",
      tools: [{ name: "ext_custom" }],
    },
  ];

  const enriched = enrichGroupResults(results, true, allDefs, extGroupCommands);
  // First group: enriched
  assert.ok(enriched[0].tools[0].parameters);
  assert.ok(enriched[0].tools[1].parameters);
  // Second group: NOT enriched
  assert.equal(enriched[1].tools[0].parameters, undefined);
}

console.log("All tool_meta tests passed.");

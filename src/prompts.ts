/**
 * MCP Prompts registration.
 *
 * Exposes named, parameterized message templates that the MCP client can fetch
 * and execute as multi-step workflows. Users can add their own prompts
 * by extending this module or via future prompt-file loading.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  // ── debug-scene ──────────────────────────────────────────────────────
  server.prompt(
    "debug-scene",
    "Inspect a scene subtree and diagnose common issues",
    { node_path: z.string().describe("Path to the root node to inspect (e.g. '.' for scene root)") },
    async ({ node_path }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Inspect the scene subtree starting at node path "${node_path}".`,
              "",
              "Steps:",
              "1. Call scene_get_tree with depth 4 and include_properties true.",
              "2. Check for common issues:",
              "   - Nodes without scripts that probably need one",
              "   - Missing collision shapes on physics bodies",
              "   - Sprites without textures assigned",
              "   - Signals that are connected but point to missing methods",
              "3. Call editor_get_errors to see if there are compile errors.",
              "4. Summarize findings with suggested fixes.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  // ── write-test ───────────────────────────────────────────────────────
  server.prompt(
    "write-test",
    "Generate a GDScript test for a file using GUT or GdUnit4",
    {
      file_path: z.string().describe("Path to the GDScript file to test (e.g. res://player.gd)"),
      framework: z.enum(["gut", "gdunit4"]).optional().describe("Test framework (default: gut)"),
    },
    async ({ file_path, framework }) => {
      const fw = framework ?? "gut";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Generate a ${fw.toUpperCase()} test file for "${file_path}".`,
                "",
                "Steps:",
                `1. Read the source file with script_read.`,
                "2. Identify public functions, signals, and exported properties.",
                `3. Write a test file following ${fw.toUpperCase()} conventions:`,
                fw === "gut"
                  ? "   - Extend GutTest, prefix test functions with test_"
                  : "   - Extend GdUnitTestSuite, use assert_that() matchers",
                "4. Cover at least: initialization, each public method, edge cases.",
                `5. Save the test file next to the source with a _test suffix.`,
                "6. Run editor_get_errors to verify no syntax issues.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}

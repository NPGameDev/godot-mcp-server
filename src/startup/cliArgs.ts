/**
 * Hand-rolled CLI argument parser for the server bin (no dependency).
 *
 * Collects the recognised `--flag`s into a flat {@link CliArgs} struct and hands
 * it to the port resolver — it does NO port validation or precedence itself (that
 * is the resolver's job). The surface is deliberately tiny: explicit
 * `--flag value` / `--flag=value` value flags, two boolean gates, no positionals,
 * no bundling, no convenience forms. An unrecognised flag, a stray positional, or
 * a value flag missing its value sets `error`, which the composition root turns
 * into a fail-loud exit.
 *
 * @module
 */

/** Port/host overrides and meta gates collected from argv. */
export interface CliArgs {
  /** `--editor-port <n>` — pins the editor WebSocket dial port (highest precedence). */
  editorPort?: string;
  /** `--runtime-port <n>` — pins the playtest-runtime WebSocket dial port. */
  runtimePort?: string;
  /** `--lsp-port <n>` — pins the GDScript-LSP dial port. */
  lspPort?: string;
  /** `--lsp-host <h>` — pins the GDScript-LSP host (only meaningful alongside a port). */
  lspHost?: string;
  /** `--help` was passed — the caller prints usage and exits 0. */
  help: boolean;
  /** `--tools-count` was passed — the caller prints the static tool count and exits 0. */
  toolsCount: boolean;
  /** First fatal parse problem (unknown flag / stray arg / missing value); the
   *  caller prints it plus usage to stderr and exits 1. undefined when argv is clean. */
  error?: string;
}

// Value flags — maps the long name to the CliArgs field it populates.
const VALUE_FLAGS: Readonly<Record<string, "editorPort" | "runtimePort" | "lspPort" | "lspHost">> = {
  "--editor-port": "editorPort",
  "--runtime-port": "runtimePort",
  "--lsp-port": "lspPort",
  "--lsp-host": "lspHost",
};

/**
 * Parse the server's CLI arguments — pass `process.argv.slice(2)`.
 *
 * @param argv - the raw argument list, without the node binary and script path
 * @returns the collected {@link CliArgs}; `error` is set on the first parse
 *   problem, but scanning continues so `--help` is still detected when it follows
 *   a bad flag
 * @remarks Both `--flag value` and `--flag=value` forms are accepted for value
 *   flags. A next token that begins with `--` is treated as the *next flag*, not
 *   a value — so a value flag at the end of argv (or before another flag) is a
 *   missing-value error rather than silently swallowing the following flag.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false, toolsCount: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      recordError(args, `unexpected argument "${token}" (no positional arguments are accepted)`);
      continue;
    }
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

    if (name === "--help") {
      args.help = true;
      continue;
    }
    if (name === "--tools-count") {
      args.toolsCount = true;
      continue;
    }

    const field = VALUE_FLAGS[name];
    if (field === undefined) {
      recordError(args, `unknown flag "${name}"`);
      continue;
    }

    let value = inlineValue;
    if (value === undefined && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i++;
    }
    if (value === undefined || value === "") {
      recordError(args, `missing value for "${name}"`);
      continue;
    }
    args[field] = value;
  }
  return args;
}

// Keep only the first error — later tokens after a bad flag are symptoms, not the cause.
function recordError(args: CliArgs, message: string): void {
  if (args.error === undefined) args.error = message;
}

/** The `--help` text (printed to stdout). Kept in sync with {@link parseCliArgs}'s flag set. */
export function formatHelp(): string {
  return [
    "godot-mcp-server — MCP bridge to the Godot 4.x editor",
    "",
    "Usage: godot-mcp-server [options]",
    "",
    "Port options (a flag overrides its env var, which overrides registry discovery):",
    "  --editor-port <n>    Editor WebSocket port to dial (env: GODOT_MCP_EDITOR_PORT)",
    "  --runtime-port <n>   Playtest-runtime WebSocket port to dial (env: GODOT_MCP_RUNTIME_PORT)",
    "  --lsp-port <n>       GDScript LSP port to dial (env: GODOT_MCP_LSP_PORT)",
    "  --lsp-host <h>       GDScript LSP host to dial (env: GODOT_MCP_LSP_HOST)",
    "",
    "Other options:",
    "  --tools-count        Print the static tool-count summary and exit",
    "  --help               Show this help and exit",
    "",
    "These flags move the DIAL target only. The ports the editor/runtime BIND",
    "(listen side) are configured toolkit-side — see the toolkit's",
    "advanced-configuration docs. With no options the server discovers ports via",
    "the shared project registry.",
    "",
  ].join("\n");
}

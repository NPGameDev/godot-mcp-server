#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════════
// Port-pin probe — end-to-end regression harness for deterministic port config.
//
// Spawns the SHIPPED server binary (node dist/index.js) with a pinned port
// configuration, speaks newline-delimited JSON-RPC over its stdio (initialize →
// notifications/initialized → one tools/call), and prints the server's resolved
// port-config stderr line plus the tool result. The probe is result-agnostic:
// it exits 0 as soon as the tool call gets ANY response — for a desync run the
// "pinned to X, but the live editor…" error text IS the expected output — and
// non-zero only when the pipeline itself breaks (timeout, server died before
// responding, bad invocation).
//
// What it proves (example invocations in test/integration/README.md):
//   - a pinned editor port connects, via env AND via server CLI flag (--via)
//   - a deliberate pin/editor desync fails fast with the precise cross-check
//     error instead of a dead-socket hang
//   - a runtime pin (GODOT_MCP_RUNTIME_PORT) reaches the playtest child
//
// Prerequisites:
//   - npm run build (the probe drives dist/index.js, not src/)
//   - a Godot editor with the toolkit plugin for the connect/runtime proofs
//     (a pure desync run needs no editor — the pin deliberately misses)
//
// Usage:
//   npm run test:integration:portpin -- [--tool <name>] [--args <json>]
//     [--editor-port <n>] [--runtime-port <n>] [--project-path <abs>]
//     [--via env|cli] [--timeout <ms>]
//
// Defaults: --tool project_get_settings, --args {}, --via env, --timeout 60000.
// GODOT_MCP_EDITOR_PORT / GODOT_MCP_RUNTIME_PORT / GODOT_MCP_PROJECT_PATH in the
// caller's environment pass through when the matching flag is omitted.
//
// Exit codes:
//   0 — the tool call returned (a result OR an error envelope — both valid)
//   2 — timeout, server exited before responding, or a bad invocation
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Options ────────────────────────────────────────────────────────────

type ProbeOptions = {
  tool: string;
  toolArgs: Record<string, unknown>;
  editorPort?: string;
  runtimePort?: string;
  projectPath?: string;
  /** How the pin reaches the server: env vars or the server's own CLI flags. */
  via: "env" | "cli";
  timeoutMs: number;
};

function fail(message: string): never {
  console.error(`[portpin] ${message}`);
  process.exit(2);
}

function parseOptions(argv: readonly string[]): ProbeOptions {
  const opts: ProbeOptions = { tool: "project_get_settings", toolArgs: {}, via: "env", timeoutMs: 60_000 };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    let value = eq === -1 ? undefined : token.slice(eq + 1);
    if (value === undefined && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i++;
    }
    if (value === undefined || value === "") fail(`missing value for "${name}"`);
    switch (name) {
      case "--tool":
        opts.tool = value;
        break;
      case "--args": {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          fail(`--args is not valid JSON: ${value}`);
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          fail(`--args must be a JSON object, got: ${value}`);
        }
        opts.toolArgs = parsed as Record<string, unknown>;
        break;
      }
      case "--editor-port":
        opts.editorPort = value;
        break;
      case "--runtime-port":
        opts.runtimePort = value;
        break;
      case "--project-path":
        opts.projectPath = value;
        break;
      case "--via":
        if (value !== "env" && value !== "cli") fail(`--via must be "env" or "cli", got: ${value}`);
        opts.via = value;
        break;
      case "--timeout": {
        const ms = Number(value);
        if (!Number.isInteger(ms) || ms <= 0) fail(`--timeout must be a positive integer (ms), got: ${value}`);
        opts.timeoutMs = ms;
        break;
      }
      default:
        fail(`unknown flag "${name}"`);
    }
  }
  return opts;
}

// ─── JSON-RPC message shape (narrowed from the wire) ────────────────────

type RpcMessage = {
  id?: unknown;
  error?: unknown;
  result?: { content?: Array<{ text?: unknown }> } | unknown;
};

function extractText(msg: RpcMessage): string {
  if (msg.error !== undefined) return JSON.stringify(msg.error);
  const content = (msg.result as { content?: Array<{ text?: unknown }> } | undefined)?.content;
  const text = content?.[0]?.text;
  return typeof text === "string" ? text : JSON.stringify(msg.result);
}

const RESULT_MAX_CHARS = 800;

function truncate(text: string): string {
  return text.length <= RESULT_MAX_CHARS ? text : `${text.slice(0, RESULT_MAX_CHARS)}… [truncated]`;
}

// ─── Main ───────────────────────────────────────────────────────────────

function main(): void {
  const opts = parseOptions(process.argv.slice(2));

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const distEntry = join(repoRoot, "dist", "index.js");
  if (!existsSync(distEntry)) fail("dist/index.js not found — run `npm run build` first");

  // The pin reaches the server either as env vars or as its own CLI flags —
  // the two paths the shared resolver must treat identically.
  const env = { ...process.env };
  const serverArgs = [distEntry];
  if (opts.via === "cli") {
    if (opts.editorPort) serverArgs.push("--editor-port", opts.editorPort);
    if (opts.runtimePort) serverArgs.push("--runtime-port", opts.runtimePort);
  } else {
    if (opts.editorPort) env.GODOT_MCP_EDITOR_PORT = opts.editorPort;
    if (opts.runtimePort) env.GODOT_MCP_RUNTIME_PORT = opts.runtimePort;
  }
  if (opts.projectPath) env.GODOT_MCP_PROJECT_PATH = opts.projectPath;

  const srv = spawn(process.execPath, serverArgs, { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] });
  const stdin = srv.stdin;
  if (!stdin) fail("could not open the server's stdin");

  let finished = false;
  function finish(code: number): void {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    srv.kill();
    process.exit(code);
  }

  const deadline = setTimeout(() => {
    console.error(`[portpin] TIMEOUT — no tool response within ${opts.timeoutMs}ms`);
    dumpStderrTail();
    finish(2);
  }, opts.timeoutMs);

  // ── stderr: surface the resolved port-config line; keep a diagnostic tail ──
  const stderrTail: string[] = [];
  let stderrBuf = "";
  srv.stderr!.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    let nl;
    while ((nl = stderrBuf.indexOf("\n")) >= 0) {
      const line = stderrBuf.slice(0, nl);
      stderrBuf = stderrBuf.slice(nl + 1);
      if (line.includes("port config:")) console.log(`[portpin] ${line.trim()}`);
      stderrTail.push(line);
      if (stderrTail.length > 40) stderrTail.shift();
    }
  });
  function dumpStderrTail(): void {
    if (stderrTail.length === 0) return;
    console.error("[portpin] server stderr tail:");
    for (const line of stderrTail) console.error(`  ${line}`);
  }

  srv.on("exit", (code) => {
    if (finished) return;
    console.error(`[portpin] server exited before responding (code ${code})`);
    dumpStderrTail();
    finish(2);
  });
  srv.on("error", (err) => {
    console.error(`[portpin] failed to spawn the server: ${err.message}`);
    finish(2);
  });

  // ── stdout: newline-delimited JSON-RPC (the MCP stdio framing) ──
  const send = (message: Record<string, unknown>): void => {
    stdin.write(JSON.stringify(message) + "\n");
  };

  let stdoutBuf = "";
  srv.stdout!.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        continue; // not JSON-RPC — ignore
      }
      if (msg.id === 1) {
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: opts.tool, arguments: opts.toolArgs },
        });
      } else if (msg.id === 2) {
        console.log(`[portpin] RESULT(${opts.tool}):\n${truncate(extractText(msg))}`);
        finish(0);
      }
    }
  });

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "port-pin-probe", version: "0.0.0" },
    },
  });
}

main();

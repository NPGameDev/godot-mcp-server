#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════════
// LSP claimant-liveness repro — two synthetic peers that must DIVERGE.
//
// What it measures: whether the server's LSP endpoint resolution can tell a
// DEAD editor's leftover registry entry apart from a GENUINELY-LIVE rival
// editor. Both peers are pid-alive; only the genuine one still answers on the
// WS command port its own entry advertises. A verdict built on PID liveness
// alone cannot separate them, so it reports a conflict for both — that is the
// false positive this harness demonstrates, and the fix it backs is the
// WS-port corroboration in liveLspClaimants (registry.ts + registryLiveness.ts).
//
//   | Peer     | PID                  | Its WS port          | Correct verdict |
//   |----------|----------------------|----------------------|-----------------|
//   | Phantom  | a live spawned child | reserved then closed | NOT a conflict  |
//   | Genuine  | a live spawned child | held open by us      | conflict        |
//
// The spawned child is what removes the flakiness: a PID that is provably alive
// and provably not a Godot editor — a deterministic stand-in for a recycled
// PID, with no waiting for the OS to recycle one and no dependence on what else
// is running. WS ports are OS-assigned ephemeral ports, never the literal
// 6550/6552/6553 of the captured evidence, so a real editor on this machine can
// neither rescue nor break a leg.
//
// Modes:
//   --offline (default, no editor needed)
//       Redirects the registry env var to a temp sandbox, writes a projects.json
//       + entries/ in the toolkit's verbatim on-disk shape, and calls the real
//       discoverLspEndpoint / resolveLspEndpoint / getLspStatus in-process.
//       Covers the conflict path, the registry-miss path, and the dock verdict.
//   --live (needs a running editor with the toolkit on the target project)
//       Clones the REAL registry into the sandbox, splices a phantom claimant in,
//       spawns the shipped server (dist/index.js) against the sandbox, and drives a
//       real lsp_symbols over MCP stdio. Both this process and the spawned server
//       have their registry env var redirected (this one so it can locate and edit
//       the clone), but every write lands inside the sandbox: the real
//       projects.json is only ever read, so there is nothing to back up or restore.
//
// Exit codes:
//   0 — every expectation held (the behaviour is correct)
//   1 — an expectation failed (the false positive is present, or a regression)
//   2 — the harness could not run (bad invocation, missing dist/, no live editor)
//
// Usage:
//   npm run repro:lsp-conflict
//   npm run repro:lsp-conflict -- --live --project-path <abs> [--file-path res://…]
//                                 [--timeout <ms>]
// ═══════════════════════════════════════════════════════════════════════════

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverLspEndpoint, normalizePath, registryPath } from "../../src/registry.js";
import { getLspStatus, LspResolutionError, resolveLspEndpoint } from "../../src/lsp/lspClient.js";

// ─── Options ────────────────────────────────────────────────────────────

type Options = {
  mode: "offline" | "live";
  projectPath?: string;
  /** A res:// script the live editor can resolve; any .gd in the project works. */
  filePath: string;
  timeoutMs: number;
};

/** The toolkit ships with every project that can serve this harness, so its own
 *  plugin script is the one .gd guaranteed to exist in a --live target. */
const DEFAULT_LIVE_FILE = "res://addons/godot_mcp_toolkit/plugin.gd";

function abort(message: string): never {
  console.error(`[repro] ${message}`);
  process.exit(2);
}

function parseOptions(argv: readonly string[]): Options {
  const opts: Options = { mode: "offline", filePath: DEFAULT_LIVE_FILE, timeoutMs: 60_000 };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    const takeValue = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) abort(`missing value for "${name}"`);
      i++;
      return value;
    };
    switch (name) {
      case "--offline":
        opts.mode = "offline";
        break;
      case "--live":
        opts.mode = "live";
        break;
      case "--project-path":
        opts.projectPath = takeValue();
        break;
      case "--file-path":
        opts.filePath = takeValue();
        break;
      case "--timeout": {
        const ms = Number(takeValue());
        if (!Number.isInteger(ms) || ms <= 0) abort(`--timeout must be a positive integer (ms)`);
        opts.timeoutMs = ms;
        break;
      }
      default:
        abort(`unknown flag "${name}"`);
    }
  }
  return opts;
}

// ─── Expectation recorder ───────────────────────────────────────────────

let failures = 0;

function expect(what: string, expected: string, actual: string): void {
  if (expected === actual) {
    console.log(`    PASS  ${what} → ${actual}`);
    return;
  }
  failures++;
  console.log(`    FAIL  ${what} → expected ${expected}, got ${actual}`);
}

// ─── Registry fixture, in the toolkit's on-disk shape ───────────────────

type Row = {
  /** Canonical project path — the by_path key (lowercased on win32/darwin only;
   *  elsewhere normalizePath preserves case). */
  key: string;
  lspPort: number | null;
  lspHost: string;
  pid: number;
  /** The WS command port this entry advertises — what the corroboration probes. */
  wsPort: number;
  startedAt: number;
  tokenPath: string;
  godotVersion: string;
  /** How this row spells its numerics. 4.5+ serialises every number as a GDScript
   *  float (`6553.0`); 4.2 writes plain integers (`6553`). Both shapes occur in real
   *  registries, so the fixture emits both rather than assuming one — JSON.parse
   *  yields the same JS number either way, and covering both is what shows that
   *  rather than asserting it. */
  numerics: "float" | "int";
};

/** Spell a number the way the writing engine version would. */
function gdNumber(n: number, style: Row["numerics"]): string {
  return style === "float" && Number.isInteger(n) ? `${n}.0` : `${n}`;
}

function rowFields(row: Row, indent: string, lspPortAsFloat: boolean): string {
  const num = (n: number): string => gdNumber(n, row.numerics);
  const lsp = row.lspPort == null ? "null" : lspPortAsFloat ? num(row.lspPort) : String(row.lspPort);
  return [
    `${indent}"godot_version": ${JSON.stringify(row.godotVersion)},`,
    `${indent}"lsp_host": ${JSON.stringify(row.lspHost)},`,
    `${indent}"lsp_port": ${lsp},`,
    `${indent}"pid": ${num(row.pid)},`,
    `${indent}"port": ${num(row.wsPort)},`,
    `${indent}"runtime_pid": null,`,
    `${indent}"runtime_port": null,`,
    `${indent}"started_at": ${num(row.startedAt)},`,
    `${indent}"token_path": ${JSON.stringify(row.tokenPath)}`,
  ].join("\n");
}

/** One `by_path` member, tab-indented like the aggregate the projection writes. */
function projectsRow(row: Row): string {
  return `\t\t${JSON.stringify(row.key)}: {\n${rowFields(row, "\t\t\t", true)}\n\t\t}`;
}

function projectsJson(rows: readonly Row[]): string {
  return `{\n\t"by_path": {\n${rows.map(projectsRow).join(",\n")}\n\t}\n}`;
}

/** One per-instance `entries/<id>.json`. It carries `_key` and — unlike the
 *  aggregate — an integral `lsp_port`; both quirks are reproduced verbatim. */
function entryJson(row: Row): string {
  return `{\n\t"_key": ${JSON.stringify(row.key)},\n${rowFields(row, "\t", false)}\n}`;
}

function registryEnvOverride(sandbox: string): Record<string, string> {
  // Mirrors registryPath()'s per-platform lookup — whichever var it reads is the
  // one that has to move for the sandbox to be authoritative.
  if (process.platform === "win32") return { APPDATA: sandbox };
  if (process.platform === "darwin") return { HOME: sandbox };
  return { XDG_DATA_HOME: sandbox };
}

function redirectRegistryEnv(sandbox: string): void {
  Object.assign(process.env, registryEnvOverride(sandbox));
}

/** Write the sandbox registry. `entries/` is written for shape fidelity only —
 *  the server reads the aggregate `projects.json` and never the per-instance
 *  files, so the 12-hex filename here is cosmetic and implies no hash contract. */
function writeFixture(rows: readonly Row[]): void {
  const dir = dirname(registryPath());
  mkdirSync(join(dir, "entries"), { recursive: true });
  writeFileSync(registryPath(), projectsJson(rows));
  for (const row of rows) {
    const id = createHash("sha256").update(row.key).digest("hex").slice(0, 12);
    writeFileSync(join(dir, "entries", `${id}.json`), entryJson(row));
  }
}

// ─── Synthetic peer building blocks ─────────────────────────────────────

type HeldPort = { port: number; close: () => Promise<void> };

/** A loopback listener held open for the run — the "this editor is still
 *  serving" half of the genuine peer. The OS picks the port, so the fixture
 *  never collides with a real editor's WS port on this machine. */
async function holdLoopbackPort(): Promise<HeldPort> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("loopback listener reported no numeric port");
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A loopback port proved free and then released. Binding it first is what makes
 *  the refusal deterministic — an arbitrary high number might be in use. */
async function reserveRefusedPort(): Promise<number> {
  const held = await holdLoopbackPort();
  await held.close();
  return held.port;
}

/** An idle child process: a PID that is provably alive and provably not a Godot
 *  editor — the deterministic stand-in for a recycled PID. */
function spawnIdleProcess(): { pid: number; kill: () => void } {
  const child: ChildProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("could not spawn the idle stand-in process");
  child.unref();
  return { pid, kill: () => child.kill() };
}

// ─── Offline mode ───────────────────────────────────────────────────────

const CONTESTED_LSP_PORT = 6005;

function describeDiscovery(result: Awaited<ReturnType<typeof discoverLspEndpoint>>): string {
  if (result === null) return "miss";
  if ("conflict" in result) return `conflict:${result.port}`;
  return `${result.host}:${result.port}`;
}

async function describeResolution(projectPath: string): Promise<string> {
  try {
    const endpoint = await resolveLspEndpoint(projectPath);
    return `${endpoint.host}:${endpoint.port}`;
  } catch (err) {
    if (err instanceof LspResolutionError) return err.code;
    return `unexpected error: ${String(err)}`;
  }
}

async function runOffline(): Promise<void> {
  const sandbox = mkdtempSync(join(tmpdir(), "godot-mcp-lsp-repro-"));
  // An explicit override bypasses the registry entirely, which would make every
  // leg vacuous — the whole point is to exercise registry-derived resolution.
  delete process.env.GODOT_MCP_LSP_PORT;
  delete process.env.GODOT_MCP_LSP_HOST;
  redirectRegistryEnv(sandbox);

  const phantomProc = spawnIdleProcess();
  const genuineProc = spawnIdleProcess();
  const oursPort = await holdLoopbackPort();
  const genuinePort = await holdLoopbackPort();
  const refusedPort = await reserveRefusedPort();
  const secondRefusedPort = await reserveRefusedPort();

  const projectRoot = join(sandbox, "projects");
  const ours = join(projectRoot, "project-under-test");
  const phantomProject = join(projectRoot, "closed-editor");
  const genuineProject = join(projectRoot, "live-rival-editor");
  const secondPhantomProject = join(projectRoot, "another-closed-editor");

  const row = (over: Partial<Row> & Pick<Row, "key">): Row => ({
    lspPort: CONTESTED_LSP_PORT,
    lspHost: "127.0.0.1",
    pid: process.pid,
    wsPort: oursPort.port,
    startedAt: 1_784_000_000,
    tokenPath: join(sandbox, "token", "mcp_token"),
    godotVersion: "4.5",
    numerics: "float",
    ...over,
  });

  // Our own row is excluded from the peer set by PID, so the verdict never turns
  // on its own WS port; it is held open anyway because a live editor's is.
  const oursRow = row({ key: normalizePath(ours), startedAt: 1_784_100_000 });
  const phantomRow = row({
    key: normalizePath(phantomProject),
    pid: phantomProc.pid,
    wsPort: refusedPort,
    startedAt: 1_783_892_341,
  });
  const genuineRow = row({
    key: normalizePath(genuineProject),
    pid: genuineProc.pid,
    wsPort: genuinePort.port,
    startedAt: 1_783_892_341,
  });
  // Written in 4.2's integer form, so the three-row evidence fixture carries both
  // numeric spellings a real registry can hold.
  const secondPhantomRow = row({
    key: normalizePath(secondPhantomProject),
    pid: phantomProc.pid,
    wsPort: secondRefusedPort,
    startedAt: 1_784_646_741,
    godotVersion: "4.2",
    numerics: "int",
  });

  try {
    console.log("\n[1] conflict path — phantom peer (pid alive, WS port refused) must NOT contest");
    writeFixture([oursRow, phantomRow]);
    expect(
      "discoverLspEndpoint",
      `127.0.0.1:${CONTESTED_LSP_PORT}`,
      describeDiscovery(await discoverLspEndpoint(ours)),
    );
    expect("resolveLspEndpoint", `127.0.0.1:${CONTESTED_LSP_PORT}`, await describeResolution(ours));
    expect("getLspStatus (dock)", "active", (await getLspStatus(ours)).state);

    console.log("\n[2] conflict path — genuine peer (pid alive, WS port answering) must STILL contest");
    writeFixture([oursRow, genuineRow]);
    expect("discoverLspEndpoint", `conflict:${CONTESTED_LSP_PORT}`, describeDiscovery(await discoverLspEndpoint(ours)));
    expect("resolveLspEndpoint", "LSP_PORT_CONFLICT", await describeResolution(ours));
    expect("getLspStatus (dock)", "conflict", (await getLspStatus(ours)).state);

    console.log("\n[3] captured evidence shape — three rows on 6005, two older, both phantom");
    writeFixture([oursRow, phantomRow, secondPhantomRow]);
    expect(
      "discoverLspEndpoint",
      `127.0.0.1:${CONTESTED_LSP_PORT}`,
      describeDiscovery(await discoverLspEndpoint(ours)),
    );
    expect("resolveLspEndpoint", `127.0.0.1:${CONTESTED_LSP_PORT}`, await describeResolution(ours));
    expect("getLspStatus (dock)", "active", (await getLspStatus(ours)).state);

    console.log("\n[4] a genuine peer behind a phantom one is not masked by it");
    writeFixture([oursRow, phantomRow, genuineRow]);
    expect("discoverLspEndpoint", `conflict:${CONTESTED_LSP_PORT}`, describeDiscovery(await discoverLspEndpoint(ours)));
    expect("resolveLspEndpoint", "LSP_PORT_CONFLICT", await describeResolution(ours));

    console.log("\n[5] miss path — 6005 held only by a phantom → the guarded fallback still applies");
    writeFixture([phantomRow]);
    expect("discoverLspEndpoint", "miss", describeDiscovery(await discoverLspEndpoint(ours)));
    expect("resolveLspEndpoint", `127.0.0.1:${CONTESTED_LSP_PORT}`, await describeResolution(ours));
    expect("getLspStatus (dock)", "active", (await getLspStatus(ours)).state);

    console.log("\n[6] miss path — 6005 held by a genuine editor → no blind fallback");
    writeFixture([genuineRow]);
    expect("discoverLspEndpoint", "miss", describeDiscovery(await discoverLspEndpoint(ours)));
    expect("resolveLspEndpoint", "LSP_UNAVAILABLE", await describeResolution(ours));
    expect("getLspStatus (dock)", "unavailable", (await getLspStatus(ours)).state);
  } finally {
    phantomProc.kill();
    genuineProc.kill();
    await oursPort.close();
    await genuinePort.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// ─── Live mode ──────────────────────────────────────────────────────────

type RawRow = { lsp_port?: number | null; started_at?: number };

/** Splice the phantom row in as text so every real row survives byte-for-byte —
 *  a re-serialize would rewrite the toolkit's float formatting. */
function spliceRow(projectsText: string, row: Row): string {
  const marker = '"by_path": {';
  const at = projectsText.indexOf(marker);
  if (at < 0) abort("cloned projects.json has no by_path object — cannot inject the phantom");
  const insertAt = at + marker.length;
  return `${projectsText.slice(0, insertAt)}\n${projectsRow(row)},${projectsText.slice(insertAt)}`;
}

function extractText(message: { error?: unknown; result?: unknown }): string {
  if (message.error !== undefined) return JSON.stringify(message.error);
  const content = (message.result as { content?: Array<{ text?: unknown }> } | undefined)?.content;
  const text = content?.[0]?.text;
  return typeof text === "string" ? text : JSON.stringify(message.result);
}

async function runLive(opts: Options): Promise<void> {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const distEntry = join(repoRoot, "dist", "index.js");
  if (!existsSync(distEntry)) abort("dist/index.js not found — run `npm run build` first");

  const projectPath = opts.projectPath ?? process.env.GODOT_MCP_PROJECT_PATH;
  if (!projectPath) abort("--live needs --project-path <abs> (or GODOT_MCP_PROJECT_PATH)");

  const realRegistry = registryPath();
  if (!existsSync(realRegistry)) abort(`no registry at ${realRegistry} — open the project in a Godot editor first`);
  const realText = readFileSync(realRegistry, "utf-8");
  const ourKey = normalizePath(projectPath);
  const ourRow = (JSON.parse(realText) as { by_path?: Record<string, RawRow> }).by_path?.[ourKey];
  if (!ourRow) abort(`no registry row for ${ourKey} — open that project in an editor with the toolkit enabled`);
  if (ourRow.lsp_port == null) abort(`the live editor publishes lsp_port: null for ${ourKey} — nothing to contest`);

  const sandbox = mkdtempSync(join(tmpdir(), "godot-mcp-lsp-repro-live-"));
  redirectRegistryEnv(sandbox);
  const sandboxRegistry = registryPath();
  mkdirSync(dirname(sandboxRegistry), { recursive: true });
  cpSync(dirname(realRegistry), dirname(sandboxRegistry), { recursive: true });

  const phantomProc = spawnIdleProcess();
  const refusedPort = await reserveRefusedPort();
  const phantom: Row = {
    key: normalizePath(join(sandbox, "projects", "closed-editor")),
    lspPort: ourRow.lsp_port,
    lspHost: "127.0.0.1",
    pid: phantomProc.pid,
    wsPort: refusedPort,
    startedAt: (ourRow.started_at ?? Math.floor(Date.now() / 1000)) - 100,
    tokenPath: join(sandbox, "token", "mcp_token"),
    godotVersion: "4.5",
    numerics: "float",
  };
  writeFileSync(sandboxRegistry, spliceRow(readFileSync(sandboxRegistry, "utf-8"), phantom));
  console.log(`[repro] phantom claimant on lsp_port ${phantom.lspPort}: pid ${phantom.pid}, WS ${phantom.wsPort}`);
  console.log(`[repro] sandbox registry: ${sandboxRegistry} (the real one is untouched)`);

  await new Promise<void>((resolve) => {
    const env = { ...process.env, GODOT_MCP_PROJECT_PATH: projectPath };
    delete env.GODOT_MCP_LSP_PORT;
    delete env.GODOT_MCP_LSP_HOST;
    const server = spawn(process.execPath, [distEntry], { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] });

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      server.kill();
      resolve();
    };
    const deadline = setTimeout(() => {
      console.error(`[repro] TIMEOUT — no lsp_symbols response within ${opts.timeoutMs}ms`);
      failures++;
      finish();
    }, opts.timeoutMs);

    server.on("exit", (code) => {
      if (settled) return;
      console.error(`[repro] server exited before responding (code ${code})`);
      failures++;
      finish();
    });
    server.on("error", (err) => {
      console.error(`[repro] failed to spawn the server: ${err.message}`);
      failures++;
      finish();
    });
    // The server's diagnostics are the only window into its resolution decision.
    server.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

    const send = (message: Record<string, unknown>): void => {
      server.stdin.write(`${JSON.stringify(message)}\n`);
    };

    let buffered = "";
    server.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      let nl: number;
      while ((nl = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        if (!line.trim()) continue;
        let message: { id?: unknown; error?: unknown; result?: unknown };
        try {
          message = JSON.parse(line);
        } catch {
          continue; // not a JSON-RPC frame
        }
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "discover_tools", arguments: { request: "lsp" } },
          });
        } else if (message.id === 2) {
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "lsp_symbols", arguments: { file_path: opts.filePath } },
          });
        } else if (message.id === 3) {
          const text = extractText(message);
          console.log(`\n[repro] lsp_symbols response:\n${text.slice(0, 800)}`);
          // Any other outcome (even a missing file) proves resolution got past
          // the phantom; only a resolution verdict fails this leg.
          const verdict = text.includes("LSP_PORT_CONFLICT")
            ? "LSP_PORT_CONFLICT"
            : text.includes("LSP_UNAVAILABLE")
              ? "LSP_UNAVAILABLE"
              : "resolved past the phantom";
          expect("live lsp_symbols verdict", "resolved past the phantom", verdict);
          finish();
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
        clientInfo: { name: "lsp-conflict-repro", version: "0.0.0" },
      },
    });
  });

  phantomProc.kill();
  rmSync(sandbox, { recursive: true, force: true });
  console.log(
    "\n[repro] Check the editor's Output dock: corroboration probes close with a graceful FIN, " +
      "so no `accept_stream failed` line should have appeared.",
  );
}

// ─── Main ───────────────────────────────────────────────────────────────

const opts = parseOptions(process.argv.slice(2));
console.log(`[repro] mode: ${opts.mode}`);
if (opts.mode === "offline") await runOffline();
else await runLive(opts);

if (failures > 0) {
  console.log(`\n[repro] ${failures} expectation(s) failed — the LSP claimant verdict is wrong.`);
  process.exit(1);
}
console.log("\n[repro] All expectations held — phantom and genuine peers diverge correctly.");

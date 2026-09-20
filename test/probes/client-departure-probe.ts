/**
 * Client-departure probe for the release checklist (§1, B9).
 *
 * Drives a BUILT server (`dist/index.js`) through the ways an MCP client can vanish and
 * asserts the process ends — or deliberately does not — within the shutdown bound:
 *
 *   S1  full departure (stdin EOF + dead stdout + dead stderr)  → exit 0 within 3 s
 *   S2  the same, with a real editor connected                  → exit 0 within 3 s
 *   S3  only stderr dies                                        → keeps serving: a real
 *                                                                 initialize/tools/list
 *                                                                 still answers, then a
 *                                                                 clean stdin EOF exits 0
 *   S4  dead stdout, then a request                             → exit 0 within 3 s
 *   S5  SIGTERM (POSIX only — Windows has no signals)           → exit 0 within 3 s
 *
 * S3 is the regression guard for #2: before 1.0.1 the first stderr write after the pipe
 * closed raised EPIPE, the crash handler reported it to that same dead stderr, and the
 * process re-entered the handler forever at 100% CPU.
 *
 * The scenarios that need no editor pin a dead editor port so they stay deterministic
 * even when an editor is listening. S2 runs unpinned against a live editor on 6550; it
 * prints SKIP when nothing is listening. After an S2 PASS, confirm by eye that the editor
 * console logged the peer disconnect.
 *
 * Node-only and self-contained: it spawns its own child with pipes and kills only that
 * child. It never enumerates processes and never kills by PID.
 *
 * Run from the server repo root (never a bare `npx`):
 *   npm run probe:departure                      # all scenarios, editor expected for S2
 *   npm run probe:departure -- --no-editor       # skip S2
 *   npm run probe:departure -- --project <path>  # the project whose editor serves S2
 *   npm run probe:departure -- --server <path>   # a different built entrypoint
 */
import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SERVER_ENTRY = resolve(argValue("--server") ?? join(REPO_ROOT, "dist/index.js"));
const PROJECT_PATH = resolve(argValue("--project") ?? process.cwd());
const NO_EDITOR = process.argv.includes("--no-editor");

/** No editor can be listening here, so the no-editor scenarios never depend on what
 *  else is running on this machine — they exercise the reconnect path on purpose. */
const DEAD_PORT = "6599";
const EDITOR_PORT = 6550;
/** The last line of the startup banner; the transport connects immediately after it. */
const READY_LINE = "[godot-mcp] readOnly=";
const EXIT_WINDOW_MS = 3_000;

type Result = "PASS" | "FAIL" | "SKIP";
type Row = { scenario: string; result: Result; exit: string; elapsed: string; note: string };
const rows: Row[] = [];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function record(scenario: string, result: Result, exit: number | null, elapsedMs: number | null, note: string): void {
  rows.push({
    scenario,
    result,
    exit: exit === null ? "—" : String(exit),
    elapsed: elapsedMs === null ? "—" : String(elapsedMs),
    note,
  });
}

type Rpc = { jsonrpc: string; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };

/** A spawned server speaking newline-delimited JSON-RPC over its own stdio pipes. */
class Server {
  readonly proc: ChildProcess;
  private stderrText = "";
  private buf = "";
  private nextId = 1;
  private readonly waiters = new Map<number, (msg: Rpc) => void>();

  constructor(env: Record<string, string | undefined>) {
    const childEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...env })) {
      if (value !== undefined) childEnv[key] = value;
    }
    // stdio pipes and env only — no detached, no shell, no windowsHide.
    this.proc = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: REPO_ROOT,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout?.setEncoding("utf8");
    this.proc.stdout?.on("data", (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        let msg: Rpc;
        try {
          msg = JSON.parse(line) as Rpc;
        } catch {
          continue;
        }
        if (typeof msg.id === "number") {
          const waiter = this.waiters.get(msg.id);
          if (waiter) {
            this.waiters.delete(msg.id);
            waiter(msg);
          }
        }
      }
    });
    this.proc.stderr?.setEncoding("utf8");
    this.proc.stderr?.on("data", (chunk: string) => {
      this.stderrText += chunk;
    });
    // A pipe this probe destroyed surfaces here; every scenario asserts on the child.
    this.proc.stdin?.on("error", () => {});
    this.proc.stdout?.on("error", () => {});
    this.proc.stderr?.on("error", () => {});
  }

  /** Resolve true once `needle` appears on the child's stderr, false on timeout. */
  waitForStderr(needle: string, timeoutMs: number): Promise<boolean> {
    if (this.stderrText.includes(needle)) return Promise.resolve(true);
    return new Promise((resolveFound) => {
      const onData = (): void => {
        if (!this.stderrText.includes(needle)) return;
        clearTimeout(timer);
        this.proc.stderr?.off("data", onData);
        resolveFound(true);
      };
      const timer = setTimeout(() => {
        this.proc.stderr?.off("data", onData);
        resolveFound(false);
      }, timeoutMs);
      this.proc.stderr?.on("data", onData);
    });
  }

  /** The startup banner, then a beat for `server.connect(transport)` to finish. */
  async ready(timeoutMs = 20_000): Promise<boolean> {
    const seen = await this.waitForStderr(READY_LINE, timeoutMs);
    if (seen) await sleep(300);
    return seen;
  }

  /** The response, or undefined if none arrived inside `timeoutMs`. */
  request(method: string, params: unknown, timeoutMs: number): Promise<Rpc | undefined> {
    const id = this.nextId++;
    return new Promise((resolveMsg) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        resolveMsg(undefined);
      }, timeoutMs);
      this.waiters.set(id, (msg) => {
        clearTimeout(timer);
        resolveMsg(msg);
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(msg: Rpc): void {
    try {
      this.proc.stdin?.write(JSON.stringify(msg) + "\n");
    } catch {
      // A departed server's stdin is gone; the scenario asserts on the exit, not the write.
    }
  }

  /** The child's exit code, or null if it outlives `ms` — "still running" is the
   *  expected outcome for the keep-alive half of S3, not only a timeout. */
  exitWithin(ms: number): Promise<number | null> {
    if (this.proc.exitCode !== null) return Promise.resolve(this.proc.exitCode);
    return new Promise((resolveExit) => {
      const timer = setTimeout(() => resolveExit(null), ms);
      this.proc.once("exit", (code) => {
        clearTimeout(timer);
        resolveExit(code);
      });
    });
  }

  /** The full client departure: all three pipes go away together, no signal. */
  depart(): void {
    this.proc.stdin?.end();
    this.proc.stdout?.destroy();
    this.proc.stderr?.destroy();
  }

  kill(): void {
    if (this.proc.exitCode === null) this.proc.kill();
  }
}

/** True when something accepts a TCP connection on the editor port. */
function editorListening(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolveOpen) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (open: boolean): void => {
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Start a server that can never reach an editor, so the scenario is self-contained. */
async function startPinned(): Promise<Server | undefined> {
  const server = new Server({ GODOT_MCP_EDITOR_PORT: DEAD_PORT, GODOT_MCP_PROJECT_PATH: PROJECT_PATH });
  if (await server.ready()) return server;
  server.kill();
  return undefined;
}

const NO_BANNER = "server never printed its startup banner";

async function scenario1(): Promise<void> {
  const server = await startPinned();
  if (!server) return record("S1 full departure", "FAIL", null, null, NO_BANNER);
  const started = Date.now();
  server.depart();
  const code = await server.exitWithin(EXIT_WINDOW_MS);
  const elapsed = Date.now() - started;
  server.kill();
  record(
    "S1 full departure",
    code === 0 ? "PASS" : "FAIL",
    code,
    elapsed,
    code === 0 ? "stdin EOF + dead stdout + dead stderr" : "did not exit 0 inside the window",
  );
}

async function scenario2(): Promise<void> {
  if (NO_EDITOR) return record("S2 departure with editor", "SKIP", null, null, "--no-editor");
  if (!(await editorListening(EDITOR_PORT))) {
    return record("S2 departure with editor", "SKIP", null, null, `nothing listening on 127.0.0.1:${EDITOR_PORT}`);
  }
  // Unpinned on purpose: this is the real discovery path against the live editor.
  const server = new Server({ GODOT_MCP_EDITOR_PORT: undefined, GODOT_MCP_PROJECT_PATH: PROJECT_PATH });
  if (!(await server.ready())) {
    server.kill();
    return record("S2 departure with editor", "FAIL", null, null, NO_BANNER);
  }
  if (!(await server.waitForStderr("authenticated", 15_000))) {
    server.kill();
    return record("S2 departure with editor", "FAIL", null, null, "editor never authenticated within 15 s");
  }
  const started = Date.now();
  server.depart();
  const code = await server.exitWithin(EXIT_WINDOW_MS);
  const elapsed = Date.now() - started;
  server.kill();
  record(
    "S2 departure with editor",
    code === 0 ? "PASS" : "FAIL",
    code,
    elapsed,
    code === 0 ? "editor was authenticated — check its console for the disconnect" : "did not exit 0 inside the window",
  );
}

async function scenario3(): Promise<void> {
  const server = await startPinned();
  if (!server) return record("S3 stderr dies, keep serving", "FAIL", null, null, NO_BANNER);
  server.proc.stderr?.destroy();
  await sleep(3_500); // long enough for several reconnect logs to hit the dead pipe
  const exitedEarly = await server.exitWithin(0);
  const init = await server.request(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "client-departure-probe", version: "1.0.0" },
    },
    EXIT_WINDOW_MS,
  );
  server.notify("notifications/initialized", {});
  const listed = await server.request("tools/list", {}, EXIT_WINDOW_MS);
  const tools = (listed?.result as { tools?: unknown[] } | undefined)?.tools ?? [];
  if (exitedEarly !== null || init === undefined || tools.length === 0) {
    server.kill();
    return record(
      "S3 stderr dies, keep serving",
      "FAIL",
      exitedEarly,
      null,
      exitedEarly !== null
        ? "exited instead of muting the lost log sink"
        : `initialize answered=${init !== undefined}, tools=${tools.length}`,
    );
  }
  const started = Date.now();
  server.proc.stdin?.end();
  const code = await server.exitWithin(EXIT_WINDOW_MS);
  const elapsed = Date.now() - started;
  server.kill();
  record(
    "S3 stderr dies, keep serving",
    code === 0 ? "PASS" : "FAIL",
    code,
    elapsed,
    code === 0
      ? `answered tools/list with ${tools.length} tools, then EOF exited 0`
      : "served, but the later EOF did not exit 0",
  );
}

async function scenario4(): Promise<void> {
  const server = await startPinned();
  if (!server) return record("S4 dead stdout", "FAIL", null, null, NO_BANNER);
  server.proc.stdout?.destroy();
  const started = Date.now();
  // Not awaited: the request only has to provoke a write; no response can arrive.
  void server.request(
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "client-departure-probe", version: "1.0.0" },
    },
    EXIT_WINDOW_MS,
  );
  const code = await server.exitWithin(EXIT_WINDOW_MS);
  const elapsed = Date.now() - started;
  server.kill();
  record(
    "S4 dead stdout",
    code === 0 ? "PASS" : "FAIL",
    code,
    elapsed,
    code === 0 ? "no response could reach the client" : "did not exit 0 inside the window",
  );
}

async function scenario5(): Promise<void> {
  if (process.platform === "win32") return record("S5 SIGTERM", "SKIP", null, null, "win32 has no POSIX signals");
  const server = await startPinned();
  if (!server) return record("S5 SIGTERM", "FAIL", null, null, NO_BANNER);
  const started = Date.now();
  server.proc.kill("SIGTERM");
  const code = await server.exitWithin(EXIT_WINDOW_MS);
  const elapsed = Date.now() - started;
  server.kill();
  record(
    "S5 SIGTERM",
    code === 0 ? "PASS" : "FAIL",
    code,
    elapsed,
    code === 0 ? "signalled stop" : "did not exit 0 inside the window",
  );
}

function printTable(): void {
  const headings: Row = { scenario: "scenario", result: "result", exit: "exit", elapsed: "elapsed ms", note: "note" };
  const all = [headings, ...rows];
  const width = (pick: (row: Row) => string): number => Math.max(...all.map((row) => pick(row).length));
  const w = {
    scenario: width((row) => row.scenario),
    result: width((row) => row.result),
    exit: width((row) => row.exit),
    elapsed: width((row) => row.elapsed),
  };
  const line = (row: Row): string =>
    `${row.scenario.padEnd(w.scenario)} | ${row.result.padEnd(w.result)} | ${row.exit.padEnd(w.exit)} | ${row.elapsed.padEnd(w.elapsed)} | ${row.note}`;
  const rule = `${"-".repeat(w.scenario)}-+-${"-".repeat(w.result)}-+-${"-".repeat(w.exit)}-+-${"-".repeat(w.elapsed)}-+-----`;
  process.stdout.write(`\n${line(headings)}\n${rule}\n`);
  for (const row of rows) process.stdout.write(`${line(row)}\n`);
}

async function main(): Promise<void> {
  process.stdout.write(`[departure] server=${SERVER_ENTRY}\n[departure] project=${PROJECT_PATH}\n`);
  await scenario1();
  await scenario2();
  await scenario3();
  await scenario4();
  await scenario5();
  printTable();
  const tally = (result: Result): number => rows.filter((row) => row.result === result).length;
  process.stdout.write(`\n[departure] ${tally("PASS")} passed, ${tally("FAIL")} failed, ${tally("SKIP")} skipped\n`);
  process.exit(tally("FAIL") === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(`[departure] FATAL ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(3);
});

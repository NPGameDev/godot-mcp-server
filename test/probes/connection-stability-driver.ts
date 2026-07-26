/**
 * Connection-stability driver for the server release checklist (§1, B1-B8):
 * a co-driven session where each mode prints observable facts and the operator
 * pairs them with what the editor dock and console show.
 *
 * Spawns the BUILT bridge (`dist/index.js`) as a stdio child (same chassis as
 * read-only-surface-probe.ts) and drives the connection-stability scenarios. Each
 * subcommand prints observable facts; verdicts are recorded by the orchestrator
 * with the user's dock/console observations.
 *
 * Run from the server repo:  node_modules/.bin/tsx <this-file> <mode> [args]
 * Modes: prep | cycle | killmid | restart10 | hold [maxSec] | second | b8 <godotPid> <argsJson>
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const SERVER_REPO = "C:/Users/nicol/OneDrive/Desktop/Personal/AIWithGodot/godot-mcp-server";
const ENTRY = `${SERVER_REPO}/dist/index.js`;
const PROJECT = "C:/Users/nicol/OneDrive/Desktop/Personal/AIWithGodot/godot-mcp-toolkit";

type Rpc = { jsonrpc: string; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}
function log(line: string): void {
  process.stdout.write(`[${ts()}] ${line}\n`);
}

class StdioClient {
  proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private waiters = new Map<number, (r: Rpc) => void>();
  private buf = "";
  stderr = "";

  constructor(label: string, extraEnv: Record<string, string> = {}) {
    this.proc = spawn(process.execPath, [ENTRY], {
      cwd: SERVER_REPO,
      env: {
        ...process.env,
        GODOT_MCP_EDITOR_PORT: "6550",
        GODOT_MCP_PROJECT_PATH: PROJECT,
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        let msg: Rpc;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof msg.id === "number") {
          const w = this.waiters.get(msg.id);
          if (w) {
            this.waiters.delete(msg.id);
            w(msg);
          }
        }
      }
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (c: string) => {
      this.stderr += c;
      for (const l of c.split("\n")) if (l.trim()) log(`  (${label} stderr) ${l.trim().slice(0, 160)}`);
    });
  }

  request(method: string, params: unknown, timeoutMs = 20000): Promise<Rpc> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string, params: unknown): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  fire(method: string, params: unknown): void {
    const id = this.nextId++;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  }

  async init(): Promise<number> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "connection-stability-driver", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
    const tl = await this.request("tools/list", {});
    const tools = (tl.result as { tools?: { name: string }[] })?.tools ?? [];
    return tools.length;
  }

  /** One editor-proving round-trip: response must come from the toolkit, not a bridge-local failure. */
  async editorRoundTrip(timeoutMs = 15000): Promise<{ ok: boolean; detail: string }> {
    try {
      const r = await this.request("tools/call", { name: "scene_get_tree", arguments: {} }, timeoutMs);
      const res = r.result as { isError?: boolean; content?: { text?: string }[] } | undefined;
      const text = res?.content?.[0]?.text ?? JSON.stringify(r.error ?? r.result).slice(0, 200);
      const disconnected = /disconnect|not connected|unreachable|CONNECT_FAILED|EDITOR_/i.test(text) && res?.isError;
      if (disconnected) return { ok: false, detail: `editor-unreachable error: ${text.slice(0, 160)}` };
      return { ok: true, detail: `toolkit responded (${text.length} chars${res?.isError ? ", isError" : ""})` };
    } catch (e) {
      return { ok: false, detail: String(e).slice(0, 200) };
    }
  }

  kill(signal: NodeJS.Signals = "SIGKILL"): void {
    try {
      this.proc.kill(signal);
    } catch {
      /* already dead */
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "prep";

  if (mode === "prep") {
    const c = new StdioClient("prep");
    const n = await c.init();
    log(`PREP tools/list => ${n} tools`);
    const tl = await c.request("tools/list", {});
    const tools = (tl.result as { tools: { name: string; inputSchema?: unknown }[] }).tools;
    const scn = tools.find((t) => t.name === "scene_create_node");
    log(`PREP scene_create_node schema: ${scn ? JSON.stringify(scn.inputSchema) : "NOT FOUND (on-demand?)"}`);
    const rt = await c.editorRoundTrip();
    log(`PREP round-trip: ${rt.ok ? "OK" : "FAIL"} — ${rt.detail}`);
    c.kill();
    process.exit(rt.ok ? 0 : 1);
  }

  if (mode === "cycle") {
    // B1 — 5 rapid connect/round-trip/kill cycles.
    let fails = 0;
    for (let i = 1; i <= 5; i++) {
      const t0 = Date.now();
      const c = new StdioClient(`c${i}`);
      try {
        const n = await c.init();
        const rt = await c.editorRoundTrip();
        log(`B1 cycle ${i}: connected (${n} tools), round-trip ${rt.ok ? "OK" : "FAIL — " + rt.detail} in ${Date.now() - t0}ms`);
        if (!rt.ok) fails++;
      } catch (e) {
        fails++;
        log(`B1 cycle ${i}: FAIL — ${String(e).slice(0, 200)}`);
      }
      c.kill();
      await sleep(500);
    }
    log(`B1 done: ${5 - fails}/5 cycles clean`);
    process.exit(fails ? 1 : 0);
  }

  if (mode === "killmid") {
    // B2 — fire calls, hard-kill the bridge mid-flight, then prove a fresh session works.
    const c = new StdioClient("b2");
    await c.init();
    c.fire("tools/call", { name: "scene_get_tree", arguments: {} });
    c.fire("tools/call", { name: "scene_get_tree", arguments: {} });
    c.fire("tools/call", { name: "scene_get_tree", arguments: {} });
    await sleep(120);
    c.kill();
    log("B2: bridge hard-killed with 3 calls in flight");
    await sleep(1500);
    const f = new StdioClient("b2-fresh");
    const n = await f.init();
    const rt = await f.editorRoundTrip();
    log(`B2 fresh session after kill: connected (${n} tools), round-trip ${rt.ok ? "OK" : "FAIL — " + rt.detail}`);
    f.kill();
    process.exit(rt.ok ? 0 : 1);
  }

  if (mode === "restart10") {
    // B3 — hard-kill, wait 10 s, restart, reconnect.
    const a = new StdioClient("b3-a");
    const n1 = await a.init();
    const rt1 = await a.editorRoundTrip();
    log(`B3 first session: ${n1} tools, round-trip ${rt1.ok ? "OK" : "FAIL"}`);
    a.kill();
    log("B3: hard-killed; waiting 10 s…");
    await sleep(10000);
    const b = new StdioClient("b3-b");
    const n2 = await b.init();
    const rt2 = await b.editorRoundTrip();
    log(`B3 restart: ${n2} tools (was ${n1}), round-trip ${rt2.ok ? "OK" : "FAIL — " + rt2.detail}`);
    b.kill();
    process.exit(rt2.ok && n2 === n1 ? 0 : 1);
  }

  if (mode === "hold") {
    // B4/B6/B7 — persistent session; polls a round-trip every 3 s and prints transitions.
    const maxSec = Number(process.argv[3] ?? "600");
    const c = new StdioClient("hold");
    const n = await c.init();
    const rt0 = await c.editorRoundTrip();
    log(`HOLD start: ${n} tools, round-trip ${rt0.ok ? "OK" : "FAIL — " + rt0.detail}`);
    let last = rt0.ok;
    const t0 = Date.now();
    while (Date.now() - t0 < maxSec * 1000) {
      await sleep(3000);
      const rt = await c.editorRoundTrip(6000);
      if (rt.ok !== last) {
        log(`HOLD transition: ${last ? "OK" : "DOWN"} -> ${rt.ok ? "OK" : "DOWN"} — ${rt.detail}`);
        last = rt.ok;
      } else if (!rt.ok) {
        log(`HOLD still DOWN — ${rt.detail.slice(0, 120)}`);
      }
    }
    log(`HOLD ended (max ${maxSec}s) — final state ${last ? "OK" : "DOWN"}`);
    c.kill();
    process.exit(0);
  }

  if (mode === "second") {
    // B5 — second bridge against the same editor while the first holds.
    const a = new StdioClient("b5-a");
    const nA = await a.init();
    const rtA0 = await a.editorRoundTrip();
    log(`B5 first: ${nA} tools, round-trip ${rtA0.ok ? "OK" : "FAIL"}`);
    const b = new StdioClient("b5-b");
    try {
      const nB = await b.init();
      const rtB = await b.editorRoundTrip(10000);
      log(`B5 second: init ok (${nB} tools), round-trip ${rtB.ok ? "OK (dual accepted)" : "REJECTED — " + rtB.detail}`);
    } catch (e) {
      log(`B5 second: errored — ${String(e).slice(0, 200)}`);
    }
    const rtA1 = await a.editorRoundTrip();
    log(`B5 first after second's attempt: round-trip ${rtA1.ok ? "STILL OK" : "BROKEN — " + rtA1.detail}`);
    a.kill();
    b.kill();
    process.exit(rtA1.ok ? 0 : 1);
  }

  if (mode === "b8") {
    // B8 — editor hard-kill mid-mutation: queue 30 mutations, kill Godot mid-queue,
    // assert the pendings fail PROMPTLY with a clean error (no indefinite hang).
    const godotPid = Number(process.argv[3]);
    const args = JSON.parse(process.argv[4] ?? "{}") as Record<string, unknown>;
    if (!godotPid) throw new Error("b8 needs <godotPid> <argsJson>");
    const c = new StdioClient("b8");
    await c.init();
    const t0 = Date.now();
    const pendings: Promise<Rpc>[] = [];
    for (let i = 1; i <= 30; i++) {
      pendings.push(
        c.request(
          "tools/call",
          { name: "scene_create_node", arguments: { ...args, node_name: `B8Probe_${i}` } },
          20000,
        ),
      );
    }
    await sleep(30);
    process.kill(godotPid);
    const tKill = Date.now();
    log(`B8: Godot PID ${godotPid} hard-killed ${tKill - t0}ms after 30 mutations were queued`);
    const settled = await Promise.allSettled(pendings);
    const tSettle = Date.now();
    let okCount = 0;
    let errCount = 0;
    let rejCount = 0;
    let sampleErr = "";
    for (const s of settled) {
      if (s.status === "rejected") {
        rejCount++;
        if (!sampleErr) sampleErr = `driver-timeout: ${String(s.reason).slice(0, 200)}`;
        continue;
      }
      const res = s.value.result as { isError?: boolean; content?: { text?: string }[] } | undefined;
      const text = res?.content?.[0]?.text ?? JSON.stringify(s.value.error ?? s.value.result);
      if (res?.isError || s.value.error !== undefined) {
        errCount++;
        if (!sampleErr) sampleErr = String(text).slice(0, 220);
      } else {
        okCount++;
      }
    }
    log(
      `B8: all 30 settled ${tSettle - tKill}ms after the kill — ${okCount} succeeded pre-kill, ${errCount} clean-error, ${rejCount} driver-timeout`,
    );
    log(`B8: sample failure surface: ${sampleErr || "(none)"}`);
    c.kill();
    process.exit(rejCount === 0 ? 0 : 1);
  }

  if (mode === "call") {
    // Generic one-shot tool call (HE-phase driver). Auto-activates on-demand tools
    // via discover_tools (param name is `request`) when the direct call misses.
    const toolName = process.argv[3];
    const args = JSON.parse(process.argv[4] ?? "{}") as Record<string, unknown>;
    if (!toolName) throw new Error("call needs <toolName> [argsJson]");
    const c = new StdioClient("call");
    await c.init();
    let r = await c.request("tools/call", { name: toolName, arguments: args }, 30000);
    const missed = (x: Rpc): boolean =>
      JSON.stringify(x.error ?? (x.result as { content?: { text?: string }[] })?.content?.[0]?.text ?? "").includes(
        "not found",
      );
    if (missed(r)) {
      const d = await c.request("tools/call", { name: "discover_tools", arguments: { request: toolName } }, 20000);
      const dres = d.result as { content?: { text?: string }[] } | undefined;
      log(`CALL discovery: ${String(dres?.content?.[0]?.text ?? JSON.stringify(d.error)).slice(0, 240)}`);
      r = await c.request("tools/call", { name: toolName, arguments: args }, 30000);
    }
    const res = r.result as { isError?: boolean; content?: { text?: string }[] } | undefined;
    const text = res?.content?.[0]?.text ?? JSON.stringify(r.error ?? r.result);
    log(`CALL ${toolName}: isError=${res?.isError ?? "n/a"} ${String(text).slice(0, 800)}`);
    c.kill();
    process.exit(res?.isError ? 1 : 0);
  }

  throw new Error(`unknown mode: ${mode}`);
}

main().catch((e) => {
  log(`DRIVER ERROR: ${String(e).slice(0, 400)}`);
  process.exit(2);
});

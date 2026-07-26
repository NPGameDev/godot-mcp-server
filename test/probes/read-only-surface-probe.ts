/**
 * Read-only surface probe for the release checklist (§2, D4).
 *
 * Spawns the BUILT server (`dist/index.js`) twice over MCP stdio — once normally,
 * once with `GODOT_MCP_READ_ONLY=1` — performs the MCP `initialize` handshake,
 * calls `tools/list`, and diffs the two surfaces. Asserts:
 *   - mutating tools (scene_create_node & friends) are ABSENT under read-only,
 *   - read tools (scene_get_tree & friends) are still PRESENT,
 *   - a direct tools/call of an unregistered mutating tool is rejected by the MCP
 *     layer before the toolkit ever sees it.
 *
 * Speaks raw newline-delimited JSON-RPC over the child's stdio — no MCP SDK
 * client needed, so the probe stays dependency-free and can live outside the repo.
 * Both children are killed cleanly at the end; the running Godot editor is never
 * touched beyond a read-only tools/list handshake.
 *
 * Run from the server repo:
 *   node_modules/.bin/tsx <abs-path-to-this-file>
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const SERVER_REPO = "C:/Users/nicol/OneDrive/Desktop/Personal/AIWithGodot/godot-mcp-server";
const ENTRY = `${SERVER_REPO}/dist/index.js`;
const PROJECT = "C:/Users/nicol/OneDrive/Desktop/Personal/AIWithGodot/godot-mcp-toolkit";

let failures = 0;
let total = 0;

function report(ok: boolean, label: string, detail: string): void {
  total++;
  if (!ok) failures++;
  process.stdout.write(`[d4] ${ok ? "PASS" : "FAIL"} ${label} — ${detail}\n`);
}

type Rpc = { jsonrpc: string; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };

/** A spawned MCP server speaking newline-delimited JSON-RPC on stdio. */
class StdioClient {
  proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private waiters = new Map<number, (r: Rpc) => void>();
  private buf = "";
  stderr = "";

  constructor(extraEnv: Record<string, string>) {
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
    });
  }

  request(method: string, params: unknown, timeoutMs = 30000): Promise<Rpc> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms; stderr=${this.stderr.slice(-500)}`));
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

  async handshake(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "read-only-surface-probe", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<string[]> {
    const res = await this.request("tools/list", {});
    const tools = (res.result as { tools?: { name: string }[] })?.tools ?? [];
    return tools.map((t) => t.name).sort();
  }

  kill(): void {
    try {
      this.proc.stdin.end();
    } catch {
      /* already closed */
    }
    this.proc.kill();
  }
}

// Representative EAGER mutating tools that must vanish under read-only, and read
// tools that must survive. Kept small + explicit so the evidence is legible.
// (`file_delete` is deliberately NOT here — it is an ON-DEMAND tool, absent from
// the startup surface in both modes; it is checked separately below, after the
// `cleanup` group is activated, which is the stricter test.)
const MUST_BE_ABSENT = ["scene_create_node", "scene_delete_node", "script_write", "node_manage", "execute_code"];
const MUST_BE_PRESENT = ["scene_get_tree", "script_read", "discover_tools"];

/** On-demand mutators that must stay hidden even AFTER their group is activated. */
const ON_DEMAND_MUTATORS = ["file_delete", "folder_delete"];
const ON_DEMAND_GROUP = "cleanup";

async function main(): Promise<void> {
  // ── Baseline (normal mode) ───────────────────────────────────────────────
  const normal = new StdioClient({});
  // Declared without an initializer: the try below assigns them, and the catch path
  // exits, so an initial value would only ever be dead.
  let normalTools: string[];
  let normalAfterGroup: string[];
  try {
    await normal.handshake();
    normalTools = await normal.listTools();
    process.stdout.write(`[d4] normal-mode tools/list: ${normalTools.length} tools\n`);
    // Activate the on-demand group so the on-demand mutators become visible —
    // the control half of the on-demand read-only check below.
    await normal.request("tools/call", { name: "discover_tools", arguments: { request: ON_DEMAND_GROUP } });
    normalAfterGroup = await normal.listTools();
    process.stdout.write(
      `[d4] normal-mode after discover_tools("${ON_DEMAND_GROUP}"): ${normalAfterGroup.length} tools\n`,
    );
  } finally {
    normal.kill();
  }
  await new Promise((r) => setTimeout(r, 1500));

  // ── Read-only mode ───────────────────────────────────────────────────────
  const ro = new StdioClient({ GODOT_MCP_READ_ONLY: "1" });
  let roTools: string[];
  let roAfterGroup: string[];
  let directCall: string;
  try {
    await ro.handshake();
    roTools = await ro.listTools();
    process.stdout.write(`[d4] read-only tools/list: ${roTools.length} tools\n`);

    // On-demand half: activating the group must NOT surface its mutators.
    await ro.request("tools/call", { name: "discover_tools", arguments: { request: ON_DEMAND_GROUP } });
    roAfterGroup = await ro.listTools();
    process.stdout.write(`[d4] read-only after discover_tools("${ON_DEMAND_GROUP}"): ${roAfterGroup.length} tools\n`);

    // Direct call of an unregistered mutating tool — MCP layer must reject it.
    const res = await ro.request("tools/call", {
      name: "scene_create_node",
      arguments: { class_name: "Node", parent_path: ".", node_name: "D4ReadOnlyProbe" },
    });
    directCall = JSON.stringify(res.error ?? res.result).slice(0, 400);
  } finally {
    ro.kill();
  }

  const roSet = new Set(roTools);
  const normalSet = new Set(normalTools);

  const absent = MUST_BE_ABSENT.filter((t) => !roSet.has(t));
  const leaked = MUST_BE_ABSENT.filter((t) => roSet.has(t));
  report(
    leaked.length === 0,
    "D4 mutating tools ABSENT from read-only tools/list",
    leaked.length === 0
      ? `all ${absent.length} checked mutators absent: ${absent.join(", ")}`
      : `LEAKED: ${leaked.join(", ")}`,
  );

  const presentOk = MUST_BE_PRESENT.filter((t) => roSet.has(t));
  const missing = MUST_BE_PRESENT.filter((t) => !roSet.has(t));
  report(
    missing.length === 0,
    "D4 read tools STILL PRESENT under read-only",
    missing.length === 0 ? `present: ${presentOk.join(", ")}` : `MISSING: ${missing.join(", ")}`,
  );

  // Baseline sanity: the mutators must be present WITHOUT read-only, else the
  // absence above proves nothing.
  const baselineHas = MUST_BE_ABSENT.filter((t) => normalSet.has(t));
  report(
    baselineHas.length === MUST_BE_ABSENT.length,
    "D4 control: those same mutators ARE present in normal mode",
    `normal-mode has ${baselineHas.length}/${MUST_BE_ABSENT.length}: ${baselineHas.join(", ")}`,
  );

  const removed = normalTools.filter((t) => !roSet.has(t));
  const added = roTools.filter((t) => !normalSet.has(t));
  process.stdout.write(
    `\n[d4] DELTA normal(${normalTools.length}) -> read-only(${roTools.length}):\n` +
      `  removed (${removed.length}): ${removed.join(", ") || "(none)"}\n` +
      `  added   (${added.length}): ${added.join(", ") || "(none)"}\n`,
  );
  process.stdout.write(`[d4] normal-mode tool names: ${normalTools.join(", ")}\n`);
  process.stdout.write(`[d4] read-only tool names:  ${roTools.join(", ")}\n`);

  report(
    removed.length > 0,
    "D4 read-only surface is strictly smaller",
    `${removed.length} tools removed, ${added.length} added`,
  );
  report(
    /not\s*found|unknown tool|Tool .* not found|-32602|-32601/i.test(directCall),
    "D4 direct tools/call of an unregistered mutator rejected by the MCP layer",
    directCall,
  );

  // ── On-demand mutators stay hidden even after group activation ───────────
  const normalGroupSet = new Set(normalAfterGroup);
  const roGroupSet = new Set(roAfterGroup);
  const controlVisible = ON_DEMAND_MUTATORS.filter((t) => normalGroupSet.has(t));
  const roVisible = ON_DEMAND_MUTATORS.filter((t) => roGroupSet.has(t));
  report(
    controlVisible.length > 0,
    `D4 control: on-demand mutators appear in NORMAL mode after discover_tools("${ON_DEMAND_GROUP}")`,
    `visible: ${controlVisible.join(", ") || "(none — control inconclusive)"} (list grew ${normalTools.length} -> ${normalAfterGroup.length})`,
  );
  report(
    roVisible.length === 0,
    `D4 on-demand mutators STILL ABSENT under read-only after discover_tools("${ON_DEMAND_GROUP}")`,
    roVisible.length === 0
      ? `none of [${ON_DEMAND_MUTATORS.join(", ")}] surfaced (list ${roTools.length} -> ${roAfterGroup.length})`
      : `LEAKED: ${roVisible.join(", ")}`,
  );

  process.stdout.write(`\n[d4] ${total - failures} passed, ${failures} failed, ${total} total\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`[d4] FATAL ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(3);
});

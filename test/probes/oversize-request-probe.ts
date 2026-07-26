/**
 * Supplementary security probes for the release checklist (§2).
 *
 *  1. D5c POSITIVE CONTROL — proves the "node absent" assertion in
 *     path-guard-and-auth-probe.ts is not vacuous: dumps the real scene tree, asserts it
 *     has a root name and children, then round-trips a create/delete of a
 *     control node so we know the tree WOULD have shown a leaked node.
 *  2. D7 (literal reading) — an oversized *request* payload. The smoke slice
 *     (section 21) proves the oversized-RESPONSE cap; this proves the inbound
 *     direction: a ~10 MB request is handled gracefully (rejected/closed), the
 *     editor survives, and the next call on a fresh session still works.
 *
 * Dependency-free (Node global WebSocket). Run from the server repo:
 *   node_modules/.bin/tsx <abs-path-to-this-file>
 */

const HOST = "127.0.0.1";
const PORT = Number(process.env.GODOT_MCP_EDITOR_PORT ?? "6550");
const URL = `ws://${HOST}:${PORT}`;
const TOKEN = process.env.GODOT_MCP_TOKEN ?? "";

let failures = 0;
let total = 0;

function report(ok: boolean, label: string, detail: string): void {
  total++;
  if (!ok) failures++;
  process.stdout.write(`[d7probe] ${ok ? "PASS" : "FAIL"} ${label} — ${detail}\n`);
}

type Rpc = { id?: string | number | null; result?: unknown; error?: unknown };

class Session {
  ws!: WebSocket;
  private nextId = 1;
  private waiters = new Map<string, (r: Rpc) => void>();
  closeInfo: { code: number; reason: string } | undefined;
  errored = false;

  async open(token: string): Promise<boolean> {
    this.ws = new WebSocket(URL);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      this.ws.addEventListener("open", () => this.ws.send(JSON.stringify({ auth: token, version: "1.0.0" })));
      this.ws.addEventListener("message", (ev: MessageEvent) => {
        let msg: Rpc & { authed?: boolean };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.authed === true) {
          clearTimeout(timer);
          resolve(true);
          return;
        }
        if (msg.id != null) {
          const w = this.waiters.get(String(msg.id));
          if (w) {
            this.waiters.delete(String(msg.id));
            w(msg);
          }
        }
      });
      this.ws.addEventListener("close", (ev: CloseEvent) => {
        this.closeInfo = { code: ev.code, reason: ev.reason };
        clearTimeout(timer);
        resolve(false);
      });
      this.ws.addEventListener("error", () => {
        this.errored = true;
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  call(method: string, params: unknown, timeoutMs = 10000): Promise<unknown> {
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.set(id, (r) => {
        clearTimeout(timer);
        resolve(r.error !== undefined ? r.error : r.result);
      });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

async function main(): Promise<void> {
  if (!TOKEN) {
    process.stderr.write("[d7probe] ERROR: GODOT_MCP_TOKEN not set\n");
    process.exit(2);
  }

  // ── 1. D5c positive control ──────────────────────────────────────────────
  const s = new Session();
  if (!(await s.open(TOKEN))) {
    process.stderr.write("[d7probe] FATAL: could not authenticate\n");
    process.exit(2);
  }
  const treeRes = (await s.call("scene.get_tree", null)) as { tree?: string; code?: string };
  const treeText = typeof treeRes?.tree === "string" ? treeRes.tree : JSON.stringify(treeRes);
  process.stdout.write(`[d7probe] raw scene.get_tree = ${treeText}\n`);
  const looksReal = typeof treeRes?.tree === "string" && treeRes.code === undefined && /"name"\s*:/.test(treeText);
  report(looksReal, "D5c control: scene.get_tree returns a REAL tree (not an error envelope)", treeText.slice(0, 200));

  const CONTROL = "D5PositiveControl";
  const created = (await s.call("scene.create_node", {
    class_name: "Node",
    parent_path: ".",
    node_name: CONTROL,
  })) as { path?: string; status?: string; code?: string };
  const afterCreate = (await s.call("scene.get_tree", null)) as { tree?: string };
  const afterText = typeof afterCreate?.tree === "string" ? afterCreate.tree : JSON.stringify(afterCreate);
  report(
    afterText.includes(CONTROL),
    "D5c control: a REALLY created node IS visible in scene.get_tree",
    `create=${JSON.stringify(created)} treeContains=${afterText.includes(CONTROL)} len=${afterText.length}`,
  );
  // Clean up the control node — leave the dogfood scene as we found it.
  const deleted = await s.call("scene.delete_node", { node_path: created?.path ?? CONTROL });
  const afterDelete = (await s.call("scene.get_tree", null)) as { tree?: string };
  const delText = typeof afterDelete?.tree === "string" ? afterDelete.tree : JSON.stringify(afterDelete);
  report(
    !delText.includes(CONTROL),
    "D5c control: control node cleaned up",
    `delete=${JSON.stringify(deleted)} len=${delText.length}`,
  );
  s.close();

  // ── 2. D7 — oversized inbound request ────────────────────────────────────
  await new Promise((r) => setTimeout(r, 500));
  const big = new Session();
  if (!(await big.open(TOKEN))) {
    report(false, "D7 setup", "could not authenticate the oversize session");
  } else {
    // ~10 MB of script content in a single JSON-RPC frame.
    const payload = "A".repeat(10 * 1024 * 1024);
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      id: "big",
      method: "script.write",
      params: { file_path: "res://d7_oversize_probe.gd", content: payload },
    });
    process.stdout.write(`[d7probe] sending ${frame.length} byte frame (~${(frame.length / 1048576).toFixed(1)} MB)\n`);
    const outcome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("no-response-within-20s"), 20000);
      big.ws.addEventListener("message", (ev: MessageEvent) => {
        clearTimeout(timer);
        resolve(`response: ${String(ev.data).slice(0, 400)}`);
      });
      big.ws.addEventListener("close", (ev: CloseEvent) => {
        clearTimeout(timer);
        resolve(`closed: code=${ev.code} reason=${JSON.stringify(ev.reason)}`);
      });
      big.ws.addEventListener("error", () => {
        clearTimeout(timer);
        resolve("socket error");
      });
      try {
        big.sendRaw(frame);
      } catch (e) {
        clearTimeout(timer);
        resolve(`send threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    process.stdout.write(`[d7probe] 10MB frame outcome — ${outcome}\n`);
    big.close();
  }

  // The real D7 assertion: the editor SURVIVED and still serves calls.
  await new Promise((r) => setTimeout(r, 1500));
  const after = new Session();
  const stillUp = await after.open(TOKEN);
  let stillServes = false;
  let probeFileState = "not-checked";
  if (stillUp) {
    try {
      const t = (await after.call("scene.get_tree", null)) as { tree?: string };
      stillServes = typeof t?.tree === "string";
      // If the oversized write partially landed, the file would exist.
      const read = (await after.call("script.read", { file_path: "res://d7_oversize_probe.gd" })) as {
        code?: string;
        content?: string;
      };
      probeFileState = read?.code ?? `EXISTS (len=${String(read?.content ?? "").length})`;
    } catch (e) {
      stillServes = false;
      probeFileState = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  report(
    stillUp && stillServes,
    "D7 editor survives a ~10MB inbound frame and still serves calls",
    `reauth=${stillUp} sceneQueryOk=${stillServes} oversizeProbeFile=${probeFileState}`,
  );
  after.close();

  process.stdout.write(`\n[d7probe] ${total - failures} passed, ${failures} failed, ${total} total\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`[d7probe] FATAL ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(3);
});

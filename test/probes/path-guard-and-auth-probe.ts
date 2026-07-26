/**
 * Security hand-probes for the release checklist (§2) — D2 (absolute path), D3 (`user://` on a
 * non-whitelisted tool), D5 (invalid auth token).
 *
 * Talks the toolkit's RAW WebSocket wire protocol directly (auth frame, then
 * JSON-RPC), so it observes exactly what the plugin's FileGuard / auth layer
 * returns — no server-side response shaping in the way. Dependency-free: uses
 * Node's global WebSocket (Node >= 22), so it can live outside the server repo.
 *
 * Run from the server repo:
 *   node_modules/.bin/tsx <abs-path-to-this-file>
 *
 * Env: GODOT_MCP_EDITOR_PORT (default 6550), GODOT_MCP_TOKEN (required —
 * the toolkit session token).
 */

const HOST = "127.0.0.1";
const PORT = Number(process.env.GODOT_MCP_EDITOR_PORT ?? "6550");
const URL = `ws://${HOST}:${PORT}`;
const TOKEN = process.env.GODOT_MCP_TOKEN ?? "";
const CALL_TIMEOUT = 8000;

let failures = 0;
const lines: string[] = [];

function report(ok: boolean, label: string, detail: string): void {
  const tag = ok ? "PASS" : "FAIL";
  const line = `[d2d3d5] ${tag} ${label} — ${detail}`;
  if (!ok) failures++;
  lines.push(line);
  process.stdout.write(line + "\n");
}

type Rpc = { jsonrpc?: string; id?: string | number | null; result?: unknown; error?: unknown };
type Guard = { success?: boolean; code?: string; error?: string; hint?: string };

/** An authenticated raw WS session against the toolkit. */
class Session {
  ws!: WebSocket;
  private nextId = 1;
  private waiters = new Map<string, (r: Rpc) => void>();
  /** Everything the peer sent, in order — evidence for the auth-rejection probe. */
  frames: string[] = [];
  closeInfo: { code: number; reason: string } | undefined;

  async open(token: string, expectAuthOk: boolean): Promise<boolean> {
    this.ws = new WebSocket(URL);
    const authed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 6000);
      this.ws.addEventListener("open", () => {
        this.ws.send(JSON.stringify({ auth: token, version: "1.0.0" }));
      });
      this.ws.addEventListener("message", (ev: MessageEvent) => {
        const text = String(ev.data);
        this.frames.push(text);
        let msg: Rpc & { authed?: boolean };
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (msg.authed === true) {
          clearTimeout(timer);
          resolve(true);
          return;
        }
        // Route JSON-RPC responses to their waiter; ignore notifications.
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
        clearTimeout(timer);
        resolve(false);
      });
    });
    if (expectAuthOk && !authed) {
      throw new Error(`auth failed unexpectedly (close=${JSON.stringify(this.closeInfo)})`);
    }
    return authed;
  }

  call(method: string, params: unknown, timeoutMs = CALL_TIMEOUT): Promise<unknown> {
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.set(id, (r) => {
        clearTimeout(timer);
        if (r.error !== undefined) resolve(r.error);
        else resolve(r.result);
      });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /** Send a raw frame with no response expectation (unauthed-execution probe). */
  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/** Assert a rejection envelope with the expected code + message substring. */
function assertDenied(label: string, result: unknown, code: string, mustInclude?: string): void {
  const r = result as Guard;
  const payload = JSON.stringify(result);
  if (r?.success !== false || r.code !== code) {
    report(false, label, `expected {success:false, code:${code}}, got ${payload}`);
  } else if (mustInclude && !r.error?.includes(mustInclude)) {
    report(false, label, `message missing "${mustInclude}" in ${payload}`);
  } else {
    report(true, label, payload);
  }
}

async function main(): Promise<void> {
  if (!TOKEN) {
    process.stderr.write("[d2d3d5] ERROR: GODOT_MCP_TOKEN not set\n");
    process.exit(2);
  }

  const s = new Session();
  await s.open(TOKEN, true);
  report(true, "setup: authenticated with the live toolkit token", `${URL} accepted the session token`);

  // ── D2 — absolute OS path ────────────────────────────────────────────────
  // The literal checklist case plus the mutating siblings, so the guard is
  // proven on a read tool, a delete tool and a create tool.
  assertDenied(
    "D2 script.read C:\\Windows\\System32\\cmd.exe",
    await s.call("script.read", { file_path: "C:\\Windows\\System32\\cmd.exe" }),
    "PATH_DENIED",
    "absolute",
  );
  assertDenied(
    "D2 script.read C:/Windows/System32/cmd.exe (forward slashes)",
    await s.call("script.read", { file_path: "C:/Windows/System32/cmd.exe" }),
    "PATH_DENIED",
    "absolute",
  );
  assertDenied(
    "D2 resource.load C:\\Windows\\win.ini",
    await s.call("resource.load", { file_path: "C:\\Windows\\win.ini" }),
    "PATH_DENIED",
    "absolute",
  );
  assertDenied(
    "D2 file.delete C:\\Windows\\System32\\cmd.exe (mutating)",
    await s.call("file.delete", { file_path: "C:\\Windows\\System32\\cmd.exe" }),
    "PATH_DENIED",
    "absolute",
  );
  assertDenied(
    "D2 folder.create C:\\Windows\\pwned (mutating)",
    await s.call("folder.create", { path: "C:\\Windows\\pwned" }),
    "PATH_DENIED",
    "absolute",
  );
  assertDenied(
    "D2 script.write C:\\Windows\\Temp\\pwned.gd (mutating)",
    await s.call("script.write", { file_path: "C:\\Windows\\Temp\\pwned.gd", content: "extends Node\n" }),
    "PATH_DENIED",
    "absolute",
  );
  assertDenied(
    "D2 UNC path \\\\server\\share\\x.gd",
    await s.call("script.read", { file_path: "\\\\server\\share\\x.gd" }),
    "PATH_DENIED",
  );

  // ── D3 — `user://` on a NON-whitelisted tool ─────────────────────────────
  // user:// is reachable only from the user-scope whitelist (editor.screenshot →
  // user://screenshots/). Every res:// tool family must refuse it.
  assertDenied(
    "D3 script.read user://addons/godot_mcp_toolkit/... (token dir)",
    await s.call("script.read", {
      file_path: "user://addons/godot_mcp_toolkit/project_instance_640d286aa153/mcp_token",
    }),
    "PATH_DENIED",
  );
  assertDenied(
    "D3 script.read user://anything.gd",
    await s.call("script.read", { file_path: "user://anything.gd" }),
    "PATH_DENIED",
  );
  assertDenied(
    "D3 resource.load user://x.tres",
    await s.call("resource.load", { file_path: "user://x.tres" }),
    "PATH_DENIED",
  );
  assertDenied(
    "D3 folder.create user://pwned (mutating)",
    await s.call("folder.create", { path: "user://pwned" }),
    "PATH_DENIED",
  );
  assertDenied(
    "D3 file.delete user://x.gd (mutating)",
    await s.call("file.delete", { file_path: "user://x.gd" }),
    "PATH_DENIED",
  );
  assertDenied(
    "D3 script.write user://pwned.gd (mutating)",
    await s.call("script.write", { file_path: "user://pwned.gd", content: "extends Node\n" }),
    "PATH_DENIED",
  );
  // The whitelisted tool must still refuse a user:// path OUTSIDE its allowed
  // prefix — the whitelist is per-prefix, not per-tool-blanket.
  assertDenied(
    "D3 editor.screenshot user://elsewhere/x.png (outside allowed prefix)",
    await s.call("editor.screenshot", { save_path: "user://elsewhere/x.png" }, 15000),
    "PATH_DENIED",
    "user://screenshots",
  );

  s.close();

  // ── D5 — invalid / expired auth token ────────────────────────────────────
  // (a) A wrong token must never yield {authed:true}; the peer is closed.
  const bad = new Session();
  const badAuthed = await bad.open("f".repeat(64), false);
  await new Promise((r) => setTimeout(r, 500));
  if (badAuthed) {
    report(false, "D5a wrong 64-hex token", `AUTHENTICATED — expected rejection. frames=${JSON.stringify(bad.frames)}`);
  } else {
    report(
      true,
      "D5a wrong 64-hex token",
      `rejected: close=${JSON.stringify(bad.closeInfo)} frames=${JSON.stringify(bad.frames)}`,
    );
  }
  bad.close();

  // (b) An EXPIRED-shaped token (a real token from another project instance).
  const stale = new Session();
  const staleAuthed = await stale.open("16c96063" + "0".repeat(56), false);
  await new Promise((r) => setTimeout(r, 500));
  report(
    !staleAuthed,
    "D5b stale/expired-shaped token (correct prefix, wrong body)",
    staleAuthed ? "AUTHENTICATED — expected rejection" : `rejected: close=${JSON.stringify(stale.closeInfo)}`,
  );
  stale.close();

  // (c) NO PARTIAL EXECUTION: fire a mutating command on an unauthed socket and
  // prove afterwards (over an authed socket) that nothing was created.
  const MUTATION_NODE = "D5UnauthedProbe";
  const sneak = new Session();
  await new Promise<void>((resolve) => {
    sneak.ws = new WebSocket(URL);
    sneak.ws.addEventListener("open", () => {
      // No auth frame at all — straight to a mutation.
      sneak.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "scene.create_node",
          params: { class_name: "Node", parent_path: ".", node_name: MUTATION_NODE },
        }),
      );
    });
    sneak.ws.addEventListener("message", (ev: MessageEvent) => sneak.frames.push(String(ev.data)));
    sneak.ws.addEventListener("close", (ev: CloseEvent) => {
      sneak.closeInfo = { code: ev.code, reason: ev.reason };
      resolve();
    });
    sneak.ws.addEventListener("error", () => resolve());
    setTimeout(resolve, 4000);
  });
  report(
    sneak.closeInfo?.code === 1008,
    "D5c mutation on an UNAUTHED socket -> closed",
    `close=${JSON.stringify(sneak.closeInfo)} frames=${JSON.stringify(sneak.frames)}`,
  );
  sneak.close();

  // Re-auth properly and confirm the node was never created.
  const verify = new Session();
  await verify.open(TOKEN, true);
  const tree = (await verify.call("scene.get_tree", null)) as { tree?: string };
  const treeText = typeof tree?.tree === "string" ? tree.tree : JSON.stringify(tree);
  const leaked = treeText.includes(MUTATION_NODE);
  report(
    !leaked,
    "D5c no partial execution (node absent from scene tree)",
    leaked
      ? `LEAKED: ${MUTATION_NODE} found in the tree`
      : `${MUTATION_NODE} absent; tree length=${treeText.length} chars`,
  );
  verify.close();

  process.stdout.write(`\n[d2d3d5] ${lines.length - failures} passed, ${failures} failed, ${lines.length} total\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`[d2d3d5] FATAL ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(3);
});

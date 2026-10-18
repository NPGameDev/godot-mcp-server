/**
 * Guard test for the stdio contract before `initialize`.
 *
 * MCP clients from spec 2026-07-28 probe legacy servers with an unknown pre-initialize
 * method ("server/discover") and fall back to `initialize` only if the probe gets a
 * prompt JSON-RPC error. This spawns the server over stdio and pins that the v1-SDK
 * server answers at once and keeps stdout clean: every stdout line is JSON-RPC. The SDK
 * v2 migration itself is release C1 (2.0.0).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEAD_PORT = 6599; // outside the editor (6550-6560) and runtime (6570-6585) scans
const portOpen = await new Promise<boolean>((resolve) => {
  const s = createConnection({ host: "127.0.0.1", port: DEAD_PORT });
  s.once("connect", () => {
    s.destroy();
    resolve(true);
  });
  s.once("error", () => resolve(false));
});
assert.equal(portOpen, false, `port ${DEAD_PORT} must be closed: the probe pins the editor port there`);

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist", "index.js");
const args = existsSync(dist) ? [dist] : ["--import", "tsx", join(root, "src", "index.ts")];
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
  // Mandatory: eager extension discovery runs before stdio connects and waits up to
  // 8 s on a live editor; a dead port refuses in milliseconds.
  env: { ...process.env, GODOT_MCP_EDITOR_PORT: String(DEAD_PORT) },
});
const lines: string[] = [];
let buf = "";
let stderr = "";
child.stderr.on("data", (chunk: Buffer) => {
  stderr += chunk.toString();
});
const answered = new Promise<Record<string, unknown>>((resolve, reject) => {
  const fail = (reason: string): void => {
    clearTimeout(timer);
    reject(new Error(`${reason}\n--- server stderr so far ---\n${stderr}`));
  };
  // 15 s: the cross-version runners start the server through tsx without a build.
  const timer = setTimeout(() => fail("no reply to server/discover within 15 s"), 15_000);
  child.once("error", (err) => fail(`the server failed to start: ${err.message}`));
  child.once("exit", (code, signal) => fail(`the server exited before replying (code ${code}, signal ${signal})`));
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      lines.push(line);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        fail(`stdout carried a non-JSON line: ${line}`);
        return;
      }
      if (msg.id === 1) {
        clearTimeout(timer);
        resolve(msg);
      }
    }
  });
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }) + "\n");
try {
  const reply = await answered;
  assert.equal(reply.jsonrpc, "2.0");
  assert.ok(reply.error && typeof (reply.error as { code: unknown }).code === "number", "JSON-RPC error object");
  assert.equal("result" in reply, false);
  for (const l of lines)
    assert.equal((JSON.parse(l) as { jsonrpc: string }).jsonrpc, "2.0", "stdout carries only JSON-RPC");
  console.log(
    `  PASS: server/discover → error ${(reply.error as { code: number }).code}; ${lines.length} stdout line(s), all JSON-RPC`,
  );
} finally {
  child.kill();
}
console.log("All 1 stdio pre-initialize tests passed.");

// Raw GDScript-LSP wire probe. Connects straight to the editor's language
// server (no LspClient, no bridge), performs initialize/didOpen for one file,
// and prints every inbound frame with its byte size and non-ASCII byte count.
//
// Use it to tell apart, from outside the product code:
//   - "the editor publishes nothing" (editor/environment problem), vs
//   - "the editor publishes but the client never sees it" (client framing
//     problem — compare against what src/lsp/lspClient.ts observes).
//
// The framing here is deliberately byte-accurate (Buffer end to end): frames
// are split on raw bytes and only each complete body is decoded, so a
// multi-byte UTF-8 character straddling a TCP chunk boundary cannot corrupt
// the parse. Any client that stringifies per-chunk will disagree with this
// probe on streams that carry multi-byte content — that disagreement is the
// diagnostic signal.
//
// Two verified editor behaviors worth re-probing when diagnostics go silent:
// the editor DOES answer a didOpen for a file outside its workspace (it
// parses the sent text directly), and it CANONICALIZES the URI in its
// publishDiagnostics reply (resolves `..`, symlinks may resolve likewise) —
// so a client that waits on the exact URI it sent can miss a publish that
// arrives under the resolved form.
//
// Usage: node_modules/.bin/tsx test/probes/lsp-raw-probe.mts [projectPath] [relativeGdFile] [port]
//   defaults: the dogfood playground, its random_thing.gd, 6005
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

type LspMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: { uri?: string; diagnostics?: unknown[]; path?: string };
};

const PROJ = (
  process.argv[2] ?? "C:/Users/nicol/OneDrive/Desktop/Personal/AIWithGodot/godot-mcp-dogfood-playground"
).replace(/\\/g, "/");
const REL = process.argv[3] ?? "random_thing.gd";
const PORT = Number(process.argv[4] ?? 6005);
const FILE = PROJ.replace(/\/$/, "") + "/" + REL;
const uri = "file:///" + FILE;
const text = fs.readFileSync(path.normalize(FILE), "utf8");

let buf = Buffer.alloc(0);
const sock = net.connect(PORT, "127.0.0.1");
const t0 = Date.now();
const ts = (): string => "+" + ((Date.now() - t0) / 1000).toFixed(1) + "s";

function nonAsciiCount(bytes: Buffer): number {
  let n = 0;
  for (const b of bytes) if (b > 0x7f) n++;
  return n;
}

function send(obj: object & { method?: string; id?: number }): void {
  const s = JSON.stringify(obj);
  sock.write("Content-Length: " + Buffer.byteLength(s) + "\r\n\r\n" + s);
  console.log(ts(), "[send]", obj.method ?? "resp#" + obj.id);
}

sock.on("connect", () => {
  console.log(ts(), "[tcp] connected to", PORT);
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      processId: null,
      rootUri: "file:///" + PROJ,
      capabilities: { textDocument: { publishDiagnostics: {} } },
    },
  });
});

sock.on("data", (d: Buffer) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const i = buf.indexOf("\r\n\r\n");
    if (i < 0) break;
    const m = /Content-Length: (\d+)/i.exec(buf.subarray(0, i).toString("ascii"));
    if (!m) {
      console.log(ts(), "[bad header]", buf.subarray(0, i).toString("ascii"));
      process.exit(2);
    }
    const len = Number(m[1]);
    if (buf.length < i + 4 + len) break;
    const bodyBytes = buf.subarray(i + 4, i + 4 + len);
    buf = buf.subarray(i + 4 + len);
    const body = bodyBytes.toString("utf8");
    let msg: LspMessage;
    try {
      msg = JSON.parse(body) as LspMessage;
    } catch {
      console.log(ts(), "[unparseable]", body.slice(0, 200));
      continue;
    }
    const meta = "bytes=" + len + " nonAscii=" + nonAsciiCount(bodyBytes);
    if (msg.id === 1) {
      console.log(ts(), "[recv] initialize response", meta);
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
      send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "gdscript", version: 1, text } },
      });
      console.log(ts(), "[send] didOpen uri=", uri);
      setTimeout(() => {
        console.log(ts(), "[done] 20s window elapsed");
        process.exit(0);
      }, 20000);
    } else if (msg.method === "textDocument/publishDiagnostics") {
      console.log(
        ts(),
        "[recv] publishDiagnostics uri=",
        msg.params?.uri,
        "count=",
        (msg.params?.diagnostics ?? []).length,
        meta,
      );
    } else {
      console.log(ts(), "[recv]", msg.method ?? "id " + msg.id, meta, JSON.stringify(msg).slice(0, 140));
    }
  }
});

sock.on("error", (e: Error) => {
  console.log(ts(), "[socket error]", e.message);
  process.exit(1);
});
sock.on("close", () => {
  console.log(ts(), "[socket closed by peer]");
  process.exit(3);
});

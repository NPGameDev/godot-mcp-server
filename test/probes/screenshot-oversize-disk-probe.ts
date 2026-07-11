// Live proof of the image-oversize escape hatch: when a capture is too big for
// the WS transport, the too-large error steers to image_response_mode:"disk",
// and that disk retry saves the PNG and returns a lean path envelope. Connects
// to the toolkit WS via the smoke harness's bridge, so it sees the RAW toolkit
// payload — image_base64 included and the disk lean envelope verbatim, without
// the server's MCP-image shaping in the way.
//
// It does what a raw-WS probe (lsp-raw-probe.mts) does for the LSP seam: reaches
// past the product's response mapper to check the toolkit's own bytes. Here that
// matters because the too-large frame never reaches the client as JSON otherwise.
//
// Two assertions, the before/after of the fix:
//   1. A default-size (1280x720) node-focused capture of a Node3D overflows the
//      WS buffer and returns RESPONSE_TOO_LARGE whose hint now names
//      image_response_mode:"disk" (the tailored escape hatch), not the old
//      generic "narrow the query / paginate" boilerplate.
//   2. Retrying that capture with image_response_mode:"disk" saves the PNG and
//      returns a lean envelope (absolute path, NO image_base64); the file exists
//      on disk and is non-trivially sized.
// Cleans up the probe node and the saved PNG.
//
// Run: node_modules/.bin/tsx test/probes/screenshot-oversize-disk-probe.ts
// It does NOT launch Godot — the editor must already be running with the toolkit
// plugin active (editor port 6550, override with GODOT_MCP_EDITOR_PORT).
import fs from "node:fs";

import { createBridge } from "../../src/transport/bridge.js";
import { BridgeError } from "../../src/shared/errors.js";
import {
  HOST,
  PORT,
  PROBE_TIMEOUT_MS,
  SCREENSHOT_TIMEOUT,
  CALL_TIMEOUT,
  probePort,
  printUnreachable,
} from "../helpers.js";
import { discoverProjectPath } from "../harness.js";

const NODE_NAME = "OversizeDiskProbe3D";

/** A too-large capture surfaces as a coded error envelope on the raw payload. */
interface ShotResult {
  image_base64?: string;
  width?: number;
  height?: number;
  bytes?: number;
  path?: string;
  mime_type?: string;
  code?: string;
  error?: string;
  hint?: string;
}

let failures = 0;

function report(ok: boolean, label: string, detail: string): void {
  const tag = ok ? "PASS" : "FAIL";
  const line = `[oversize-disk-probe] ${tag} ${label} — ${detail}`;
  if (ok) process.stdout.write(line + "\n");
  else {
    failures++;
    process.stderr.write(line + "\n");
  }
}

async function main(): Promise<void> {
  const reachable = await probePort(HOST, PORT, PROBE_TIMEOUT_MS);
  if (!reachable) {
    printUnreachable("probe:oversize-disk");
    process.exit(2);
  }

  const projectPath = discoverProjectPath();
  const bridge = createBridge(`ws://${HOST}:${PORT}`, { projectPath });

  try {
    // A 3D node at default 1280x720 renders a full-detail frame that overflows the
    // ~1 MB WS transport buffer — the deterministic oversize trigger.
    await bridge.call(
      "scene.create_node",
      { class_name: "Node3D", parent_path: ".", node_name: NODE_NAME },
      CALL_TIMEOUT,
    );

    // (1) Inline, default size → RESPONSE_TOO_LARGE with the tailored hint.
    const oversize = (await bridge.call(
      "editor.screenshot",
      { node_path: NODE_NAME },
      SCREENSHOT_TIMEOUT,
    )) as ShotResult;
    if (oversize.code !== "RESPONSE_TOO_LARGE") {
      report(
        false,
        "oversize inline capture",
        `expected RESPONSE_TOO_LARGE, got ${JSON.stringify({ ...oversize, image_base64: oversize.image_base64 ? "<present>" : undefined })}`,
      );
    } else {
      const hint = oversize.hint ?? "";
      const tailored = hint.includes("image_response_mode") && hint.includes("disk");
      report(
        tailored,
        "oversize inline capture -> tailored hint",
        tailored ? `RESPONSE_TOO_LARGE, hint names image_response_mode + disk` : `hint missing escape hatch: "${hint}"`,
      );
    }

    // (2) Retry with image_response_mode:"disk" → lean envelope + file on disk.
    const disk = (await bridge.call(
      "editor.screenshot",
      { node_path: NODE_NAME, image_response_mode: "disk" },
      SCREENSHOT_TIMEOUT,
    )) as ShotResult;
    const leanOk =
      disk.image_base64 === undefined &&
      typeof disk.path === "string" &&
      disk.path.length > 0 &&
      (disk.path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(disk.path)) &&
      fs.existsSync(disk.path);
    if (!leanOk) {
      report(false, "disk retry -> lean envelope", `expected absolute path + no image, got ${JSON.stringify(disk)}`);
    } else {
      const size = fs.statSync(disk.path as string).size;
      // A real capture is many KB; guard against a zero/near-zero (truncated) write.
      const nonTrivial = size > 1000;
      report(
        nonTrivial,
        "disk retry -> lean envelope + PNG on disk",
        `path=${disk.path} (${size}B on disk)${nonTrivial ? "" : " — file suspiciously small"}`,
      );
      try {
        fs.unlinkSync(disk.path as string);
      } catch {
        /* best-effort cleanup */
      }
    }
  } finally {
    await bridge.call("scene.delete_node", { node_path: NODE_NAME }, CALL_TIMEOUT).catch(() => undefined);
    await bridge.close();
  }

  process.stdout.write(
    `[oversize-disk-probe] ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

void main().catch((err) => {
  const code = err instanceof BridgeError ? err.code : "INTERNAL";
  process.stderr.write(`[oversize-disk-probe] fatal ${code}: ${(err as Error).message}\n`);
  process.exit(1);
});

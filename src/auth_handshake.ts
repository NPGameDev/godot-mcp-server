/**
 * Auth handshake over an open socket (the C-AUTH leaf).
 *
 * One responsibility: the auth WIRE protocol — present the session token plus
 * the server version, then read the toolkit's handshake reply. Sends
 * `{ auth, version }`; resolves on `{ authed: true }`, mapping the reply's
 * `{ godot_version, version }` → `{ godotVersion, toolkitVersion }`. Enforces a
 * 5 s handshake timeout, removes its own listeners on settle, and rejects if the
 * peer closes mid-handshake or never answers. Mirrors the toolkit's GDScript
 * `auth.gd` exchange.
 *
 * Near-pure leaf: no state, no lifecycle. Its deps (ws + version) are disjoint
 * from token_path's (fs/path/os/crypto) — the cohesion split that earns it its
 * own home. `createChannel` (bridge.ts) imports `authenticate`.
 */
import type { WebSocket } from "ws";
import { BridgeError } from "./errors.js";
import { getServerVersion } from "./version.js";

const AUTH_TIMEOUT_MS = 5_000;

/** Parsed auth response from the Godot plugin. */
export interface AuthResponse {
  godotVersion: string | null;
  toolkitVersion: string | null;
}

/**
 * Send the auth handshake and wait for {"authed": true} or a close frame.
 * Resolves with the full auth response.
 */
export function authenticate(ws: WebSocket, token: string): Promise<AuthResponse> {
  return new Promise<AuthResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new BridgeError("AUTH_FAILED", "auth handshake timed out"));
    }, AUTH_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timer);
      ws.removeListener("message", onMessage);
      ws.removeListener("close", onClose);
    }

    function onMessage(data: unknown): void {
      try {
        const msg = JSON.parse(String(data)) as {
          authed?: boolean;
          godot_version?: string;
          version?: string;
        };
        if (msg.authed === true) {
          cleanup();
          resolve({
            godotVersion: msg.godot_version ?? null,
            toolkitVersion: msg.version ?? null,
          });
        }
      } catch {
        // Not JSON — ignore, keep waiting.
      }
    }

    function onClose(_code: number, reason: Buffer): void {
      cleanup();
      reject(new BridgeError("AUTH_FAILED", `server closed connection during auth: ${reason.toString()}`));
    }

    ws.on("message", onMessage);
    ws.on("close", onClose);
    ws.send(JSON.stringify({ auth: token, version: getServerVersion() }));
  });
}

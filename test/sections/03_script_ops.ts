import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, unwrapUntrusted } from "../helpers.js";

export async function testScriptOps(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const scriptPath = "res://smoke_probe.gd";
  const scriptBody = `# smoke ${Date.now()}\nextends Node\n`;
  const writeResult = (await bridge.call(
    "script.write",
    { file_path: scriptPath, content: scriptBody },
    CALL_TIMEOUT,
  )) as { ok?: boolean; undoable?: boolean; code?: string };
  if (!writeResult?.ok) fail(`script.write: ${JSON.stringify(writeResult)}`);
  if (writeResult?.undoable !== true)
    fail(`script.write missing undoable flag (iter-09 UndoRedo wrap): ${JSON.stringify(writeResult)}`);
  const readResult = (await bridge.call("script.read", { file_path: scriptPath }, CALL_TIMEOUT)) as {
    content?: string;
    code?: string;
  };
  // script.read content is wrapped in an <untrusted> security envelope.
  const readContent = unwrapUntrusted(readResult?.content);
  if (readContent !== scriptBody) fail(`script.read round-trip mismatch: ${JSON.stringify(readResult)}`);
  else pass("script.write (undoable) + script.read round-trip");

  const reloadResult = (await bridge.call("editor.reload_scripts", null, CALL_TIMEOUT)) as {
    ok?: boolean;
    code?: string;
  };
  if (!reloadResult?.ok) fail(`editor.reload_scripts: ${JSON.stringify(reloadResult)}`);
  else pass("editor.reload_scripts ok");

  const bogusRead = (await bridge.call(
    "script.read",
    { file_path: "res://does_not_exist_smoke.txt" },
    CALL_TIMEOUT,
  )) as { code?: string };
  if (bogusRead?.code !== "NOT_FOUND") fail(`script.read bogus: expected NOT_FOUND, got ${JSON.stringify(bogusRead)}`);
  else pass("script.read bogus path -> NOT_FOUND");

  // editor.get_errors — response shape depends on <untrusted> wrapping.
  const errorsResult = (await bridge.call("editor.get_errors", null, CALL_TIMEOUT)) as {
    errors?: unknown;
    count?: number;
    success?: boolean;
  };
  if (errorsResult?.errors === undefined || typeof errorsResult.count !== "number") {
    fail(`editor.get_errors shape: ${JSON.stringify(errorsResult)}`);
  } else {
    pass(`editor.get_errors -> count=${errorsResult.count}`);
  }
}

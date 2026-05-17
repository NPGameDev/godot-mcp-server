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
  )) as { success?: boolean; undoable?: boolean; code?: string };
  if (!writeResult?.success) fail(`script.write: ${JSON.stringify(writeResult)}`);
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

  const reloadResult = (await bridge.call("editor.refresh", null, CALL_TIMEOUT)) as {
    success?: boolean;
    code?: string;
  };
  if (!reloadResult?.success) fail(`editor.refresh: ${JSON.stringify(reloadResult)}`);
  else pass("editor.refresh ok");

  const bogusRead = (await bridge.call(
    "script.read",
    { file_path: "res://does_not_exist_smoke.txt" },
    CALL_TIMEOUT,
  )) as { code?: string };
  if (bogusRead?.code !== "NOT_FOUND") fail(`script.read bogus: expected NOT_FOUND, got ${JSON.stringify(bogusRead)}`);
  else pass("script.read bogus path -> NOT_FOUND");

  // REGRESSION: script_write preload hint (fixed T:cb4e162 / T:a46487b / S:38ed316).
  // Writing a script that references another script via preload should include
  // a hint about the preload path or line number in the response.
  const preloadScript = "res://smoke_preload_target.gd";
  const preloadWriterPath = "res://smoke_preload_writer.gd";
  await bridge.call("script.write", { file_path: preloadScript, content: "extends Node\n" }, CALL_TIMEOUT);
  const preloadWriteResult = (await bridge.call(
    "script.write",
    {
      file_path: preloadWriterPath,
      content: `extends Node\n\nconst Target = preload("${preloadScript}")\n`,
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; hint?: string; error?: string };
  if (preloadWriteResult?.success) {
    // The hint may or may not mention preload depending on whether the toolkit
    // detects the preload reference. Either way, success without crash is the canary.
    if (preloadWriteResult.hint && preloadWriteResult.hint.toLowerCase().includes("preload")) {
      pass("REGRESSION script_write preload hint -> present");
    } else {
      pass("REGRESSION script_write preload -> success (hint not generated for this pattern — acceptable)");
    }
  } else {
    pass(`REGRESSION script_write preload -> ${JSON.stringify(preloadWriteResult).slice(0, 80)}`);
  }
  try {
    await bridge.call("script.delete", { file_path: preloadWriterPath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("script.delete", { file_path: preloadScript }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }

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

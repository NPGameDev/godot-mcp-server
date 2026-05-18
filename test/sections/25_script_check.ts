import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertError } from "../helpers.js";

export async function testScriptCheck(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ─── Valid script → valid: true, empty diagnostics ────────────────────
  const validPath = "res://smoke_check_valid.gd";
  const validContent = "extends Node\n\nfunc _ready() -> void:\n\tpass\n";

  const writeValid = (await bridge.call(
    "script.write",
    { file_path: validPath, content: validContent },
    CALL_TIMEOUT,
  )) as { success?: boolean };

  if (!writeValid?.success) {
    fail(`script.check: could not write valid probe: ${JSON.stringify(writeValid)}`);
    return;
  }

  const checkValid = (await bridge.call("script.check", { file_path: validPath }, CALL_TIMEOUT)) as {
    success?: boolean;
    file_path?: string;
    valid?: boolean;
    diagnostics?: unknown[];
  };

  if (!checkValid?.success) {
    fail(`script.check valid: expected success, got ${JSON.stringify(checkValid)}`);
  } else {
    if (checkValid.valid !== true) fail(`script.check valid: expected valid=true, got ${checkValid.valid}`);
    else pass("script.check valid script -> valid=true");

    if (!Array.isArray(checkValid.diagnostics) || checkValid.diagnostics.length !== 0) {
      fail(`script.check valid: expected empty diagnostics, got ${JSON.stringify(checkValid.diagnostics)}`);
    } else {
      pass("script.check valid script -> empty diagnostics");
    }

    if (checkValid.file_path !== validPath) {
      fail(`script.check valid: file_path mismatch (${checkValid.file_path})`);
    } else {
      pass("script.check valid script -> correct file_path");
    }
  }

  // Clean up valid script
  await bridge.call("script.delete", { file_path: validPath }, CALL_TIMEOUT);

  // ─── Broken script → valid: false, diagnostics with line numbers ──────
  const brokenPath = "res://smoke_check_broken.gd";
  const brokenContent = "extends Node\n\nfunc broken(\n\tvar x = \n";

  const writeBroken = (await bridge.call(
    "script.write",
    { file_path: brokenPath, content: brokenContent },
    CALL_TIMEOUT,
  )) as { success?: boolean };

  if (!writeBroken?.success) {
    fail(`script.check: could not write broken probe: ${JSON.stringify(writeBroken)}`);
  } else {
    const checkBroken = (await bridge.call("script.check", { file_path: brokenPath }, CALL_TIMEOUT)) as {
      success?: boolean;
      valid?: boolean;
      diagnostics?: { line: number; severity: string; message: string }[];
    };

    if (!checkBroken?.success) {
      fail(`script.check broken: expected success, got ${JSON.stringify(checkBroken)}`);
    } else {
      if (checkBroken.valid !== false) fail(`script.check broken: expected valid=false, got ${checkBroken.valid}`);
      else pass("script.check broken script -> valid=false");

      if (!Array.isArray(checkBroken.diagnostics) || checkBroken.diagnostics.length === 0) {
        fail(`script.check broken: expected non-empty diagnostics, got ${JSON.stringify(checkBroken.diagnostics)}`);
      } else {
        const first = checkBroken.diagnostics[0];
        if (!first.severity) fail(`script.check broken: diagnostic missing severity`);
        else pass(`script.check broken -> severity=${first.severity}`);
        if (!first.message) fail(`script.check broken: diagnostic missing message`);
        else pass(`script.check broken -> has message`);
        pass(`script.check broken -> ${checkBroken.diagnostics.length} diagnostic(s)`);
      }
    }

    // Clean up broken script
    await bridge.call("script.delete", { file_path: brokenPath }, CALL_TIMEOUT);
  }

  // ─── REGRESSION: class_name false positive (fixed T:8f74e23) ───────────
  // Scripts with class_name should not produce false positive errors from
  // GDScript.new().reload() validation. A valid script with class_name
  // must return valid=true.
  const classNamePath = "res://smoke_check_classname.gd";
  const classNameContent = "class_name SmokeCheckClass\nextends Node\n\nfunc _ready() -> void:\n\tpass\n";
  const writeClassName = (await bridge.call(
    "script.write",
    { file_path: classNamePath, content: classNameContent },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  if (writeClassName?.success) {
    const checkClassName = (await bridge.call("script.check", { file_path: classNamePath }, CALL_TIMEOUT)) as {
      success?: boolean;
      valid?: boolean;
      diagnostics?: unknown[];
    };
    if (checkClassName?.success && checkClassName.valid === true) {
      pass("REGRESSION script_check class_name -> valid=true (no false positive)");
    } else {
      fail(`REGRESSION script_check class_name: expected valid=true, got ${JSON.stringify(checkClassName)}`);
    }
    await bridge.call("script.delete", { file_path: classNamePath }, CALL_TIMEOUT);
  }

  // ─── Hint assertion: diagnostics have structured line/column info ���─────
  // When script.check returns valid=false, diagnostics should include line numbers.
  const hintBrokenPath = "res://smoke_check_hint.gd";
  const hintBrokenContent = "extends Node\n\nfunc _ready():\n  var x = \n";
  await bridge.call("script.write", { file_path: hintBrokenPath, content: hintBrokenContent }, CALL_TIMEOUT);
  const checkHintBroken = (await bridge.call("script.check", { file_path: hintBrokenPath }, CALL_TIMEOUT)) as {
    success?: boolean;
    valid?: boolean;
    diagnostics?: { line?: number; column?: number; severity?: string; message?: string }[];
  };
  if (checkHintBroken?.success && checkHintBroken.valid === false && Array.isArray(checkHintBroken.diagnostics)) {
    const d = checkHintBroken.diagnostics[0];
    if (typeof d?.line === "number" && typeof d?.severity === "string" && typeof d?.message === "string") {
      pass(`script_check diagnostics -> structured (line=${d.line}, severity=${d.severity})`);
    } else {
      fail(`script_check diagnostics: missing structured fields: ${JSON.stringify(d)}`);
    }
  }
  await bridge.call("script.delete", { file_path: hintBrokenPath }, CALL_TIMEOUT);

  // ─── Nonexistent file → NOT_FOUND ─────────────────────────────────────
  const notFound = await bridge.call(
    "script.check",
    { file_path: "res://no_such_file_ever_check_smoke.gd" },
    CALL_TIMEOUT,
  );
  assertError(ctx, "script.check nonexistent file", notFound, "NOT_FOUND");

  // ─── Non-.gd file → INVALID_PARAMS ────────────────────────────────────
  const nonGd = await bridge.call("script.check", { file_path: "res://some_file.cs" }, CALL_TIMEOUT);
  assertError(ctx, "script.check non-.gd file", nonGd, "INVALID_PARAMS");
}

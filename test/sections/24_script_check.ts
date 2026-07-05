import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertError } from "../helpers.js";
import { isVersionAtLeast } from "../../src/shared/version.js";

export const TOOLS_TESTED: string[] = ["script_check", "script_write", "script_delete"];
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

  // ─── REGRESSION: class_name false positive ─────────────────────────────
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

  // ─── Diagnostics shape: {severity, message[, line]} — version-aware ────
  // The severity:"error" entry carries the real 1-based parse-error line on
  // Godot 4.5+ (Logger capture); on <4.5 the line key is entirely absent
  // (never a fabricated 0). No diagnostic ever carries a column — columns are
  // lsp_diagnostics' domain — and hint-severity entries never carry line.
  const hintBrokenPath = "res://smoke_check_hint.gd";
  const hintBrokenContent = "extends Node\n\nfunc _ready():\n  var x = \n";
  await bridge.call("script.write", { file_path: hintBrokenPath, content: hintBrokenContent }, CALL_TIMEOUT);
  const checkHintBroken = (await bridge.call("script.check", { file_path: hintBrokenPath }, CALL_TIMEOUT)) as {
    success?: boolean;
    valid?: boolean;
    diagnostics?: { line?: number; severity?: string; message?: string }[];
  };
  if (checkHintBroken?.success && checkHintBroken.valid === false && Array.isArray(checkHintBroken.diagnostics)) {
    const diags = checkHintBroken.diagnostics;
    const errorDiag = diags.find((d) => d?.severity === "error");
    const godotVer = bridge.getGodotVersion();
    const is45Plus = godotVer != null && isVersionAtLeast(godotVer, "4.5");
    if (!errorDiag) {
      fail(`script_check diagnostics: no severity="error" entry: ${JSON.stringify(diags)}`);
    } else if (is45Plus) {
      if (typeof errorDiag.line === "number" && errorDiag.line >= 1) {
        pass(`script_check diagnostics -> 4.5+ error entry carries the real line (line=${errorDiag.line})`);
      } else {
        fail(`script_check diagnostics: 4.5+ error entry expected line >= 1, got ${JSON.stringify(errorDiag)}`);
      }
    } else {
      if (diags.every((d) => !d || !("line" in d))) {
        pass(`script_check diagnostics -> <4.5 omits the line key entirely (no fabricated 0)`);
      } else {
        fail(`script_check diagnostics: <4.5 expected NO line key on any entry, got ${JSON.stringify(diags)}`);
      }
    }
    if (diags.every((d) => !d || (!("col" in d) && !("column" in d)))) {
      pass(`script_check diagnostics -> no column field on any entry (lsp_diagnostics' domain)`);
    } else {
      fail(`script_check diagnostics: unexpected column field: ${JSON.stringify(diags)}`);
    }
    const hintDiags = diags.filter((d) => d?.severity === "hint");
    if (hintDiags.every((d) => !("line" in d))) {
      pass(`script_check diagnostics -> hint entries carry no line (${hintDiags.length} present)`);
    } else {
      fail(`script_check diagnostics: hint entry wrongly carries line: ${JSON.stringify(hintDiags)}`);
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

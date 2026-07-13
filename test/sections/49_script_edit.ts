import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, unwrapUntrusted } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["script_edit"];

// Result shape shared by every script.edit assertion below. script.edit mirrors
// script.write's envelope (bytes / undoable / indexed / valid / diagnostics) and
// adds `replacements` (the count of spans replaced).
type EditResult = {
  success?: boolean;
  code?: string;
  bytes?: number;
  undoable?: boolean;
  indexed?: boolean;
  valid?: boolean;
  replacements?: number;
  hint?: string;
};

// This section connects straight to the toolkit WebSocket (server Zod bypassed),
// so it exercises the toolkit's _cmd_script_edit behavior directly. It writes a
// temp .gd under res:// (inside the toolkit tree), so every path pre-cleans any
// orphan from a crashed prior run and tears the file down in a finally block —
// a leaked fixture would pollute the toolkit repo's git status.
export async function testScriptEdit(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const editPath = "res://smoke_edit_probe.gd";

  // Orphan pre-clean — a prior run that died mid-section could have left the file.
  try {
    await bridge.call("script.delete", { file_path: editPath }, CALL_TIMEOUT);
  } catch {
    /* nothing to clean — expected on a healthy run */
  }

  try {
    // ── Happy path: single unique replacement ───────────────────────────────
    const original = `extends Node\n\nfunc _ready() -> void:\n\tprint("hello")\n`;
    const seed = (await bridge.call(
      "script.write",
      { file_path: editPath, content: original },
      CALL_TIMEOUT,
    )) as EditResult;
    if (!seed?.success) {
      fail(`script.edit setup: script.write failed: ${JSON.stringify(seed)}`);
      return;
    }

    const edited = (await bridge.call(
      "script.edit",
      { file_path: editPath, old_string: `print("hello")`, new_string: `print("world")` },
      CALL_TIMEOUT,
    )) as EditResult;
    const afterEdit = unwrapUntrusted(
      ((await bridge.call("script.read", { file_path: editPath }, CALL_TIMEOUT)) as { content?: string }).content,
    );
    if (!edited?.success || edited.replacements !== 1) {
      fail(`script.edit happy path: expected success + replacements=1, got ${JSON.stringify(edited)}`);
    } else if (edited.undoable !== true || edited.indexed === undefined || edited.valid !== true) {
      fail(`script.edit happy path: missing pipeline fields (undoable/indexed/valid): ${JSON.stringify(edited)}`);
    } else if (afterEdit !== `extends Node\n\nfunc _ready() -> void:\n\tprint("world")\n`) {
      fail(`script.edit happy path: file content wrong after edit: ${JSON.stringify(afterEdit)}`);
    } else {
      pass("script.edit single unique replacement -> replacements=1, undoable+indexed+valid, content correct");
    }

    // ── NOT_FOUND: old_string absent ────────────────────────────────────────
    const notFound = (await bridge.call(
      "script.edit",
      { file_path: editPath, old_string: `print("never_here")`, new_string: `x` },
      CALL_TIMEOUT,
    )) as EditResult;
    if (notFound?.code !== "NOT_FOUND") {
      fail(`script.edit NOT_FOUND: expected NOT_FOUND, got ${JSON.stringify(notFound)}`);
    } else {
      pass("script.edit absent old_string -> NOT_FOUND");
    }

    // ── NOT_UNIQUE: old_string matches >1 without replace_all ───────────────
    // Overwrite with a body that has two identical "tag" lines.
    const dupBody = `extends Node\n# tag\nvar a := 1\n# tag\nvar b := 2\n`;
    await bridge.call("script.write", { file_path: editPath, content: dupBody }, CALL_TIMEOUT);
    const notUnique = (await bridge.call(
      "script.edit",
      { file_path: editPath, old_string: `# tag`, new_string: `# TAG` },
      CALL_TIMEOUT,
    )) as EditResult;
    if (notUnique?.code !== "NOT_UNIQUE") {
      fail(`script.edit NOT_UNIQUE: expected NOT_UNIQUE, got ${JSON.stringify(notUnique)}`);
    } else {
      pass("script.edit ambiguous old_string (no replace_all) -> NOT_UNIQUE");
    }

    // ── replace_all: replaces every occurrence, returns replacements=N ──────
    // The dupBody still has two "# tag" lines. Assert both are replaced and the
    // surrounding newlines survive (adjacent-newline correctness).
    const replaceAll = (await bridge.call(
      "script.edit",
      { file_path: editPath, old_string: `# tag`, new_string: `# TAG`, replace_all: true },
      CALL_TIMEOUT,
    )) as EditResult;
    const afterReplaceAll = unwrapUntrusted(
      ((await bridge.call("script.read", { file_path: editPath }, CALL_TIMEOUT)) as { content?: string }).content,
    );
    if (!replaceAll?.success || replaceAll.replacements !== 2) {
      fail(`script.edit replace_all: expected success + replacements=2, got ${JSON.stringify(replaceAll)}`);
    } else if (afterReplaceAll !== `extends Node\n# TAG\nvar a := 1\n# TAG\nvar b := 2\n`) {
      fail(`script.edit replace_all: content/newlines wrong: ${JSON.stringify(afterReplaceAll)}`);
    } else {
      pass("script.edit replace_all -> replacements=2, both spans replaced, newlines intact");
    }

    // ── new_string:'' deletes the span ──────────────────────────────────────
    const deleteSpan = (await bridge.call(
      "script.edit",
      { file_path: editPath, old_string: `\nvar b := 2`, new_string: `` },
      CALL_TIMEOUT,
    )) as EditResult;
    const afterDelete = unwrapUntrusted(
      ((await bridge.call("script.read", { file_path: editPath }, CALL_TIMEOUT)) as { content?: string }).content,
    );
    if (!deleteSpan?.success || deleteSpan.replacements !== 1) {
      fail(`script.edit delete-span: expected success + replacements=1, got ${JSON.stringify(deleteSpan)}`);
    } else if (afterDelete !== `extends Node\n# TAG\nvar a := 1\n# TAG\n`) {
      fail(`script.edit delete-span: content wrong after empty-new_string delete: ${JSON.stringify(afterDelete)}`);
    } else {
      pass("script.edit new_string:'' -> deletes the span (replacements=1)");
    }

    // ── No-op reject: old_string == new_string -> INVALID_PARAMS ────────────
    const noop = (await bridge.call(
      "script.edit",
      { file_path: editPath, old_string: `# TAG`, new_string: `# TAG` },
      CALL_TIMEOUT,
    )) as EditResult;
    if (noop?.code !== "INVALID_PARAMS") {
      fail(`script.edit no-op reject: expected INVALID_PARAMS, got ${JSON.stringify(noop)}`);
    } else {
      pass("script.edit identical old_string/new_string -> INVALID_PARAMS (no-op rejected)");
    }

    // ── Empty old_string -> INVALID_PARAMS ──────────────────────────────────
    const emptyOld = (await bridge.call(
      "script.edit",
      { file_path: editPath, old_string: ``, new_string: `x` },
      CALL_TIMEOUT,
    )) as EditResult;
    if (emptyOld?.code !== "INVALID_PARAMS") {
      fail(`script.edit empty old_string: expected INVALID_PARAMS, got ${JSON.stringify(emptyOld)}`);
    } else {
      pass("script.edit empty old_string -> INVALID_PARAMS");
    }

    // ── NOT_FOUND on a missing file ─────────────────────────────────────────
    const missingFile = (await bridge.call(
      "script.edit",
      { file_path: "res://does_not_exist_edit_smoke.gd", old_string: `a`, new_string: `b` },
      CALL_TIMEOUT,
    )) as EditResult;
    if (missingFile?.code !== "NOT_FOUND") {
      fail(`script.edit missing file: expected NOT_FOUND, got ${JSON.stringify(missingFile)}`);
    } else {
      pass("script.edit missing file -> NOT_FOUND");
    }
  } finally {
    try {
      await bridge.call("script.delete", { file_path: editPath }, CALL_TIMEOUT);
    } catch {
      /* best-effort cleanup */
    }
  }
}

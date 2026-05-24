/**
 * Unit tests for tool_refs.ts — ref lifecycle, queries, and idempotency.
 */
import assert from "node:assert/strict";
import {
  setToolRef,
  updateToolRef,
  removeToolByName,
  removeAllToolRefs,
  hasToolRef,
  toolRefCount,
} from "../../src/tool_refs.js";

// Start clean
removeAllToolRefs();
assert.equal(toolRefCount(), 0);

// ── setToolRef + hasToolRef ──────────────────────────────────────────

{
  let removed = false;
  const mockRef = {
    remove: () => {
      removed = true;
    },
  };
  setToolRef("test_tool", mockRef);
  assert.equal(hasToolRef("test_tool"), true);
  assert.equal(hasToolRef("nonexistent"), false);
  assert.equal(toolRefCount(), 1);
}

// ── updateToolRef ────────────────────────────────────────────────────

// Tool with update method → returns true
{
  let updatedWith: Record<string, unknown> | null = null;
  const mockRef = {
    remove: () => {},
    update: (u: Record<string, unknown>) => {
      updatedWith = u;
    },
  };
  setToolRef("updatable", mockRef);
  const result = updateToolRef("updatable", { description: "new desc" });
  assert.equal(result, true);
  assert.deepEqual(updatedWith, { description: "new desc" });
}

// Tool without update method → returns false
{
  setToolRef("no_update", { remove: () => {} });
  const result = updateToolRef("no_update", { description: "new desc" });
  assert.equal(result, false);
}

// Nonexistent tool → returns false
{
  const result = updateToolRef("missing_tool", { description: "x" });
  assert.equal(result, false);
}

// ── removeToolByName ─────────────────────────────────────────────────

// Removes existing tool → true
{
  let removed = false;
  setToolRef("to_remove", {
    remove: () => {
      removed = true;
    },
  });
  assert.equal(hasToolRef("to_remove"), true);
  const result = removeToolByName("to_remove");
  assert.equal(result, true);
  assert.equal(removed, true);
  assert.equal(hasToolRef("to_remove"), false);
}

// Remove nonexistent → false
{
  const result = removeToolByName("never_existed");
  assert.equal(result, false);
}

// Idempotent: removing same tool twice
{
  setToolRef("double_rm", { remove: () => {} });
  assert.equal(removeToolByName("double_rm"), true);
  assert.equal(removeToolByName("double_rm"), false);
}

// Remove handles ref.remove() throwing
{
  let removeCount = 0;
  setToolRef("throw_on_remove", {
    remove: () => {
      removeCount++;
      if (removeCount === 1) throw new Error("already removed");
    },
  });
  // Should not throw even if ref.remove() throws
  const result = removeToolByName("throw_on_remove");
  assert.equal(result, true);
  assert.equal(hasToolRef("throw_on_remove"), false);
}

// ── removeAllToolRefs ────────────────────────────────────────────────

{
  removeAllToolRefs(); // clean slate
  const removals: string[] = [];
  setToolRef("bulk_a", {
    remove: () => {
      removals.push("a");
    },
  });
  setToolRef("bulk_b", {
    remove: () => {
      removals.push("b");
    },
  });
  setToolRef("bulk_c", {
    remove: () => {
      removals.push("c");
    },
  });
  assert.equal(toolRefCount(), 3);

  removeAllToolRefs();
  assert.equal(toolRefCount(), 0);
  assert.equal(hasToolRef("bulk_a"), false);
  assert.equal(hasToolRef("bulk_b"), false);
  assert.equal(hasToolRef("bulk_c"), false);
  assert.equal(removals.length, 3);
}

// removeAllToolRefs handles throws gracefully
{
  setToolRef("throwy", {
    remove: () => {
      throw new Error("boom");
    },
  });
  setToolRef("ok", { remove: () => {} });
  // Should not throw
  removeAllToolRefs();
  assert.equal(toolRefCount(), 0);
}

// ── toolRefCount reflects current state ──────────────────────────────

{
  removeAllToolRefs();
  assert.equal(toolRefCount(), 0);
  setToolRef("x", { remove: () => {} });
  assert.equal(toolRefCount(), 1);
  setToolRef("y", { remove: () => {} });
  assert.equal(toolRefCount(), 2);
  removeToolByName("x");
  assert.equal(toolRefCount(), 1);
  removeAllToolRefs();
  assert.equal(toolRefCount(), 0);
}

// ── Overwriting a ref replaces the old one ───────────────────────────

{
  removeAllToolRefs();
  let removedOld = false;
  setToolRef("overwrite", {
    remove: () => {
      removedOld = true;
    },
  });
  setToolRef("overwrite", { remove: () => {} }); // Replace
  assert.equal(toolRefCount(), 1);
  // Old ref's remove was NOT called by setToolRef — only the map slot changed.
  assert.equal(removedOld, false);
}

console.log("All tool_refs tests passed.");

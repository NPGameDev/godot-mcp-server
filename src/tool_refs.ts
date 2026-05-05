/**
 * Shared tool-ref registry. Tracks RegisteredTool refs returned by
 * server.registerTool() so that tools can be surgically removed by
 * name (stub->real swap in enable_tool_group) or bulk-removed
 * (config reload).
 */

interface ToolRef {
  remove(): void;
  update?(updates: Record<string, unknown>): void;
}

const toolRefs = new Map<string, ToolRef>();

export function setToolRef(name: string, ref: unknown): void {
  toolRefs.set(name, ref as ToolRef);
}

/** Update a registered tool's properties in-place (one notification). */
export function updateToolRef(name: string, updates: Record<string, unknown>): boolean {
  const ref = toolRefs.get(name);
  if (!ref?.update) return false;
  ref.update(updates);
  return true;
}

export function removeToolByName(name: string): boolean {
  const ref = toolRefs.get(name);
  if (!ref) return false;
  try {
    ref.remove();
  } catch {
    /* already removed */
  }
  toolRefs.delete(name);
  return true;
}

export function removeAllToolRefs(): void {
  for (const [, ref] of toolRefs) {
    try {
      ref.remove();
    } catch {
      /* already removed */
    }
  }
  toolRefs.clear();
}

export function hasToolRef(name: string): boolean {
  return toolRefs.has(name);
}

export function toolRefCount(): number {
  return toolRefs.size;
}

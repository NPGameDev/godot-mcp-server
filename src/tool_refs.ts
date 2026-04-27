/**
 * Shared tool-ref registry. Tracks RegisteredTool refs returned by
 * server.registerTool() so that tools can be surgically removed by
 * name (stub->real swap in enable_tool_group) or bulk-removed
 * (config reload).
 */

interface ToolRef {
  remove(): void;
}

const toolRefs = new Map<string, ToolRef>();

export function setToolRef(name: string, ref: unknown): void {
  toolRefs.set(name, ref as ToolRef);
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

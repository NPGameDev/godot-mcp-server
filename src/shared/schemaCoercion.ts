/**
 * Schema shaping & coercion — make agent / extension inputs validate
 * against Zod. A pure leaf: depends only on zod, with no edge to the
 * registration core, dispatch, or the error contract.
 *
 * Three jobs: (1) per-value coercion presets (coercedBoolean / jsonCoerce)
 * that tool modules attach to individual params; (2) the blanket LLM
 * string-coercion pass (addStringCoercion) applied to every Zod shape at
 * registration; (3) raw-JSON-Schema → Zod conversion for extension tools.
 */
import { z } from "zod";

// ── MCP string-coercion helpers ────────────────────────────────────

/**
 * Boolean schema that coerces string inputs ("true"→true, "false"→false).
 * MCP clients may send all values as strings for dynamically-registered
 * tools (added via tools/list_changed). Standard z.boolean() rejects
 * strings; z.coerce.boolean() converts "false" to true (truthy string).
 * This preprocess handles the "false" case correctly.
 */
export const coercedBoolean = () =>
  z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() === "true" || v === "1" : v), z.boolean());

/**
 * Preprocess for JSON-string coercion: parses stringified arrays/objects.
 * Same root cause as coercedBoolean — MCP clients may serialize complex
 * values as JSON strings rather than native JSON types.
 */
export const jsonCoerce = (v: unknown) => {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
};

// ── LLM string coercion ────────────────────────────────────────────
// LLM agents sometimes serialize complex params as JSON strings instead
// of passing structured values (e.g. "[{...}]" instead of [{...}]).
// This pre-validation pass tries JSON.parse on string values when the
// schema expects array/object/number/boolean.

export function coerceStringValue(val: unknown): unknown {
  if (typeof val !== "string") return val;
  // Fast-reject: strings that clearly aren't JSON-encoded values
  const trimmed = val.trim();
  if (trimmed.length === 0) return val;
  const first = trimmed[0];
  if (
    first !== "[" &&
    first !== "{" &&
    first !== '"' &&
    first !== "t" &&
    first !== "f" &&
    first !== "n" &&
    !/^-?\d/.test(trimmed)
  ) {
    return val;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return val;
  }
}

/** Resolve the innermost Zod type name, unwrapping optional/nullable/default. */
export function innerZodType(schema: z.ZodTypeAny): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod v4 internal
  let s = schema as any;
  // Walk through wrappers: optional → ZodOptional._zod.def.innerType,
  // nullable → ZodNullable._zod.def.innerType, default → ZodDefault._zod.def.innerType.
  while (s?._zod?.def?.innerType) {
    s = s._zod.def.innerType;
  }
  return s?._zod?.def?.type as string | undefined;
}

/**
 * Wrap each top-level key in a Zod shape with z.preprocess() so that
 * JSON-encoded strings are parsed before Zod validation. Skips params
 * whose schema expects a string — a JSON-encoded string value passed
 * to a string param should not be unwrapped.
 */
export function addStringCoercion(shape: Record<string, z.ZodTypeAny>): Record<string, z.ZodTypeAny> {
  const coerced: Record<string, z.ZodTypeAny> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const inner = innerZodType(schema);
    // Skip schemas that are string-typed (would unwrap intended JSON strings),
    // enum-typed (discrete values, not JSON), or already preprocessed (pipe —
    // e.g. coercedBoolean() already handles its own string coercion).
    if (inner === "string" || inner === "enum" || inner === "pipe") {
      coerced[key] = schema;
    } else {
      // Wrap with preprocess so JSON-encoded strings are parsed before Zod.
      // z.preprocess() is a ZodPipe, not a ZodOptional — and the MCP SDK emits
      // the JSON Schema with io:"input" (pipeStrategy), where the pipe's input
      // side does NOT inherit the inner .optional(). That flips optional params
      // to `required` in tools/list (regression caught by the scene_spatial_map
      // sweep: radius/max_nodes). Re-apply .optional() so the wrapper stays
      // optional on the input side. (undefined short-circuits the outer optional,
      // so coercion and any inner default are unaffected for provided values.)
      const wrapped = z.preprocess(coerceStringValue, schema);
      coerced[key] = schema instanceof z.ZodOptional ? wrapped.optional() : wrapped;
    }
  }
  return coerced;
}

// ── JSON Schema → Zod conversion ────────────────────────────────────

/**
 * Detect whether an inputSchema is raw JSON Schema (from extension
 * commands) rather than a Zod shape. Heuristic: top-level "type" key
 * with plain string value, OR "properties" key that is a plain object
 * (not a Zod schema). Zod schemas have a `_zod` property; plain JSON
 * Schema `properties` objects do not.
 */
export function isRawJsonSchema(schema: unknown): schema is Record<string, unknown> {
  if (!schema || typeof schema !== "object") return false;
  const obj = schema as Record<string, unknown>;
  if (typeof obj.type === "string") return true;
  if (typeof obj.properties === "object" && obj.properties !== null) {
    // A Zod schema (used as a field named "properties") has _zod; a
    // JSON Schema properties object is a plain dict of field descriptors.
    return !(obj.properties as Record<string, unknown>)._zod;
  }
  return false;
}

/**
 * Convert a raw JSON Schema object to a Zod shape compatible with the
 * MCP SDK's registerTool. Handles the common types extension authors use.
 */
export function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return {};

  const required = new Set((schema.required as string[]) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny;
    switch (prop.type) {
      case "string":
        if (Array.isArray(prop.enum) && prop.enum.length > 0) {
          zodType = z.enum(prop.enum as [string, ...string[]]);
        } else {
          zodType = z.string();
        }
        break;
      case "number":
      case "integer":
        zodType = z.coerce.number();
        break;
      case "boolean":
        zodType = coercedBoolean();
        break;
      case "array":
        zodType = z.preprocess(jsonCoerce, z.array(z.any()));
        break;
      default:
        zodType = z.any();
        break;
    }
    if (typeof prop.description === "string") {
      zodType = zodType.describe(prop.description);
    }
    if (!required.has(key)) {
      zodType = zodType.optional();
    }
    shape[key] = zodType;
  }
  return shape;
}

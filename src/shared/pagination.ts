import { z } from "zod";

/**
 * Shared pieces of the self-describing pagination contract that the SERVER owns:
 * the request-param zod fragments each paginating tool spreads into its input
 * schema, the canonical envelope prose for tool descriptions, and the read-side
 * field-name constants + type for the two summary handlers.
 *
 * REFLECT boundary — this module has NO response builder. The toolkit's
 * `Pagination` class is the sole author of the paged response envelope; the
 * bridge forwards `message.result` verbatim. The only server code that *reads*
 * the paged fields is the two non-reflect summary handlers (editor console,
 * debugger log), which read them through {@link PAGE_FIELD} — never string
 * literals, and never by re-encoding the response.
 *
 * @remarks
 * The request fragments are load-bearing: the catalogue's zod strips undeclared
 * top-level params, so an `offset`/`limit` a paginating tool never spreads never
 * reaches the toolkit handler. The coercion style differs per family — plain
 * `z.number` for the index-window tools that predate coercion, `z.coerce` for
 * the byte/line-window tools — so this module exposes one fragment per family
 * rather than forcing a single shape.
 */

// ── Request-param zod fragments (spread into a tool's inputSchema) ────────────

/**
 * Index-window params (`offset`/`limit`) for LIST-family paginating tools
 * (scene_query, classdb_search, classdb_get_info).
 *
 * @remarks
 * `offset` floors at 0 — a negative skip is nonsensical, and a uniform floor
 * keeps the whole surface validating the same way. Spread this into a tool's
 * inputSchema so the catalogue zod forwards the params instead of stripping
 * them. Per-tool defaults and caps differ; the prose stays generic here and the
 * tool description names its own numbers.
 */
export const offsetLimitParams = {
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Skip the first N (default 0); pass next_offset back as offset until has_more is false."),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page size (default per tool); a request above the cap is clamped and limit_clamped is set."),
};

/**
 * Byte-window params (`offset`/`max_bytes`) for the CONTENT-byte family
 * (save_read). `offset` is a byte offset; `max_bytes` is the window size.
 *
 * @remarks
 * These accept string input (`z.coerce`) because the byte-window tools have
 * always coerced — keep that shipped behavior. `next_offset` from the prior
 * response drives the next window.
 */
export const byteWindowParams = {
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Byte offset to start at (default 0); pass next_offset back to page."),
  max_bytes: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max bytes this window (default 64 KB; cap configurable)."),
};

/**
 * Line-window params (`start_line`/`end_line`, both 1-based inclusive) for the
 * CONTENT-line family (script_read).
 *
 * @remarks
 * These accept string input (`z.coerce`) to match the tool's shipped behavior.
 * `next_start_line` from the prior response drives the next window.
 */
export const lineWindowParams = {
  start_line: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based first line (default 1); pass next_start_line back as start_line to page."),
  end_line: z.coerce.number().int().positive().optional().describe("1-based last line to read (inclusive)."),
};

// ── Envelope-prose builder (for a tool's `.describe()` / description) ─────────

/** Options for {@link paginationDoc}. */
export interface PaginationDocOptions {
  /**
   * Whether the tool emits a linear resume field. `true` (default) documents the
   * `next_offset`/`next_start_line` resume loop; `false` documents cursor-less
   * navigation via {@link PaginationDocOptions.cursorlessNav}.
   */
  resumable?: boolean;
  /**
   * The in-tool navigation phrase for a cursor-less tool (e.g. "narrow filters or
   * raise limit"). Used only when `resumable` is `false`.
   */
  cursorlessNav?: string;
  /**
   * Whether to append the page-stability caveat — pages are only stable if the
   * underlying source is unchanged between calls (an ordered live-source read).
   */
  mutationCaveat?: boolean;
}

/**
 * Canonical envelope prose for a paginating tool's description, so every tool
 * documents the same shape the toolkit emits instead of describing it a dozen
 * different ways.
 *
 * @param unit - Names the total the count describes (e.g. "matches", "classes",
 *   "bytes", "lines", "assets"); rendered as `total_<unit>`.
 * @param opts - Toggles the resume-field sentence, the cursor-less nav phrase,
 *   and the mutation caveat.
 * @returns A sentence describing `returned`, `total_<unit>`, `has_more`, and the
 *   tool's paging mechanism.
 * @example
 * ```ts
 * paginationDoc("matches", { resumable: true, mutationCaveat: true });
 * paginationDoc("assets", { resumable: false, cursorlessNav: "narrow filters or raise limit" });
 * ```
 */
export function paginationDoc(unit: string, opts: PaginationDocOptions = {}): string {
  const { resumable = true, cursorlessNav, mutationCaveat = false } = opts;
  let doc = `Paged: returned, total_${unit}, has_more. `;
  if (resumable) {
    doc += "When has_more, page via next_offset until has_more is false. ";
  } else {
    doc += `Cursor-less — ${cursorlessNav ?? "narrow the query or raise limit"} for more. `;
  }
  if (mutationCaveat) {
    doc += "Stable only if the source is unchanged between calls. ";
  }
  return doc;
}

// ── Read-side field names + type (for the two non-reflect handlers) ───────────

/**
 * The paged-response field names the two summary handlers read from
 * `message.result`. Held in one place so a rename touches this module, not the
 * handlers — the toolkit is the sole envelope author (REFLECT), so these mirror
 * the toolkit field names exactly.
 */
export const PAGE_FIELD = {
  returned: "returned",
  hasMore: "has_more",
  totalLines: "total_lines",
} as const;

/**
 * The slice of a paged response the summary handlers (editor console, debugger
 * log) read to compose their line-count headline. All fields are optional — a
 * handler falls back gracefully when the source omits one.
 */
export interface PaginatedResult {
  returned?: number;
  has_more?: boolean;
  total_lines?: number;
  [k: string]: unknown;
}

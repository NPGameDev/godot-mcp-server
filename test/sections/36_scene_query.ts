import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["scene_query"];

type QueryNode = { path?: string; class?: string; name?: string };
type QueryPage = {
  success?: boolean;
  nodes?: QueryNode[];
  offset?: number;
  limit?: number;
  returned?: number;
  total_matches?: number;
  has_more?: boolean;
  next_offset?: number;
  hint?: string;
  limit_clamped?: boolean;
};

// Fixture: a small, dedicated match set so paging invariants are exact and cheap.
// Five nodes in the "pagetest" group, paged at limit 2 → 3 pages (2/2/1). A tiny
// fixture keeps both the programmatic smoke and the agent-driven sweep token-light.
const PAGE_GROUP = "pagetest";
const PAGE_NODES = ["MCPPageA", "MCPPageB", "MCPPageC", "MCPPageD", "MCPPageE"];
const PAGE_TOTAL = PAGE_NODES.length;

export async function testSceneQuery(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── Happy paths (field is `returned`, not the removed ambiguous `count`) ──
  const classResult = (await bridge.call("scene.query", { class_filter: "Node2D" }, CALL_TIMEOUT)) as QueryPage;
  if (classResult?.success === true && typeof classResult.returned === "number") {
    pass(`scene_query class_filter -> returned=${classResult.returned}, total_matches=${classResult.total_matches}`);
  } else {
    fail(`scene_query class_filter: ${JSON.stringify(classResult)}`);
  }

  const nameResult = (await bridge.call("scene.query", { name_pattern: "Val*" }, CALL_TIMEOUT)) as QueryPage;
  if (nameResult?.success === true && typeof nameResult.returned === "number") {
    pass(`scene_query name_pattern -> returned=${nameResult.returned}`);
  } else {
    fail(`scene_query name_pattern: ${JSON.stringify(nameResult)}`);
  }

  const propResult = (await bridge.call(
    "scene.query",
    {
      class_filter: "Node2D",
      property_filters: [{ property: "visible", value: true }],
      include_properties: ["position"],
      limit: 5,
    },
    CALL_TIMEOUT,
  )) as QueryPage;
  if (propResult?.success === true) {
    pass(`scene_query property filter -> returned=${propResult.returned}`);
  } else {
    fail(`scene_query property filter: ${JSON.stringify(propResult)}`);
  }

  // ── Guard: no filters ──
  assertGuard(
    ctx,
    "scene_query no filters guard",
    await bridge.call("scene.query", {}, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "filter",
  );

  // ── Pagination invariants over a known 5-node fixture ──
  const query = (params: Record<string, unknown>): Promise<QueryPage> =>
    bridge.call("scene.query", params, CALL_TIMEOUT) as Promise<QueryPage>;

  // Orphan pre-clean in case a prior aborted run left the fixture behind.
  for (const n of PAGE_NODES) {
    try {
      await bridge.call("scene.delete_node", { node_path: n }, CALL_TIMEOUT);
    } catch {
      /* noop — node absent is the normal case */
    }
  }

  try {
    for (const n of PAGE_NODES) {
      await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: n }, CALL_TIMEOUT);
      await bridge.call("node.groups", { action: "add", node_path: n, group: PAGE_GROUP }, CALL_TIMEOUT);
    }

    const p1 = await query({ group_filter: PAGE_GROUP, limit: 2, offset: 0 });
    const p2 = await query({ group_filter: PAGE_GROUP, limit: 2, offset: 2 });
    const p3 = await query({ group_filter: PAGE_GROUP, limit: 2, offset: 4 });

    const pathsOf = (p: QueryPage): string[] => (p.nodes ?? []).map((n) => String(n.path));

    // total_matches is constant across every page (derives from tree + filter, not the window).
    const totals = [p1, p2, p3].map((p) => Number(p.total_matches));
    if (totals.every((t) => t === PAGE_TOTAL)) {
      pass(`scene_query paging: total_matches constant (${PAGE_TOTAL}) across all pages`);
    } else {
      fail(`scene_query paging: total_matches drifted across pages — ${JSON.stringify(totals)}`);
    }

    // Σreturned == total_matches; pages tile the match set once.
    const returnedSum = [p1, p2, p3].reduce((acc, p) => acc + Number(p.returned), 0);
    if (returnedSum === PAGE_TOTAL) {
      pass(`scene_query paging: Σreturned == total_matches (${PAGE_TOTAL})`);
    } else {
      fail(`scene_query paging: Σreturned=${returnedSum}, expected ${PAGE_TOTAL}`);
    }

    // Per-page sizes: 2 / 2 / 1.
    const sizes = [p1, p2, p3].map((p) => Number(p.returned));
    if (sizes[0] === 2 && sizes[1] === 2 && sizes[2] === 1) {
      pass(`scene_query paging: page sizes 2/2/1`);
    } else {
      fail(`scene_query paging: unexpected page sizes ${JSON.stringify(sizes)}`);
    }

    // Pages disjoint AND union == full match set (completeness).
    const paths = [pathsOf(p1), pathsOf(p2), pathsOf(p3)];
    const union = new Set(paths.flat());
    const totalWithDupes = paths.reduce((acc, ps) => acc + ps.length, 0);
    // The toolkit emits scene_root.get_path_to(node) — a bare name for direct root
    // children, a relative path for deeper nodes. Compare basenames so a future
    // nested fixture stays matched regardless of prefix.
    const basenames = new Set([...union].map((p) => p.split("/").pop()));
    const fixturePresent = PAGE_NODES.every((n) => basenames.has(n));
    if (union.size === totalWithDupes && union.size === PAGE_TOTAL && fixturePresent) {
      pass(`scene_query paging: pages disjoint + union == full ${PAGE_TOTAL}-node set`);
    } else {
      fail(
        `scene_query paging: disjoint/union broken — union=${union.size}, withDupes=${totalWithDupes}, present=${fixturePresent}`,
      );
    }

    // next_offset chains on has_more pages; final page ends the walk.
    const chainOk =
      p1.has_more === true &&
      Number(p1.next_offset) === 2 &&
      p2.has_more === true &&
      Number(p2.next_offset) === 4 &&
      p3.has_more === false &&
      p3.next_offset === undefined &&
      p3.hint === undefined;
    if (chainOk) {
      pass(`scene_query paging: has_more + next_offset chain (2→4), false + no next_offset/hint on final page`);
    } else {
      fail(
        `scene_query paging: chain broken — p1{has_more:${p1.has_more},next:${p1.next_offset}} p2{has_more:${p2.has_more},next:${p2.next_offset}} p3{has_more:${p3.has_more},next:${p3.next_offset},hint:${p3.hint}}`,
      );
    }

    // has_more pages carry a hint; echo fields are always present.
    if (typeof p1.hint === "string" && p1.hint.length > 0 && Number(p1.offset) === 0 && Number(p1.limit) === 2) {
      pass(`scene_query paging: has_more page echoes offset/limit + carries a hint`);
    } else {
      fail(
        `scene_query paging: echo/hint on page 1 — ${JSON.stringify({ offset: p1.offset, limit: p1.limit, hint: p1.hint })}`,
      );
    }

    // Determinism: two identical calls yield identical ordering.
    const d1 = await query({ group_filter: PAGE_GROUP, limit: 2, offset: 0 });
    const d2 = await query({ group_filter: PAGE_GROUP, limit: 2, offset: 0 });
    if (JSON.stringify(pathsOf(d1)) === JSON.stringify(pathsOf(d2))) {
      pass(`scene_query paging: deterministic order (identical repeat call)`);
    } else {
      fail(
        `scene_query paging: order not deterministic — ${JSON.stringify(pathsOf(d1))} vs ${JSON.stringify(pathsOf(d2))}`,
      );
    }

    // Past-the-end: empty page, not an error; offset echoed as-sent.
    const pastEnd = await query({ group_filter: PAGE_GROUP, limit: 2, offset: PAGE_TOTAL + 1 });
    if (
      pastEnd?.success === true &&
      Number(pastEnd.returned) === 0 &&
      (pastEnd.nodes ?? []).length === 0 &&
      pastEnd.has_more === false &&
      Number(pastEnd.total_matches) === PAGE_TOTAL &&
      Number(pastEnd.offset) === PAGE_TOTAL + 1 &&
      pastEnd.next_offset === undefined
    ) {
      pass(`scene_query paging: past-end offset -> empty page (has_more:false, offset echoed as-sent)`);
    } else {
      fail(`scene_query paging: past-end wrong — ${JSON.stringify(pastEnd)}`);
    }

    // Negative offset floors to 0 (server zod .min(0) + toolkit maxi(0,·) defense).
    const negOffset = await query({ group_filter: PAGE_GROUP, limit: 2, offset: -5 });
    if (negOffset?.success === true && Number(negOffset.offset) === 0 && Number(negOffset.returned) === 2) {
      pass(`scene_query paging: negative offset floored to 0`);
    } else {
      fail(
        `scene_query paging: negative offset not floored — ${JSON.stringify({ offset: negOffset.offset, returned: negOffset.returned })}`,
      );
    }

    // Over-max limit clamps to 200, discloses limit_clamped + a clamp clause in the hint.
    const clamped = await query({ group_filter: PAGE_GROUP, limit: 500 });
    if (
      clamped?.success === true &&
      Number(clamped.limit) === 200 &&
      clamped.limit_clamped === true &&
      typeof clamped.hint === "string" &&
      clamped.hint.includes("200")
    ) {
      pass(`scene_query paging: limit 500 clamped to 200 + limit_clamped disclosure`);
    } else {
      fail(
        `scene_query paging: clamp/disclosure wrong — ${JSON.stringify({ limit: clamped.limit, limit_clamped: clamped.limit_clamped, hint: clamped.hint })}`,
      );
    }

    // No-match: total_matches 0, has_more false, no next_offset/hint, limit_clamped absent.
    const noMatch = await query({ group_filter: "no_such_group_xyz_pagetest" });
    if (
      noMatch?.success === true &&
      Number(noMatch.total_matches) === 0 &&
      Number(noMatch.returned) === 0 &&
      noMatch.has_more === false &&
      noMatch.next_offset === undefined &&
      noMatch.hint === undefined &&
      noMatch.limit_clamped === undefined
    ) {
      pass(`scene_query paging: no-match -> total_matches:0, has_more:false, no next_offset/hint`);
    } else {
      fail(`scene_query paging: no-match wrong — ${JSON.stringify(noMatch)}`);
    }
  } finally {
    for (const n of PAGE_NODES) {
      try {
        await bridge.call("scene.delete_node", { node_path: n }, CALL_TIMEOUT);
      } catch {
        /* noop */
      }
    }
  }
}

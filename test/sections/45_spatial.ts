import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "scene_spatial_map",
  "scene_create_node",
  "scene_delete_node",
  "node_set_property",
];

type SpatialNode = {
  path: string;
  class: string;
  space: string;
  position?: number[];
  size?: number[];
  bounds?: { position: number[]; size: number[] };
  overlaps?: string[];
  contains?: string[];
  contained_by?: string[];
  nearest?: { path: string; distance: number };
};
type SpatialResult = {
  success?: boolean;
  space?: string;
  nodes?: SpatialNode[];
  truncated?: boolean;
  returned?: number;
  total_nodes?: number;
};

/**
 * scene_spatial_map — read-only 2D spatial layout. Builds three Sprite2Ds (the
 * project icon gives each a real ~128px texture rect; Node2D position is
 * reliable, unlike fresh-Control sizing): two overlapping, one far. Validates
 * positions, bounds, overlap/nearest math, every detail level, all filters, the
 * response cap, and the guards. Cleans up afterwards.
 */
export async function testSpatialMap(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const made: string[] = [];

  const mk = async (name: string, pos: number[]): Promise<void> => {
    await bridge.call("scene.create_node", { class_name: "Sprite2D", parent_path: ".", node_name: name }, CALL_TIMEOUT);
    made.push(name);
    await bridge.call(
      "node.set_property",
      { node_path: name, property: "texture", value: { type: "Resource", path: "res://icon.svg" } },
      CALL_TIMEOUT,
    );
    await bridge.call(
      "node.set_property",
      { node_path: name, property: "position", value: { type: "Vector2", x: pos[0], y: pos[1] } },
      CALL_TIMEOUT,
    );
  };

  try {
    await mk("MCPSpatA", [0, 0]);
    await mk("MCPSpatB", [20, 0]); // overlaps A (icon is ~128px, centered)
    await mk("MCPSpatC", [500, 500]); // disjoint

    // detail=full — positions, bounds, overlap, nearest.
    const full = (await bridge.call(
      "scene.spatial_map",
      { detail: "full", class: "Sprite2D" },
      CALL_TIMEOUT,
    )) as SpatialResult;
    if (full?.success && Array.isArray(full.nodes)) {
      const by: Record<string, SpatialNode> = {};
      for (const n of full.nodes) by[n.path] = n;
      const a = by["./MCPSpatA"];
      if (a && a.overlaps?.includes("./MCPSpatB")) pass("spatial: A overlaps B");
      else
        fail(
          `spatial: A should overlap B — bounds=${JSON.stringify(a?.bounds)} overlaps=${JSON.stringify(a?.overlaps)}`,
        );
      if (a && !a.overlaps?.includes("./MCPSpatC")) pass("spatial: A does not overlap disjoint C");
      else fail("spatial: A wrongly overlaps disjoint C");
      if (a && a.space === "2d" && Array.isArray(a.bounds?.size) && (a.bounds?.size?.[0] ?? 0) > 0)
        pass("spatial: 2D Rect2 bounds present (non-zero)");
      else fail(`spatial: missing/zero 2D bounds — ${JSON.stringify(a)}`);
      if (a && a.nearest && a.nearest.path === "./MCPSpatB") pass("spatial: nearest neighbour is B (full)");
      else fail(`spatial: nearest wrong — ${JSON.stringify(a?.nearest)}`);
    } else {
      fail(`spatial.map full: ${JSON.stringify(full).slice(0, 200)}`);
    }

    // detail=brief — relations omitted.
    const brief = (await bridge.call(
      "scene.spatial_map",
      { detail: "brief", class: "Sprite2D" },
      CALL_TIMEOUT,
    )) as SpatialResult;
    if (brief?.success && brief.nodes?.[0] && brief.nodes[0].overlaps === undefined)
      pass("spatial: brief omits relations");
    else fail(`spatial: brief should omit overlaps — ${JSON.stringify(brief?.nodes?.[0])}`);

    // class filter.
    const sprites = (await bridge.call("scene.spatial_map", { class: "Sprite2D" }, CALL_TIMEOUT)) as SpatialResult;
    if (
      sprites?.success &&
      (sprites.nodes ?? []).length >= 3 &&
      (sprites.nodes ?? []).every((n) => n.class === "Sprite2D")
    )
      pass("spatial: class filter keeps only Sprite2D (found >=3)");
    else fail(`spatial: class filter — ${JSON.stringify((sprites.nodes ?? []).map((n) => n.class))}`);

    // region filter excludes the far node.
    const region = (await bridge.call(
      "scene.spatial_map",
      { region: [-100, -100, 300, 300], class: "Sprite2D" },
      CALL_TIMEOUT,
    )) as SpatialResult;
    const rpaths = (region.nodes ?? []).map((n) => n.path);
    if (region?.success && rpaths.includes("./MCPSpatA") && !rpaths.includes("./MCPSpatC"))
      pass("spatial: region filter excludes outside nodes");
    else fail(`spatial: region filter wrong — ${JSON.stringify(rpaths)}`);

    // radius filter.
    const radius = (await bridge.call(
      "scene.spatial_map",
      { radius: 150, center: [0, 0], class: "Sprite2D" },
      CALL_TIMEOUT,
    )) as SpatialResult;
    if (radius?.success && !(radius.nodes ?? []).some((n) => n.path === "./MCPSpatC"))
      pass("spatial: radius filter excludes far node");
    else fail(`spatial: radius filter wrong — ${JSON.stringify((radius.nodes ?? []).map((n) => n.path))}`);

    // subtree filter runs.
    const sub = (await bridge.call("scene.spatial_map", { subtree: "MCPSpatA" }, CALL_TIMEOUT)) as SpatialResult;
    if (sub?.success) pass("spatial: subtree filter runs");
    else fail(`spatial: subtree — ${JSON.stringify(sub).slice(0, 150)}`);

    // max_nodes truncation + reporting.
    const cap = (await bridge.call(
      "scene.spatial_map",
      { max_nodes: 1, class: "Sprite2D" },
      CALL_TIMEOUT,
    )) as SpatialResult;
    if (cap?.success && cap.truncated === true && cap.returned === 1) pass("spatial: max_nodes truncation + counts");
    else fail(`spatial: truncation — ${JSON.stringify({ truncated: cap?.truncated, returned: cap?.returned })}`);
    // total_nodes: full match count (>= returned; counted past the cap).
    if (cap?.success && typeof cap.total_nodes === "number" && cap.total_nodes >= (cap.returned ?? 0))
      pass(`spatial: total_nodes present (${cap.total_nodes} >= returned ${cap.returned})`);
    else
      fail(
        `spatial: total_nodes missing/invalid — ${JSON.stringify({ total_nodes: cap?.total_nodes, returned: cap?.returned })}`,
      );

    // Guards.
    assertGuard(
      ctx,
      "spatial bad detail",
      await bridge.call("scene.spatial_map", { detail: "verbose" }, CALL_TIMEOUT),
      "INVALID_PARAMS",
      "detail",
    );
    assertGuard(
      ctx,
      "spatial bad region size",
      await bridge.call("scene.spatial_map", { region: [1, 2, 3] }, CALL_TIMEOUT),
      "INVALID_PARAMS",
      "region",
    );
  } finally {
    for (const n of made) {
      try {
        await bridge.call("scene.delete_node", { node_path: n }, CALL_TIMEOUT);
      } catch {
        /* noop */
      }
    }
  }
}

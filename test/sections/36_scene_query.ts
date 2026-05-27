import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["scene_query"];
export async function testSceneQuery(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Happy path: query by class
  const classResult = (await bridge.call("scene.query", { class_filter: "Node2D" }, CALL_TIMEOUT)) as {
    success?: boolean;
    count?: number;
    nodes?: unknown[];
  };

  if (classResult?.success === true && typeof classResult.count === "number") {
    pass(`scene_query class_filter -> count=${classResult.count}`);
  } else {
    fail(`scene_query class_filter: ${JSON.stringify(classResult)}`);
  }

  // Query by name pattern
  const nameResult = (await bridge.call("scene.query", { name_pattern: "Val*" }, CALL_TIMEOUT)) as {
    success?: boolean;
    count?: number;
  };

  if (nameResult?.success === true && typeof nameResult.count === "number") {
    pass(`scene_query name_pattern -> count=${nameResult.count}`);
  } else {
    fail(`scene_query name_pattern: ${JSON.stringify(nameResult)}`);
  }

  // Query with property filter
  const propResult = (await bridge.call(
    "scene.query",
    {
      class_filter: "Node2D",
      property_filters: [{ property: "visible", value: true }],
      include_properties: ["position"],
      limit: 5,
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; count?: number };

  if (propResult?.success === true) {
    pass(`scene_query property filter -> count=${propResult.count}`);
  } else {
    fail(`scene_query property filter: ${JSON.stringify(propResult)}`);
  }

  // Guard: no filters
  assertGuard(
    ctx,
    "scene_query no filters guard",
    await bridge.call("scene.query", {}, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "filter",
  );
}

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["scene_get_tree", "scene_create_node", "scene_delete_node", "scene_diff"];
export async function testSceneDiff(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const treeBefore = await bridge.call("scene.get_tree", null, CALL_TIMEOUT);
  const diffProbeNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Node", parent_path: ".", node_name: "DiffProbe" },
    CALL_TIMEOUT,
  )) as { path?: string; code?: string };
  if (!diffProbeNode?.path) fail(`scene.create_node DiffProbe: ${JSON.stringify(diffProbeNode)}`);

  const diffResult = (await bridge.call("scene.diff", { before: treeBefore }, CALL_TIMEOUT)) as {
    changed?: boolean;
    diff?: string;
    added?: number;
    removed?: number;
    code?: string;
  };
  if (diffResult?.changed !== true)
    fail(`scene.diff after mutation: expected changed=true, got ${JSON.stringify(diffResult)}`);
  else if (!diffResult.diff?.includes("DiffProbe"))
    fail(`scene.diff diff missing DiffProbe (truncated): ${diffResult.diff?.slice(0, 200)}`);
  else pass(`scene.diff after create_node -> changed +${diffResult.added}/-${diffResult.removed}`);

  const diffSelf = (await bridge.call("scene.diff", { before: treeBefore, after: treeBefore }, CALL_TIMEOUT)) as {
    changed?: boolean;
    code?: string;
  };
  if (diffSelf?.changed !== false)
    fail(`scene.diff(before,before): expected changed=false, got ${JSON.stringify(diffSelf)}`);
  else pass("scene.diff(self) -> changed=false");

  await bridge.call("scene.delete_node", { node_path: diffProbeNode?.path ?? "DiffProbe" }, CALL_TIMEOUT);
  pass("DiffProbe cleanup");
}

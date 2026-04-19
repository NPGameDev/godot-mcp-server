import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT } from "../helpers.js";

export async function testSignalsAndIntrospection(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const signalProbeNode = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: "SignalProbe" }, CALL_TIMEOUT) as { path?: string; code?: string };
  if (!signalProbeNode?.path) fail(`scene.create_node SignalProbe: ${JSON.stringify(signalProbeNode)}`);
  const signalProbePath = signalProbeNode?.path ?? "SignalProbe";

  // signal.list — Node base class exposes known signals.
  const signalListResult = await bridge.call("signal.list", { node_path: signalProbePath }, CALL_TIMEOUT) as { signals?: { name?: string; args?: unknown[] }[]; code?: string };
  if (!Array.isArray(signalListResult?.signals) || signalListResult.signals.length === 0) fail(`signal.list: ${JSON.stringify(signalListResult)}`);
  else if (!signalListResult.signals.some((s) => s.name === "child_order_changed")) fail(`signal.list: expected child_order_changed among ${signalListResult.signals.map((s) => s.name).join(",")}`);
  else pass(`signal.list -> ${signalListResult.signals.length} signals`);

  // Connect + idempotent repeat + disconnect + NOT_FOUND.
  const connectionArgs = { source_path: signalProbePath, signal_name: "child_order_changed", target_path: signalProbePath, method_name: "notify_property_list_changed" };
  const connectFresh = await bridge.call("signal.connect", connectionArgs, CALL_TIMEOUT) as { status?: string; code?: string; signal?: string };
  if (connectFresh?.status !== "created" || connectFresh.signal !== "child_order_changed") fail(`signal.connect first: expected status='created' with signal echoed, got ${JSON.stringify(connectFresh)}`);
  else pass(`signal.connect fresh -> status='created'`);

  const connectIdempotent = await bridge.call("signal.connect", connectionArgs, CALL_TIMEOUT) as { status?: string; code?: string };
  if (connectIdempotent?.status !== "returned") fail(`signal.connect idempotency: expected status='returned', got ${JSON.stringify(connectIdempotent)}`);
  else if (connectIdempotent.code !== undefined) fail(`signal.connect collision success must not carry code (got ${connectIdempotent.code})`);
  else pass("signal.connect repeat -> status='returned' + code absent (I3)");

  const emitResult = await bridge.call("signal.emit", { node_path: signalProbePath, signal_name: "child_order_changed", args: [] }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!emitResult?.ok) fail(`signal.emit: ${JSON.stringify(emitResult)}`);
  else pass("signal.emit child_order_changed");

  const disconnectFirst = await bridge.call("signal.disconnect", connectionArgs, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!disconnectFirst?.ok) fail(`signal.disconnect first: ${JSON.stringify(disconnectFirst)}`);
  const disconnectRepeat = await bridge.call("signal.disconnect", connectionArgs, CALL_TIMEOUT) as { code?: string };
  if (disconnectRepeat?.code !== "NOT_FOUND") fail(`signal.disconnect repeat: expected NOT_FOUND, got ${JSON.stringify(disconnectRepeat)}`);
  else pass("signal.disconnect + NOT_FOUND on repeat");

  // node.get_property_list.
  const propertyList = await bridge.call("node.get_property_list", { node_path: signalProbePath }, CALL_TIMEOUT) as { properties?: { name?: string; type?: number; hint?: number; hint_string?: string }[]; count?: number; code?: string };
  if (!Array.isArray(propertyList?.properties) || typeof propertyList.count !== "number") {
    fail(`node.get_property_list shape: ${JSON.stringify(propertyList)}`);
  } else {
    const names = new Set(propertyList.properties.map((p) => p.name));
    if (!names.has("process_mode")) fail(`node.get_property_list: expected process_mode, got ${Array.from(names).slice(0, 5).join(",")}...`);
    else pass(`node.get_property_list -> ${propertyList.count} props (incl process_mode)`);
  }

  await bridge.call("scene.delete_node", { node_path: signalProbePath }, CALL_TIMEOUT);
  pass(`SignalProbe cleanup`);

  // resource.load on the dogfood icon.svg.
  const loadedResource = await bridge.call("resource.load", { file_path: "res://icon.svg" }, CALL_TIMEOUT) as { class?: string; path?: string; metadata?: { width?: number; height?: number }; code?: string };
  if (!loadedResource?.class) fail(`resource.load icon.svg: ${JSON.stringify(loadedResource)}`);
  else if (!loadedResource.metadata?.width || !loadedResource.metadata.height) fail(`resource.load icon.svg: missing width/height in metadata: ${JSON.stringify(loadedResource.metadata)}`);
  else pass(`resource.load icon.svg -> class=${loadedResource.class} ${loadedResource.metadata.width}x${loadedResource.metadata.height}`);

  const missingResource = await bridge.call("resource.load", { file_path: "res://does_not_exist_smoke.tres" }, CALL_TIMEOUT) as { code?: string };
  if (missingResource?.code !== "NOT_FOUND") fail(`resource.load bogus: expected NOT_FOUND, got ${JSON.stringify(missingResource)}`);
  else pass("resource.load bogus -> NOT_FOUND");
}

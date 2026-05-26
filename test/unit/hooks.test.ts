/**
 * Unit tests for hooks.ts — HookPipeline composition, error isolation,
 * rateLimitHook, and loggingHook.
 */
import assert from "node:assert/strict";
import FakeTimers from "@sinonjs/fake-timers";
import { captureStderr } from "./helpers.js";
import { HookPipeline, loggingHook, rateLimitHook } from "../../src/hooks.js";
import type { ToolRequest, ToolTextResult } from "../../src/types.js";

const OK_RESULT: ToolTextResult = { content: [{ type: "text", text: '{"ok":true}' }] };
const ERR_RESULT: ToolTextResult = { content: [{ type: "text", text: '{"ok":false}' }], isError: true };

function makeReq(name = "test_tool"): ToolRequest {
  return { name, input: {} };
}

// ── HookPipeline composition order ───────────────────────────────────

// Hooks execute in registration order (outermost first)
{
  const order: number[] = [];
  const pipeline = new HookPipeline();

  pipeline.use(async (_req, next) => {
    order.push(1);
    const result = await next();
    order.push(4);
    return result;
  });
  pipeline.use(async (_req, next) => {
    order.push(2);
    const result = await next();
    order.push(3);
    return result;
  });

  await pipeline.execute(makeReq(), async () => {
    order.push(99);
    return OK_RESULT;
  });

  assert.deepEqual(order, [1, 2, 99, 3, 4]);
}

// ── HookPipeline length ──────────────────────────────────────────────

{
  const pipeline = new HookPipeline();
  assert.equal(pipeline.length, 0);
  pipeline.use(async (_req, next) => next());
  assert.equal(pipeline.length, 1);
  pipeline.use(async (_req, next) => next());
  assert.equal(pipeline.length, 2);
}

// ── Error isolation ──────────────────────────────────────────────────

// Hook #2 throws → hook #1 and #3 still execute, pipeline doesn't crash
{
  const executed: number[] = [];
  const pipeline = new HookPipeline();

  const stderr = captureStderr();
  try {
    pipeline.use(async (_req, next) => {
      executed.push(1);
      return next();
    });
    pipeline.use(async () => {
      executed.push(2);
      throw new Error("hook 2 exploded");
    });
    pipeline.use(async (_req, next) => {
      executed.push(3);
      return next();
    });

    const result = await pipeline.execute(makeReq(), async () => {
      executed.push(99);
      return OK_RESULT;
    });

    // Hook 2 throws, so the catch block calls next() which is hook 3.
    // Hook 1 is outermost, always executes.
    assert.ok(executed.includes(1), "Hook 1 should execute");
    assert.ok(executed.includes(2), "Hook 2 should execute (before throwing)");
    // After hook 2 throws, the catch calls next() → continues chain
    assert.ok(result.content[0].text.includes("ok"));
    assert.ok(stderr.output().includes("hook 2 exploded"));
  } finally {
    stderr.restore();
  }
}

// ── Empty pipeline → handler executes directly ───────────────────────

{
  const pipeline = new HookPipeline();
  const result = await pipeline.execute(makeReq(), async () => OK_RESULT);
  assert.deepEqual(result, OK_RESULT);
}

// ── loggingHook ──────────────────────────────────────────────────────

// Logs tool name, duration, and isError status
{
  const stderr = captureStderr();
  try {
    const hook = loggingHook();
    const result = await hook(makeReq("scene_get_tree"), async () => OK_RESULT);
    const output = stderr.output();
    assert.ok(output.includes("tool=scene_get_tree"));
    assert.ok(output.includes("duration="));
    assert.ok(output.includes("isError=false"));
    assert.deepEqual(result, OK_RESULT);
  } finally {
    stderr.restore();
  }
}

// Logs isError=true for error results
{
  const stderr = captureStderr();
  try {
    const hook = loggingHook();
    await hook(makeReq("bad_tool"), async () => ERR_RESULT);
    assert.ok(stderr.output().includes("isError=true"));
  } finally {
    stderr.restore();
  }
}

// ── rateLimitHook ────────────────────────────────────────────────────

// maxPerWindow <= 0 → returns null (disabled)
{
  assert.equal(rateLimitHook(0), null);
  assert.equal(rateLimitHook(-1), null);
  assert.equal(rateLimitHook(), null); // default is 0
}

// Enforces limit within window
{
  const clock = FakeTimers.install({ toFake: ["Date"] });
  try {
    const hook = rateLimitHook(2, 1000)!;
    assert.ok(hook !== null);

    // First 2 calls succeed
    const r1 = await hook(makeReq(), async () => OK_RESULT);
    assert.equal(r1.isError, undefined);
    const r2 = await hook(makeReq(), async () => OK_RESULT);
    assert.equal(r2.isError, undefined);

    // Third call → rate limited
    const r3 = await hook(makeReq(), async () => OK_RESULT);
    assert.equal(r3.isError, true);
    const payload = JSON.parse(r3.content[0].text);
    assert.equal(payload.code, "RATE_LIMITED");
    assert.ok(payload.error.includes("Rate limit exceeded"));
  } finally {
    clock.uninstall();
  }
}

// Window expiry resets the counter
{
  const clock = FakeTimers.install({ toFake: ["Date"] });
  try {
    const hook = rateLimitHook(1, 1000)!;

    // First call succeeds
    const r1 = await hook(makeReq(), async () => OK_RESULT);
    assert.equal(r1.isError, undefined);

    // Second call → limited
    const r2 = await hook(makeReq(), async () => OK_RESULT);
    assert.equal(r2.isError, true);

    // Advance past window
    clock.tick(1001);

    // Now succeeds again
    const r3 = await hook(makeReq(), async () => OK_RESULT);
    assert.equal(r3.isError, undefined);
  } finally {
    clock.uninstall();
  }
}

// Burst behavior: all calls at same timestamp
{
  const clock = FakeTimers.install({ toFake: ["Date"] });
  try {
    const hook = rateLimitHook(3, 5000)!;

    // 3 calls at same time → all succeed
    for (let i = 0; i < 3; i++) {
      const r = await hook(makeReq(), async () => OK_RESULT);
      assert.equal(r.isError, undefined, `Call ${i + 1} should succeed`);
    }

    // 4th → limited
    const r4 = await hook(makeReq(), async () => OK_RESULT);
    assert.equal(r4.isError, true);
  } finally {
    clock.uninstall();
  }
}

console.log("All hooks tests passed.");

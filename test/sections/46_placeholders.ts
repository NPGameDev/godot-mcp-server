import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, IMPORT_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["texture_generate", "sound_generate"];

type GenResult = {
  success?: boolean;
  status?: string;
  class?: string | null;
  width?: number;
  height?: number;
  duration?: number;
  end_frequency?: number;
  warnings?: string[];
  elapsed_ms?: number;
  error?: string;
};

const DIR = "res://mcp_smoke_placeholders";
const SHAPES = ["solid", "circle", "triangle", "diamond", "arrow", "checkerboard", "grid"];
const WAVEFORMS = ["sine", "square", "triangle", "sawtooth", "noise"];

/**
 * Placeholders group — texture_generate + sound_generate. Exhaustively exercises
 * every shape, every waveform, the 3-colour model (fill/outline/background +
 * hollow), all colour input formats, the label overlay, dimension/duration caps,
 * the pitch sweep, if_exists (return/fail/replace), and every guard. All assets
 * land under a temp folder that is removed afterwards.
 */
export async function testPlaceholders(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const made: string[] = [];

  const genTexture = async (label: string, params: Record<string, unknown>): Promise<GenResult> => {
    const path = `${DIR}/${label}.png`;
    made.push(path);
    return (await bridge.call(
      "texture.generate",
      { path, if_exists: "replace", ...params },
      IMPORT_TIMEOUT,
    )) as GenResult;
  };
  const genSound = async (label: string, params: Record<string, unknown>): Promise<GenResult> => {
    const path = `${DIR}/${label}.wav`;
    made.push(path);
    return (await bridge.call(
      "sound.generate",
      { path, if_exists: "replace", ...params },
      IMPORT_TIMEOUT,
    )) as GenResult;
  };

  try {
    // ── texture.generate: every shape ──
    for (const shape of SHAPES) {
      const r = await genTexture(`shape_${shape}`, {
        shape,
        width: 32,
        height: 32,
        fill_color: "#3366ff",
        outline_color: "#000000",
      });
      if (r?.success && r.class === "Texture2D") pass(`texture.generate shape=${shape}`);
      else fail(`texture.generate shape=${shape}: ${JSON.stringify(r).slice(0, 160)}`);
    }

    // The default path reports the constructed class with NO
    // blocking import-settle — class is populated (never null), no "did not index"
    // warning, and elapsed_ms is ~0 (vs the pre-fix ~5000ms poll).
    const settleR = await genTexture("settle_contract", { shape: "solid", fill_color: "#abcdef" });
    const noIndexWarn = !(settleR.warnings ?? []).some((w) => w.includes("did not index"));
    if (settleR.class === "Texture2D" && noIndexWarn && (settleR.elapsed_ms ?? 9999) < 1000) {
      pass("texture.generate default path: class populated, no settle wait, no index warning (Item B)");
    } else {
      fail(
        `texture.generate settle contract: ${JSON.stringify({ class: settleR.class, warnings: settleR.warnings, elapsed_ms: settleR.elapsed_ms })}`,
      );
    }

    // Colour input formats (sequential — concurrent generate calls serialize on
    // the mutation lock and stack their import-settle waits).
    const colourResults: GenResult[] = [];
    colourResults.push(await genTexture("c_hex", { fill_color: "#ff8800" }));
    colourResults.push(await genTexture("c_arr01", { fill_color: [0.1, 0.2, 0.9] }));
    colourResults.push(await genTexture("c_arr255", { fill_color: [255, 128, 0] }));
    colourResults.push(await genTexture("c_named", { fill_color: "red" }));
    if (colourResults.every((r) => r?.success)) pass("texture.generate colour formats (hex / named / [0-1] / [0-255])");
    else fail(`texture.generate colour format failure: ${JSON.stringify(colourResults.map((r) => r?.success))}`);

    // Hollow (transparent fill + outline) and label overlay.
    const hollow = await genTexture("hollow", {
      shape: "circle",
      fill_color: [0, 0, 0, 0],
      outline_color: "#00ff00",
      outline_width: 3,
    });
    if (hollow?.success) pass("texture.generate hollow (transparent fill + outline)");
    else fail(`texture.generate hollow: ${JSON.stringify(hollow).slice(0, 150)}`);

    const labeled = await genTexture("labeled", {
      shape: "solid",
      fill_color: "#444444",
      label: "Enemy",
      label_color: "#ffffff",
    });
    if (labeled?.success) pass("texture.generate label overlay");
    else fail(`texture.generate label: ${JSON.stringify(labeled).slice(0, 150)}`);

    // Dimension cap (>1024 clamps, not rejects).
    const big = await genTexture("big", { shape: "solid", width: 4096, height: 4096 });
    if (big?.success && (big.width ?? 0) <= 1024 && (big.height ?? 0) <= 1024)
      pass("texture.generate dims clamped to <=1024");
    else fail(`texture.generate dims clamp: ${JSON.stringify({ w: big?.width, h: big?.height })}`);

    // if_exists: replace then return (idempotent no-op) then fail.
    const idem = `${DIR}/if_exists.png`;
    made.push(idem);
    await bridge.call("texture.generate", { path: idem, shape: "solid", if_exists: "replace" }, IMPORT_TIMEOUT);
    const ret = (await bridge.call(
      "texture.generate",
      { path: idem, shape: "circle", if_exists: "return" },
      IMPORT_TIMEOUT,
    )) as GenResult;
    if (ret?.success && ret.status === "returned") pass("texture.generate if_exists=return (idempotent no-op)");
    else fail(`texture.generate if_exists=return: ${JSON.stringify(ret).slice(0, 120)}`);
    assertGuard(
      ctx,
      "texture if_exists=fail on existing",
      await bridge.call("texture.generate", { path: idem, if_exists: "fail" }, CALL_TIMEOUT),
      "ALREADY_EXISTS",
      "exists",
    );

    // texture guards.
    assertGuard(
      ctx,
      "texture wrong extension",
      await bridge.call("texture.generate", { path: `${DIR}/x.jpg`, shape: "solid" }, CALL_TIMEOUT),
      "INVALID_PATH",
      "png",
    );
    assertGuard(
      ctx,
      "texture path traversal",
      await bridge.call("texture.generate", { path: "res://../escape.png", shape: "solid" }, CALL_TIMEOUT),
      "PATH_DENIED",
      "",
    );
    assertGuard(
      ctx,
      "texture blank result",
      await bridge.call(
        "texture.generate",
        {
          path: `${DIR}/blank.png`,
          shape: "solid",
          fill_color: [0, 0, 0, 0],
          outline_color: [0, 0, 0, 0],
          background_color: [0, 0, 0, 0],
        },
        CALL_TIMEOUT,
      ),
      "INVALID_PARAMS",
      "transparent",
    );
    assertGuard(
      ctx,
      "texture bad shape",
      await bridge.call("texture.generate", { path: `${DIR}/bad.png`, shape: "hexagon" }, CALL_TIMEOUT),
      "INVALID_PARAMS",
      "shape",
    );

    // ── sound.generate: every waveform ──
    for (const waveform of WAVEFORMS) {
      const r = await genSound(`wave_${waveform}`, { waveform, duration: 0.1, frequency: 440 });
      if (r?.success && r.class === "AudioStreamWAV") pass(`sound.generate waveform=${waveform}`);
      else fail(`sound.generate waveform=${waveform}: ${JSON.stringify(r).slice(0, 150)}`);
    }

    // Pitch sweep + decay envelope.
    const sweep = await genSound("sweep", {
      waveform: "square",
      frequency: 200,
      end_frequency: 900,
      duration: 0.2,
      decay: 0.1,
    });
    if (sweep?.success && sweep.end_frequency) pass("sound.generate pitch sweep + decay");
    else fail(`sound.generate sweep: ${JSON.stringify(sweep).slice(0, 150)}`);

    // Duration cap (>5s clamps).
    const longSound = await genSound("longcap", { waveform: "sine", duration: 30 });
    if (longSound?.success && (longSound.duration ?? 99) <= 5) pass("sound.generate duration clamped to <=5s");
    else fail(`sound.generate duration clamp: ${JSON.stringify({ d: longSound?.duration })}`);

    // sound guards.
    assertGuard(
      ctx,
      "sound wrong extension",
      await bridge.call("sound.generate", { path: `${DIR}/x.mp3`, waveform: "sine" }, CALL_TIMEOUT),
      "INVALID_PATH",
      "wav",
    );
    assertGuard(
      ctx,
      "sound bad waveform",
      await bridge.call("sound.generate", { path: `${DIR}/bad.wav`, waveform: "fmsynth" }, CALL_TIMEOUT),
      "INVALID_PARAMS",
      "waveform",
    );
    assertGuard(
      ctx,
      "sound path traversal",
      await bridge.call("sound.generate", { path: "res://../escape.wav", waveform: "sine" }, CALL_TIMEOUT),
      "PATH_DENIED",
      "",
    );
  } finally {
    for (const f of made) {
      try {
        await bridge.call("file.delete", { file_path: f }, CALL_TIMEOUT);
      } catch {
        /* noop */
      }
    }
    try {
      await bridge.call("folder.delete", { folder_path: DIR }, CALL_TIMEOUT);
    } catch {
      /* noop */
    }
  }
}

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertError } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "classdb_get_info",
  "classdb_search",
  "script_write",
  "script_delete",
  "editor_refresh",
];
export async function testClassdb(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ─── Native class: basic query ─────────────────────────────────────────
  const node2d = (await bridge.call("classdb.get_info", { class_name: "Node2D" }, CALL_TIMEOUT)) as {
    success?: boolean;
    class_name?: string;
    source?: string;
    parent?: string;
    inheritance_chain?: string[];
    properties?: unknown[];
    methods?: unknown[];
    signals?: unknown[];
    constants?: Record<string, unknown>;
    enums?: Record<string, unknown>;
  };

  if (!node2d?.success) {
    fail(`classdb.get_info Node2D: expected success, got ${JSON.stringify(node2d)}`);
    return;
  }
  if (node2d.source !== "native") fail(`classdb.get_info Node2D: expected source=native, got ${node2d.source}`);
  else pass("classdb.get_info Node2D -> native");

  if (node2d.parent !== "CanvasItem") fail(`classdb.get_info Node2D: expected parent=CanvasItem, got ${node2d.parent}`);
  else pass("classdb.get_info Node2D parent=CanvasItem");

  if (!Array.isArray(node2d.inheritance_chain) || !node2d.inheritance_chain.includes("Object")) {
    fail(`classdb.get_info Node2D: inheritance_chain missing Object`);
  } else {
    pass(`classdb.get_info Node2D inheritance_chain includes Object (${node2d.inheritance_chain.length} entries)`);
  }

  const ownPropCount = node2d.properties?.length ?? 0;
  if (ownPropCount < 1) fail(`classdb.get_info Node2D: expected >=1 own properties, got ${ownPropCount}`);
  else pass(`classdb.get_info Node2D has ${ownPropCount} own properties`);

  // Spot-check: Node2D should have a "position" property
  const hasPosition = (node2d.properties as { name: string }[] | undefined)?.some((p) => p.name === "position");
  if (!hasPosition) fail(`classdb.get_info Node2D: missing 'position' property`);
  else pass("classdb.get_info Node2D has 'position' property");

  // ─── include_inherited: true → more entries ───────────────────────────
  const node2dInherited = (await bridge.call(
    "classdb.get_info",
    { class_name: "Node2D", include_inherited: true },
    CALL_TIMEOUT,
  )) as { success?: boolean; properties?: unknown[]; methods?: unknown[] };

  if (!node2dInherited?.success) {
    fail(`classdb.get_info Node2D include_inherited: expected success`);
  } else {
    const inheritedPropCount = node2dInherited.properties?.length ?? 0;
    if (inheritedPropCount <= ownPropCount) {
      fail(`classdb.get_info Node2D: inherited props (${inheritedPropCount}) should exceed own (${ownPropCount})`);
    } else {
      pass(`classdb.get_info Node2D inherited props (${inheritedPropCount}) > own (${ownPropCount})`);
    }
  }

  // ─── sections filter: properties only ─────────────────────────────────
  const propsOnly = (await bridge.call(
    "classdb.get_info",
    { class_name: "Node2D", sections: ["properties"] },
    CALL_TIMEOUT,
  )) as {
    success?: boolean;
    properties?: unknown[];
    methods?: unknown;
    signals?: unknown;
    constants?: unknown;
  };

  if (!propsOnly?.success) {
    fail(`classdb.get_info Node2D sections=[properties]: expected success`);
  } else if (propsOnly.methods !== undefined || propsOnly.signals !== undefined || propsOnly.constants !== undefined) {
    fail(`classdb.get_info Node2D sections=[properties]: should not include methods/signals/constants`);
  } else {
    pass("classdb.get_info Node2D sections=[properties] returns only properties");
  }

  // ─── Unknown class → UNKNOWN_CLASS ────────────────────────────────────
  const unknown = await bridge.call("classdb.get_info", { class_name: "NoSuchClassEverXYZ123" }, CALL_TIMEOUT);
  assertError(ctx, "classdb.get_info unknown class", unknown, "UNKNOWN_CLASS");

  // ─── Global class round-trip ──────────────────────────────────────────
  const testClassName = "MCPSmokeClassdbProbe";
  const testScriptPath = "res://smoke_classdb_probe.gd";
  const scriptContent = `class_name ${testClassName}\nextends Node2D\n\nvar probe_value: int = 42\n\nsignal probe_signal(val: int)\n`;

  // Write a temporary script with a class_name
  const writeResult = (await bridge.call(
    "script.write",
    { file_path: testScriptPath, content: scriptContent },
    CALL_TIMEOUT,
  )) as { success?: boolean };

  if (!writeResult?.success) {
    fail(`classdb.get_info global: could not write probe script: ${JSON.stringify(writeResult)}`);
  } else {
    // Reload scripts so Godot picks up the new class_name
    await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
    // Small delay to allow script class list to update
    await new Promise((r) => setTimeout(r, 500));

    const globalResult = (await bridge.call("classdb.get_info", { class_name: testClassName }, CALL_TIMEOUT)) as {
      success?: boolean;
      source?: string;
      script_path?: string;
      parent?: string;
      properties?: { name: string }[];
      signals?: { name: string }[];
    };

    if (!globalResult?.success) {
      fail(`classdb.get_info global: expected success for ${testClassName}, got ${JSON.stringify(globalResult)}`);
    } else {
      if (globalResult.source !== "global")
        fail(`classdb.get_info global: expected source=global, got ${globalResult.source}`);
      else pass(`classdb.get_info ${testClassName} -> source=global`);

      if (globalResult.script_path !== testScriptPath) fail(`classdb.get_info global: script_path mismatch`);
      else pass(`classdb.get_info ${testClassName} script_path correct`);

      if (globalResult.parent !== "Node2D")
        fail(`classdb.get_info global: expected parent=Node2D, got ${globalResult.parent}`);
      else pass(`classdb.get_info ${testClassName} parent=Node2D`);

      const hasProbeValue = globalResult.properties?.some((p) => p.name === "probe_value");
      if (!hasProbeValue) fail(`classdb.get_info global: missing probe_value property`);
      else pass(`classdb.get_info ${testClassName} has probe_value property`);

      const hasProbeSignal = globalResult.signals?.some((s) => s.name === "probe_signal");
      if (!hasProbeSignal) fail(`classdb.get_info global: missing probe_signal signal`);
      else pass(`classdb.get_info ${testClassName} has probe_signal signal`);
    }

    // ─── classdb.search: global class in results ──────────────────────────
    const searchGlobal = (await bridge.call(
      "classdb.search",
      { base_class: "Node2D", include_global: true },
      CALL_TIMEOUT,
    )) as { success?: boolean; classes?: { name: string; source: string }[] };

    if (!searchGlobal?.success) {
      fail(`classdb.search global: expected success, got ${JSON.stringify(searchGlobal)}`);
    } else {
      const found = searchGlobal.classes?.some((c) => c.name === testClassName && c.source === "global");
      if (!found) fail(`classdb.search global: ${testClassName} not found in base_class=Node2D results`);
      else pass(`classdb.search includes global class ${testClassName}`);
    }

    // Clean up: delete the probe script
    await bridge.call("script.delete", { file_path: testScriptPath }, CALL_TIMEOUT);
    await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
  }

  // ─── classdb.search: base_class filter ──────────────────────────────────
  const searchPhysics = (await bridge.call("classdb.search", { base_class: "PhysicsBody3D" }, CALL_TIMEOUT)) as {
    success?: boolean;
    count?: number;
    classes?: { name: string }[];
  };

  if (!searchPhysics?.success) {
    fail(`classdb.search PhysicsBody3D: expected success, got ${JSON.stringify(searchPhysics)}`);
  } else {
    const names = searchPhysics.classes?.map((c) => c.name) ?? [];
    const hasRigid = names.includes("RigidBody3D");
    const hasChar = names.includes("CharacterBody3D");
    if (!hasRigid || !hasChar)
      fail(`classdb.search PhysicsBody3D: missing RigidBody3D or CharacterBody3D (got ${names.join(", ")})`);
    else
      pass(
        `classdb.search base_class=PhysicsBody3D -> ${searchPhysics.count} classes (includes RigidBody3D, CharacterBody3D)`,
      );
  }

  // ─── classdb.search: pattern filter ─────────────────────────────────────
  const searchCamera = (await bridge.call("classdb.search", { pattern: "Camera" }, CALL_TIMEOUT)) as {
    success?: boolean;
    count?: number;
    classes?: { name: string }[];
  };

  if (!searchCamera?.success) {
    fail(`classdb.search Camera: expected success`);
  } else {
    const names = searchCamera.classes?.map((c) => c.name) ?? [];
    const has2d = names.includes("Camera2D");
    const has3d = names.includes("Camera3D");
    if (!has2d || !has3d) fail(`classdb.search Camera: missing Camera2D or Camera3D`);
    else pass(`classdb.search pattern=Camera -> ${searchCamera.count} classes (includes Camera2D, Camera3D)`);
  }

  // ─── classdb.search: combined filter ────────────────────────────────────
  const searchNodeButton = (await bridge.call(
    "classdb.search",
    { base_class: "Node", pattern: "Button" },
    CALL_TIMEOUT,
  )) as { success?: boolean; count?: number; classes?: { name: string }[] };

  if (!searchNodeButton?.success) {
    fail(`classdb.search Node+Button: expected success`);
  } else {
    const names = searchNodeButton.classes?.map((c) => c.name) ?? [];
    if (!names.includes("Button")) fail(`classdb.search Node+Button: missing Button`);
    else pass(`classdb.search base_class=Node pattern=Button -> ${searchNodeButton.count} classes`);
  }

  // ─── classdb.search: unknown base_class → UNKNOWN_CLASS ────────────────
  const searchUnknown = await bridge.call("classdb.search", { base_class: "NoSuchClassEverXYZ999" }, CALL_TIMEOUT);
  assertError(ctx, "classdb.search unknown base_class", searchUnknown, "UNKNOWN_CLASS");

  // ─── classdb.get_info: per-section total counts ──────────────────────────
  const controlInherited = (await bridge.call(
    "classdb.get_info",
    { class_name: "Control", include_inherited: true, sections: ["methods"] },
    CALL_TIMEOUT,
  )) as {
    success?: boolean;
    methods?: unknown[];
    total_methods?: number;
    truncated?: boolean;
    next_offset?: number;
  };

  if (!controlInherited?.success) {
    fail(`classdb.get_info Control inherited: expected success`);
  } else {
    if (typeof controlInherited.total_methods !== "number") {
      fail(`classdb.get_info Control inherited: missing total_methods`);
    } else {
      pass(`classdb.get_info Control inherited has total_methods=${controlInherited.total_methods}`);
    }
    if (controlInherited.total_methods! > 200 && !controlInherited.truncated) {
      fail(`classdb.get_info Control inherited: expected truncated=true when methods exceed 200`);
    } else if (controlInherited.total_methods! > 200) {
      pass(`classdb.get_info Control inherited truncated=true (total_methods=${controlInherited.total_methods})`);
    }
    // A truncated single-section read carries a next_offset resume cursor.
    if (controlInherited.truncated) {
      if (typeof controlInherited.next_offset === "number")
        pass(`classdb.get_info next_offset present on truncated single-section read (${controlInherited.next_offset})`);
      else fail(`classdb.get_info: truncated single-section read missing next_offset`);
    }
  }

  // ─── classdb.get_info: offset pagination ─────────────────────────────────
  const controlPage2 = (await bridge.call(
    "classdb.get_info",
    { class_name: "Control", include_inherited: true, sections: ["methods"], offset: 200 },
    CALL_TIMEOUT,
  )) as {
    success?: boolean;
    methods?: { name: string }[];
    total_methods?: number;
  };

  if (!controlPage2?.success) {
    fail(`classdb.get_info Control offset=200: expected success`);
  } else {
    const page2Methods = controlPage2.methods?.length ?? 0;
    if (page2Methods < 1) {
      fail(`classdb.get_info Control offset=200: expected >=1 further methods, got ${page2Methods}`);
    } else {
      pass(`classdb.get_info Control offset=200 returned ${page2Methods} further methods`);
    }
    if (controlPage2.total_methods !== controlInherited?.total_methods) {
      fail(
        `classdb.get_info Control offset=200: total_methods mismatch (${controlPage2.total_methods} vs ${controlInherited?.total_methods})`,
      );
    } else {
      pass(`classdb.get_info Control offset=200 total_methods consistent`);
    }
  }

  // ─── classdb.search: offset pagination ───────────────────────────────────
  const searchNoOffset = (await bridge.call("classdb.search", { base_class: "Node", pattern: "2D" }, CALL_TIMEOUT)) as {
    success?: boolean;
    total_classes?: number;
    count?: number;
  };

  const searchWithOffset = (await bridge.call(
    "classdb.search",
    { base_class: "Node", pattern: "2D", offset: 5 },
    CALL_TIMEOUT,
  )) as { success?: boolean; total_classes?: number; count?: number };

  if (!searchNoOffset?.success || !searchWithOffset?.success) {
    fail(`classdb.search offset: expected success on both calls`);
  } else {
    // total_classes: the full (pre-cap) class count.
    if (searchWithOffset.total_classes !== searchNoOffset.total_classes) {
      fail(
        `classdb.search offset=5: total_classes changed (${searchNoOffset.total_classes} -> ${searchWithOffset.total_classes})`,
      );
    } else {
      pass(`classdb.search offset=5 total_classes unchanged (${searchWithOffset.total_classes})`);
    }
    if (typeof searchNoOffset.total_classes !== "number") fail(`classdb.search: missing canonical total_classes field`);
    else pass(`classdb.search total_classes present (${searchNoOffset.total_classes})`);
    if ((searchWithOffset.count ?? 0) >= (searchNoOffset.count ?? 0)) {
      fail(`classdb.search offset=5: count should decrease`);
    } else {
      pass(`classdb.search offset=5 count decreased (${searchNoOffset.count} -> ${searchWithOffset.count})`);
    }
  }

  // ─── classdb.get_info: offset AT the exact end → truncated:false, no cursor ───
  // An offset that lands at/after the last page must drop both truncated and the
  // next_offset cursor; a dangling cursor with nothing left to fetch is the regression.
  if (typeof controlInherited?.total_methods === "number") {
    const atEnd = (await bridge.call(
      "classdb.get_info",
      { class_name: "Control", include_inherited: true, sections: ["methods"], offset: controlInherited.total_methods },
      CALL_TIMEOUT,
    )) as { success?: boolean; truncated?: boolean; next_offset?: number };
    if (!atEnd?.success) {
      fail(`classdb.get_info offset==total_methods: expected success`);
    } else if (atEnd.truncated !== false) {
      fail(`classdb.get_info offset==total_methods: expected truncated=false, got ${atEnd.truncated}`);
    } else if (atEnd.next_offset !== undefined) {
      fail(`classdb.get_info offset==total_methods: should not emit next_offset at the end`);
    } else {
      pass(`classdb.get_info offset==total_methods (${controlInherited.total_methods}) -> truncated=false, no cursor`);
    }
  }

  // ─── classdb.search: offset PAST the end → truncated:false, no self-loop ───
  // Guards the documented "page until truncated=false" loop against never
  // terminating: past the last page, search must not echo next_offset == offset.
  if (searchNoOffset?.success && typeof searchNoOffset.total_classes === "number") {
    const pastOffset = searchNoOffset.total_classes + 50;
    const pastEnd = (await bridge.call(
      "classdb.search",
      { base_class: "Node", pattern: "2D", offset: pastOffset },
      CALL_TIMEOUT,
    )) as { success?: boolean; count?: number; truncated?: boolean; next_offset?: number };
    if (!pastEnd?.success) {
      fail(`classdb.search offset past end: expected success`);
    } else if (pastEnd.truncated !== false) {
      fail(`classdb.search offset past end: expected truncated=false, got ${pastEnd.truncated}`);
    } else if (pastEnd.next_offset !== undefined) {
      fail(`classdb.search offset past end: should not emit next_offset (infinite-loop guard)`);
    } else {
      pass(`classdb.search offset past end (${pastOffset}) -> truncated=false, no cursor`);
    }
  }
}

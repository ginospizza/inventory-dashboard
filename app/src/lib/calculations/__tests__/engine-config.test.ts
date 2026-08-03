import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_ENGINE_CONFIG,
  setEngineConfig,
  resetEngineConfig,
  validateEngineConfig,
  type EngineConfig,
} from "../engine-config";
import { diffStatusPct, ratioStatus } from "../engine";

/**
 * The engine grades with the ACTIVE config (James, July 31 2026: editable
 * thresholds). These tests pin the two properties that matter: defaults are
 * byte-identical to the old constants, and a config change actually changes
 * grading — without it, the admin edit UI would be another panel that displays
 * numbers that don't drive anything, which is the exact defect being removed.
 */

const custom = (over: Partial<EngineConfig>): EngineConfig => ({
  pct: { ...DEFAULT_ENGINE_CONFIG.pct },
  ratio: { ...DEFAULT_ENGINE_CONFIG.ratio },
  boxRatios: DEFAULT_ENGINE_CONFIG.boxRatios,
  pizzaSales: DEFAULT_ENGINE_CONFIG.pizzaSales,
  ...over,
});

afterEach(() => resetEngineConfig());

describe("engine honors the active config", () => {
  it("grades identically to the constants by default", () => {
    expect(diffStatusPct(130, 100)).toBe("warn");   // 30% off
    expect(diffStatusPct(160, 100)).toBe("bad");    // 60%
    expect(diffStatusPct(180, 100)).toBe("severe"); // 80%
    expect(ratioStatus(1.3)).toBe("warn");
  });

  it("a tightened diff threshold changes the grade", () => {
    setEngineConfig(custom({ pct: { warn: 0.10, bad: 0.20, severe: 0.30 } }));
    expect(diffStatusPct(115, 100)).toBe("warn");   // 15% now Borderline
    expect(diffStatusPct(125, 100)).toBe("bad");    // 25% now At Risk
    expect(diffStatusPct(135, 100)).toBe("severe"); // 35% now Severe
  });

  it("a widened ratio band changes the grade", () => {
    setEngineConfig(custom({
      ratio: { ok_low: 50, ok_high: 150, warn_low: 40, warn_high: 160, bad_low: 30, bad_high: 170 },
    }));
    expect(ratioStatus(1.3)).toBe("ok"); // 130% is compliant under the wide band
  });

  it("resetEngineConfig restores the constants", () => {
    setEngineConfig(custom({ pct: { warn: 0.01, bad: 0.02, severe: 0.03 } }));
    expect(diffStatusPct(105, 100)).toBe("severe");
    resetEngineConfig();
    expect(diffStatusPct(105, 100)).toBe("ok");
  });
});

describe("validateEngineConfig", () => {
  it("accepts the defaults", () => {
    expect(validateEngineConfig(DEFAULT_ENGINE_CONFIG)).toEqual([]);
  });

  it("rejects non-increasing diff thresholds", () => {
    const errs = validateEngineConfig(custom({ pct: { warn: 0.5, bad: 0.5, severe: 0.75 } }));
    expect(errs.join(" ")).toMatch(/warn < bad/);
  });

  it("rejects ratio bands that do not nest", () => {
    const errs = validateEngineConfig(custom({
      ratio: { ok_low: 75, ok_high: 125, warn_low: 80, warn_high: 135, bad_low: 50, bad_high: 150 },
    }));
    expect(errs.join(" ")).toMatch(/nest/);
  });

  it("rejects a compliant band that excludes 100%", () => {
    const errs = validateEngineConfig(custom({
      ratio: { ok_low: 110, ok_high: 125, warn_low: 65, warn_high: 135, bad_low: 50, bad_high: 150 },
    }));
    expect(errs.join(" ")).toMatch(/contain 100/);
  });
});

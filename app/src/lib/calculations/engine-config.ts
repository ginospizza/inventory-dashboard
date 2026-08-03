/**
 * Runtime engine configuration — the editable half of what used to be
 * hardcoded in constants.ts (James, July 31 2026: editable thresholds and
 * assumptions).
 *
 * The engine reads whatever is ACTIVE here. The defaults are the constants,
 * byte-for-byte, so a fresh process grades exactly as it always has; server
 * entry points call setEngineConfig() with the DB values (see config-loader)
 * before computing, and the store page hands the same object to the client so
 * client-side status explanations grade with the same numbers the server did.
 *
 * Deliberately NO supabase import — this module is shared by server code,
 * client components, scripts, and tests. Loading is the loader's job.
 *
 * Design note: module-level active config (rather than threading a parameter
 * through ~15 engine functions and every caller) keeps the engine's call sites
 * untouched. All concurrent requests in a process want the same values — the
 * one DB row — so the shared mutable reference is benign; tests that never
 * call setEngineConfig get the constants and stay deterministic.
 */

import {
  BOX_RATIOS,
  PIZZA_SALES_PER_CASE,
  DEFAULT_PCT_THRESHOLDS,
  DEFAULT_RATIO_THRESHOLDS,
} from "./constants";

export type BoxBucket = keyof typeof BOX_RATIOS;

export interface EngineConfig {
  /** Ingredient diff vs box-expected, as FRACTIONS: warn 0.25 / bad 0.5 / severe 0.75. */
  pct: { warn: number; bad: number; severe: number };
  /** Ratio bands as PERCENT of the 100% ideal. */
  ratio: {
    ok_low: number; ok_high: number;
    warn_low: number; warn_high: number;
    bad_low: number; bad_high: number;
  };
  /** Per-box usage (per-piece for clamshell/plate), keyed by bucket. */
  boxRatios: Record<BoxBucket, { cheese_oz: number; sauce_oz: number; dough_kg: number }>;
  /** Estimated pizzas per case (per piece for clamshell/plate). */
  pizzaSales: Record<BoxBucket, number>;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  pct: { ...DEFAULT_PCT_THRESHOLDS },
  ratio: { ...DEFAULT_RATIO_THRESHOLDS },
  boxRatios: Object.fromEntries(
    Object.entries(BOX_RATIOS).map(([k, v]) => [k, { ...v }])
  ) as EngineConfig["boxRatios"],
  pizzaSales: { ...PIZZA_SALES_PER_CASE },
};

let active: EngineConfig = DEFAULT_ENGINE_CONFIG;

export function getEngineConfig(): EngineConfig {
  return active;
}

/** Replace the active config (server loader, client hydration, tests). */
export function setEngineConfig(config: EngineConfig): void {
  active = config;
}

/** Restore the constants (tests). */
export function resetEngineConfig(): void {
  active = DEFAULT_ENGINE_CONFIG;
}

/** Validation shared by the API route and the admin UI. Returns error strings. */
export function validateEngineConfig(c: EngineConfig): string[] {
  const errors: string[] = [];
  const { pct, ratio } = c;
  if (!(pct.warn > 0)) errors.push("Diff warn must be above 0");
  if (!(pct.warn < pct.bad)) errors.push("Diff thresholds must increase: warn < bad");
  if (!(pct.bad < pct.severe)) errors.push("Diff thresholds must increase: bad < severe");
  if (!(ratio.bad_low < ratio.warn_low && ratio.warn_low < ratio.ok_low))
    errors.push("Ratio low bounds must nest: bad < warn < ok");
  if (!(ratio.ok_high < ratio.warn_high && ratio.warn_high < ratio.bad_high))
    errors.push("Ratio high bounds must nest: ok < warn < bad");
  if (!(ratio.ok_low < 100 && 100 < ratio.ok_high))
    errors.push("The compliant ratio band must contain 100%");
  for (const [bucket, v] of Object.entries(c.boxRatios)) {
    if (v.cheese_oz < 0 || v.sauce_oz < 0 || v.dough_kg < 0)
      errors.push(`Assumptions for ${bucket} cannot be negative`);
  }
  return errors;
}

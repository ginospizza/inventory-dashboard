/**
 * Load the engine configuration from the DB and make it active.
 *
 * Server-only (service-role client). Call ensureEngineConfig() at the top of
 * any path that grades or estimates: fetchMetrics covers the pages, and the
 * upload route + scripts call it explicitly. A short TTL keeps admin edits
 * taking effect within a minute without a query per render.
 *
 * Falls back silently to the constants when the tables are missing or the rows
 * are malformed — a broken config row must never take the dashboard down; the
 * constants are the exact values the tables were seeded from.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_ENGINE_CONFIG,
  setEngineConfig,
  type BoxBucket,
  type EngineConfig,
} from "./engine-config";

const TTL_MS = 60_000;
let loadedAt = 0;
let loading: Promise<void> | null = null;

export async function ensureEngineConfig(): Promise<void> {
  if (Date.now() - loadedAt < TTL_MS) return;
  // Coalesce concurrent callers onto one query.
  loading ??= loadNow().finally(() => {
    loading = null;
  });
  return loading;
}

/** Force a reload (used by the thresholds API after a write). */
export async function reloadEngineConfig(): Promise<void> {
  loadedAt = 0;
  return ensureEngineConfig();
}

async function loadNow(): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: thresholds }, { data: assumptions }] = await Promise.all([
      admin.from("thresholds").select("*"),
      admin.from("usage_assumptions").select("*"),
    ]);

    const diff = (thresholds ?? []).find((t) => t.metric === "ingredient_diff_pct");
    const bands = (thresholds ?? []).find((t) => t.metric === "ratio_bands");

    const config: EngineConfig = {
      pct: {
        warn: num(diff?.warn_value, DEFAULT_ENGINE_CONFIG.pct.warn),
        bad: num(diff?.bad_value, DEFAULT_ENGINE_CONFIG.pct.bad),
        severe: num(diff?.severe_value, DEFAULT_ENGINE_CONFIG.pct.severe),
      },
      ratio: {
        ok_low: num(bands?.ok_low, DEFAULT_ENGINE_CONFIG.ratio.ok_low),
        ok_high: num(bands?.ok_high, DEFAULT_ENGINE_CONFIG.ratio.ok_high),
        warn_low: num(bands?.warn_low, DEFAULT_ENGINE_CONFIG.ratio.warn_low),
        warn_high: num(bands?.warn_high, DEFAULT_ENGINE_CONFIG.ratio.warn_high),
        bad_low: num(bands?.bad_low, DEFAULT_ENGINE_CONFIG.ratio.bad_low),
        bad_high: num(bands?.bad_high, DEFAULT_ENGINE_CONFIG.ratio.bad_high),
      },
      boxRatios: { ...DEFAULT_ENGINE_CONFIG.boxRatios },
      pizzaSales: { ...DEFAULT_ENGINE_CONFIG.pizzaSales },
    };

    for (const a of assumptions ?? []) {
      const bucket = a.pizza_size as BoxBucket;
      if (!(bucket in config.boxRatios)) continue;
      config.boxRatios[bucket] = {
        cheese_oz: num(a.cheese_oz, config.boxRatios[bucket].cheese_oz),
        sauce_oz: num(a.sauce_oz, config.boxRatios[bucket].sauce_oz),
        dough_kg: num(a.dough_kg, config.boxRatios[bucket].dough_kg),
      };
      config.pizzaSales[bucket] = num(a.pizza_sales_per_case, config.pizzaSales[bucket]);
    }

    setEngineConfig(config);
    loadedAt = Date.now();
  } catch (err) {
    // Constants stay active; retry after the TTL rather than hammering.
    console.error("engine config load failed — using constants:", err);
    loadedAt = Date.now();
  }
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

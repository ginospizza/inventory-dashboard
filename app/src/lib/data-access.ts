/**
 * Server-side data access functions.
 * Used by page components to fetch data with proper RLS filtering.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { computeNetworkStats, computeBrandStats, severityScore, DEFAULT_DIFF_THRESHOLDS, ROLLING_WINDOW_WEEKS } from "@/lib/calculations";
import type { WeeklyMetrics, NetworkStats, BrandStats, WeeklyTrend, Brand, Anomaly } from "@/lib/types";

interface MetricsFilters {
  week?: number | string; // number for specific week, or "all", "ytd", "q1", "q2", "q3", "q4"
  year?: number;
  brand?: string;
  dsm?: string;
  status?: string;
  storeId?: string;
}

const QUARTER_RANGES: Record<string, [number, number]> = {
  q1: [1, 13],
  q2: [14, 26],
  q3: [27, 39],
  q4: [40, 52],
};

/**
 * Fetch weekly metrics with joins to stores and DSMs.
 * RLS automatically filters by user role.
 */
export async function fetchMetrics(filters: MetricsFilters = {}) {
  const supabase = createAdminClient();
  const year = filters.year ?? new Date().getFullYear();

  let query = supabase
    .from("weekly_metrics")
    .select(`
      *,
      stores!inner (
        id,
        code,
        name,
        brand,
        city,
        address,
        dsm_id,
        dsms (
          id,
          name,
          region
        )
      )
    `)
    .eq("year", year)
    .order("week_number", { ascending: false });

  if (filters.week) {
    const w = filters.week;
    if (typeof w === "number") {
      query = query.eq("week_number", w);
    } else if (w === "all") {
      // no week filter — get all weeks
    } else if (w === "ytd") {
      // current week of the year
      const currentWeek = Math.ceil((Date.now() - new Date(year, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
      query = query.lte("week_number", currentWeek);
    } else if (QUARTER_RANGES[w]) {
      const [start, end] = QUARTER_RANGES[w];
      query = query.gte("week_number", start).lte("week_number", end);
    } else {
      // Try as number
      const num = Number(w);
      if (num > 0) query = query.eq("week_number", num);
    }
  }

  if (filters.brand && filters.brand !== "all") {
    query = query.eq("stores.brand", filters.brand);
  }

  if (filters.dsm && filters.dsm !== "all") {
    query = query.eq("stores.dsm_id", filters.dsm);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("overall_status", filters.status);
  }

  if (filters.storeId) {
    query = query.eq("store_id", filters.storeId);
  }

  // Paginate to handle >1000 rows for range queries
  const allData: Record<string, unknown>[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) {
      console.error("fetchMetrics error:", error);
      break;
    }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return allData as unknown as (WeeklyMetrics & { stores: Record<string, unknown> })[];
}

/**
 * Get the latest week number that has data.
 */
export async function getLatestWeek(year?: number): Promise<number | null> {
  const supabase = createAdminClient();
  const y = year ?? new Date().getFullYear();

  const { data } = await supabase
    .from("weekly_metrics")
    .select("week_number")
    .eq("year", y)
    .order("week_number", { ascending: false })
    .limit(1)
    .single();

  return data?.week_number ?? null;
}

/**
 * Get all available weeks (paginated to avoid 1000-row limit).
 */
export async function getAvailableWeeks(year?: number): Promise<number[]> {
  const supabase = createAdminClient();
  const y = year ?? new Date().getFullYear();

  const weeks = new Set<number>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await supabase
      .from("weekly_metrics")
      .select("week_number")
      .eq("year", y)
      .order("week_number", { ascending: false })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    data.forEach((d: { week_number: number }) => weeks.add(d.week_number));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return [...weeks].sort((a, b) => b - a);
}

/**
 * Get all available years (paginated to avoid 1000-row limit).
 */
export async function getAvailableYears(): Promise<number[]> {
  const supabase = createAdminClient();

  const years = new Set<number>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await supabase
      .from("weekly_metrics")
      .select("year")
      .order("year", { ascending: false })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    data.forEach((d: { year: number }) => years.add(d.year));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return [...years].sort((a, b) => b - a);
}

/**
 * Get all brands that have stores, for the Brand filter dropdown.
 * "OTHER" is excluded — it's the unclassified bucket, not a real brand
 * (James, July 6, 2026). Those stores remain visible under "All Brands".
 */
export async function getAvailableBrands(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("stores")
    .select("brand")
    .order("brand");

  if (!data) return [];
  return [...new Set(data.map((d: { brand: string }) => d.brand))].filter(
    (b) => b !== "OTHER"
  );
}

/**
 * Get all DSMs.
 */
export async function getDsms(): Promise<{ id: string; name: string; region: string }[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("dsms")
    .select("id, name, region")
    .order("name");

  return (data ?? []) as { id: string; name: string; region: string }[];
}

/**
 * Compute network stats for a given week.
 */
export async function getNetworkStats(
  filters: MetricsFilters = {}
): Promise<NetworkStats> {
  const metrics = await fetchMetrics(filters);

  // Deduplicate by store (take latest week if no week filter)
  const byStore = new Map<string, WeeklyMetrics>();
  for (const m of metrics) {
    const existing = byStore.get(m.store_id);
    if (!existing || m.week_number > existing.week_number) {
      byStore.set(m.store_id, m as unknown as WeeklyMetrics);
    }
  }

  return computeNetworkStats(Array.from(byStore.values()));
}

/**
 * Compute brand breakdown stats.
 */
export async function getBrandStats(
  filters: MetricsFilters = {}
): Promise<BrandStats[]> {
  const supabase = createAdminClient();
  const metrics = await fetchMetrics(filters);

  // Build store map for brand lookup
  const storeMap = new Map<string, { brand: Brand }>();
  for (const m of metrics) {
    const store = m.stores as unknown as { id: string; brand: Brand };
    if (store) {
      storeMap.set(m.store_id, { brand: store.brand as Brand });
    }
  }

  // Deduplicate by store
  const byStore = new Map<string, WeeklyMetrics>();
  for (const m of metrics) {
    const existing = byStore.get(m.store_id);
    if (!existing || m.week_number > existing.week_number) {
      byStore.set(m.store_id, m as unknown as WeeklyMetrics);
    }
  }

  return computeBrandStats(Array.from(byStore.values()), storeMap);
}

/**
 * Get weekly compliance trend (last N weeks).
 */
export async function getWeeklyTrend(
  numWeeks = ROLLING_WINDOW_WEEKS,
  filters: Omit<MetricsFilters, "week"> = {}
): Promise<WeeklyTrend[]> {
  const weeks = await getAvailableWeeks(filters.year);
  const recentWeeks = weeks.slice(0, numWeeks);

  const trends: WeeklyTrend[] = [];

  for (const week of recentWeeks) {
    const stats = await getNetworkStats({ ...filters, week });
    trends.push({
      week,
      year: filters.year ?? new Date().getFullYear(),
      compliance_pct: stats.compliance_pct,
      avg_cheese_diff: stats.avg_cheese_diff,
      avg_sauce_diff: stats.avg_sauce_diff,
      avg_flour_diff: stats.avg_flour_diff,
      avg_sauce_cheese: stats.avg_sauce_cheese_ratio,
      avg_flour_cheese: stats.avg_flour_cheese_ratio,
      cheese_on_target_pct: stats.cheese_on_target_pct,
      sauce_on_target_pct: stats.sauce_on_target_pct,
      flour_on_target_pct: stats.flour_on_target_pct,
      sc_in_band_pct: stats.sauce_cheese_in_band_pct,
      fc_in_band_pct: stats.flour_cheese_in_band_pct,
    });
  }

  return trends.reverse(); // chronological order
}

/**
 * Get stores requiring attention (worst performing).
 */
export async function getAtRiskStores(
  filters: MetricsFilters = {},
  limit = 8
) {
  const metrics = await fetchMetrics(filters);

  // Deduplicate by store (latest week)
  const byStore = new Map<string, typeof metrics[0]>();
  for (const m of metrics) {
    const existing = byStore.get(m.store_id);
    if (!existing || m.week_number > existing.week_number) {
      byStore.set(m.store_id, m);
    }
  }

  // Sort by severity: bad first, then warn, then by how far off the single
  // worst metric is (severityScore) -- NOT flag count. Flags use old flat
  // thresholds that don't track the %-based ones overall_status is actually
  // graded on, so most stores tied and the "top" of the list was close to
  // arbitrary among ties (James, July 10-11 2026).
  const sorted = Array.from(byStore.values())
    .filter((m) => m.overall_status !== "ok")
    .sort((a, b) => {
      const statusOrder = { bad: 0, warn: 1, ok: 2 };
      const aOrder = statusOrder[a.overall_status as keyof typeof statusOrder] ?? 2;
      const bOrder = statusOrder[b.overall_status as keyof typeof statusOrder] ?? 2;
      if (aOrder !== bOrder) return aOrder - bOrder;

      return severityScore(b as unknown as WeeklyMetrics) - severityScore(a as unknown as WeeklyMetrics);
    })
    .slice(0, limit);

  return sorted;
}

/**
 * Detect anomalies in weekly metrics.
 */
export async function getAnomalies(
  filters: MetricsFilters = {},
  storeId?: string
): Promise<Anomaly[]> {
  const metrics = await fetchMetrics(filters);
  const anomalies: Anomaly[] = [];
  const extremeThreshold = DEFAULT_DIFF_THRESHOLDS.bad * 2; // 12 cases

  // Build store lookup
  const storeInfo = new Map<string, { code: string; id: string }>();
  for (const m of metrics) {
    const store = m.stores as unknown as { id: string; code: string } | undefined;
    if (store) storeInfo.set(m.store_id, { code: store.code, id: store.id });
  }

  // Group by store for week-over-week analysis
  const byStore = new Map<string, typeof metrics>();
  for (const m of metrics) {
    if (storeId && m.store_id !== storeId) continue;
    if (!byStore.has(m.store_id)) byStore.set(m.store_id, []);
    byStore.get(m.store_id)!.push(m);
  }

  for (const [sid, storeMetrics] of byStore) {
    const info = storeInfo.get(sid);
    if (!info) continue;
    const sorted = [...storeMetrics].sort((a, b) => a.week_number - b.week_number);

    for (const m of sorted) {
      // Extreme diffs (>2x bad threshold)
      if (Math.abs(m.cheese_diff) > extremeThreshold) {
        anomalies.push({
          type: "extreme_diff",
          severity: "critical",
          store_code: info.code,
          store_id: sid,
          week: m.week_number,
          metric: "Cheese",
          value: m.cheese_diff,
          description: `Cheese diff of ${m.cheese_diff > 0 ? "+" : ""}${m.cheese_diff.toFixed(1)} cases (${m.cheese_diff > 0 ? "bulk order or event" : "possible shortage"})`,
        });
      }
      if (Math.abs(m.sauce_diff) > extremeThreshold) {
        anomalies.push({
          type: "extreme_diff",
          severity: "critical",
          store_code: info.code,
          store_id: sid,
          week: m.week_number,
          metric: "Sauce",
          value: m.sauce_diff,
          description: `Sauce diff of ${m.sauce_diff > 0 ? "+" : ""}${m.sauce_diff.toFixed(1)} cases`,
        });
      }

      // Zero cheese
      if (m.cheese_ordered_oz === 0 && m.boxes_total > 0) {
        anomalies.push({
          type: "zero_cheese",
          severity: "warning",
          store_code: info.code,
          store_id: sid,
          week: m.week_number,
          metric: "Cheese",
          value: 0,
          description: "Ordered boxes but no cheese",
        });
      }

      // Zero boxes
      if (m.boxes_total === 0 && m.cheese_ordered_oz > 0) {
        anomalies.push({
          type: "zero_boxes",
          severity: "info",
          store_code: info.code,
          store_id: sid,
          week: m.week_number,
          metric: "Boxes",
          value: 0,
          description: "Ordered ingredients but no boxes — ratios may be skewed",
        });
      }
    }

    // Week-over-week spike detection (>3x previous week's cheese)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.cheese_ordered_oz > 0 && curr.cheese_ordered_oz > prev.cheese_ordered_oz * 3) {
        anomalies.push({
          type: "week_spike",
          severity: "warning",
          store_code: info.code,
          store_id: sid,
          week: curr.week_number,
          metric: "Cheese",
          value: curr.cheese_ordered_oz / prev.cheese_ordered_oz,
          description: `Cheese order ${(curr.cheese_ordered_oz / prev.cheese_ordered_oz).toFixed(1)}x previous week`,
        });
      }
    }
  }

  // Sort by severity then week
  const sevOrder = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || b.week - a.week);

  return anomalies;
}

/**
 * Get recent uploads.
 */
export async function getRecentUploads(limit = 5) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("uploads")
    .select("*, profiles(name)")
    .order("uploaded_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

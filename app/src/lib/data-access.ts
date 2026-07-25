/**
 * Server-side data access functions.
 * Used by page components to fetch data with proper RLS filtering.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { computeNetworkStats, computeBrandStats, severityScore, DEFAULT_DIFF_THRESHOLDS, ROLLING_WINDOW_WEEKS } from "@/lib/calculations";
import type { WeeklyMetrics, NetworkStats, BrandStats, WeeklyTrend, Brand, Anomaly } from "@/lib/types";
import { statusRank } from "@/lib/types";

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
  filters: Omit<MetricsFilters, "week"> = {},
  /**
   * Week the chart should END on. The selected week plus the previous
   * numWeeks-1 are plotted, so picking week 28 shows weeks 23-28 and picking 24
   * shows 18-24 (James, July 22 2026). Omit for the most recent weeks.
   */
  endWeek?: number
): Promise<WeeklyTrend[]> {
  const weeks = await getAvailableWeeks(filters.year); // descending
  // Drop anything after the chosen ending week, then take that week and the
  // numWeeks-1 before it.
  const upToEnd = endWeek ? weeks.filter((w) => w <= endWeek) : weeks;
  const recentWeeks = upToEnd.slice(0, numWeeks);

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

  // Sort by severity: worst tier first (Severe, then At Risk, then Borderline),
  // then within a tier by how far off the single worst metric is (severityScore)
  // -- NOT flag count. Flags use old flat thresholds that don't track the
  // %-based ones overall_status is actually graded on, so most stores tied and
  // the "top" of the list was close to arbitrary among ties (James, July 10-11
  // 2026).
  //
  // Ranks come from statusRank, not a local map. The local map here was
  // `{ bad: 0, warn: 1, ok: 2 }` with `?? 2`, which would have given the new
  // "severe" tier the same rank as "ok" and sorted the most urgent stores to
  // the BOTTOM of Stores Requiring Attention.
  const sorted = Array.from(byStore.values())
    .filter((m) => m.overall_status !== "ok")
    .sort((a, b) => {
      const byTier = statusRank(b.overall_status) - statusRank(a.overall_status);
      if (byTier !== 0) return byTier;

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
    // Sort by year THEN week — week_number alone interleaves 2025 and 2026,
    // which both mis-sorts the output and makes the rolling window below average
    // across unrelated years.
    const sorted = [...storeMetrics].sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.week_number - b.week_number
    );

    /**
     * Trailing rolling average of one field at position `i` — the same window
     * the compliance status is smoothed over, so the context number James asked
     * for lines up with how the store is actually graded.
     */
    const windowAvg = (i: number, field: "cheese_diff" | "sauce_diff"): { avg: number; weeks: number } => {
      const from = Math.max(0, i - (ROLLING_WINDOW_WEEKS - 1));
      const slice = sorted.slice(from, i + 1);
      const sum = slice.reduce((s, r) => s + ((r[field] as number) || 0), 0);
      return { avg: sum / slice.length, weeks: slice.length };
    };

    sorted.forEach((m, i) => {
      // Extreme diffs (>2x bad threshold)
      if (Math.abs(m.cheese_diff) > extremeThreshold) {
        const { avg, weeks } = windowAvg(i, "cheese_diff");
        anomalies.push({
          type: "extreme_diff",
          severity: "critical",
          store_code: info.code,
          store_id: sid,
          week: m.week_number,
          year: m.year,
          metric: "Cheese",
          value: m.cheese_diff,
          description: `Cheese diff of ${m.cheese_diff > 0 ? "+" : ""}${m.cheese_diff.toFixed(1)} cases (${m.cheese_diff > 0 ? "bulk order or event" : "possible shortage"})`,
          window_average: avg,
          window_weeks: weeks,
        });
      }
      if (Math.abs(m.sauce_diff) > extremeThreshold) {
        const { avg, weeks } = windowAvg(i, "sauce_diff");
        anomalies.push({
          type: "extreme_diff",
          severity: "critical",
          store_code: info.code,
          store_id: sid,
          week: m.week_number,
          year: m.year,
          metric: "Sauce",
          value: m.sauce_diff,
          description: `Sauce diff of ${m.sauce_diff > 0 ? "+" : ""}${m.sauce_diff.toFixed(1)} cases`,
          window_average: avg,
          window_weeks: weeks,
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
          year: m.year,
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
          year: m.year,
          metric: "Boxes",
          value: 0,
          description: "Ordered ingredients but no boxes — ratios may be skewed",
        });
      }
    });

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
          year: curr.year,
          metric: "Cheese",
          value: curr.cheese_ordered_oz / prev.cheese_ordered_oz,
          description: `Cheese order ${(curr.cheese_ordered_oz / prev.cheese_ordered_oz).toFixed(1)}x previous week`,
        });
      }
    }
  }

  // Chronological, newest first (James, July 22 2026 — was severity-then-week,
  // which interleaved a week-3 item between week 28 and week 27 and made the
  // list impossible to read as a timeline). Severity is still on each row as a
  // badge; it just no longer drives the order.
  anomalies.sort((a, b) => (a.year !== b.year ? b.year - a.year : b.week - a.week));

  return anomalies;
}

/**
 * Time ranges offered on the Secondary Products and Boxes tabs
 * (James, July 22 2026: "Filter to show quantities ordered in the Last Week,
 * Last 4 Weeks, or select a Quarter (total sum only)").
 */
export type ProductRange = "last_week" | "last_4_weeks" | "q1" | "q2" | "q3" | "q4";

/** Inclusive week bounds for a range, relative to an anchor week. */
export function rangeWeeks(range: ProductRange, anchorWeek: number): [number, number] {
  switch (range) {
    case "last_week":
      return [anchorWeek, anchorWeek];
    case "last_4_weeks":
      return [Math.max(1, anchorWeek - 3), anchorWeek];
    default: {
      const [lo, hi] = QUARTER_RANGES[range];
      return [lo, hi];
    }
  }
}

/**
 * Per-product order quantities for one store over a week range, summed per
 * product — the shape the Secondary Products and Boxes tabs display.
 *
 * NOTE ON COVERAGE: weekly_orders (per-SKU line items) only exists from 2026
 * week 16, when James started uploading through the app. The historical importer
 * writes weekly_metrics but never wrote weekly_orders, so earlier weeks — and the
 * whole of 2025 — have no line-item detail. That is why the year-over-year column
 * is empty for secondary products: there is no prior-year data to compare to,
 * only aggregate metrics. Box quantities avoid this entirely by coming from
 * weekly_metrics instead (see the Boxes tab), which does have full history.
 */
export async function getProductTotals(
  storeId: string,
  year: number,
  fromWeek: number,
  toWeek: number,
  classification: "secondary" | "primary"
): Promise<{ code: string; description: string; pack_size: string; quantity: number; weeks: number }[]> {
  const supabase = createAdminClient();

  const rows: Record<string, unknown>[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("weekly_orders")
      .select("quantity, week_number, products!inner(code, description, classification, pack_size)")
      .eq("store_id", storeId)
      .eq("year", year)
      .gte("week_number", fromWeek)
      .lte("week_number", toWeek)
      .eq("products.classification", classification)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("getProductTotals error:", error);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const byProduct = new Map<
    string,
    { code: string; description: string; pack_size: string; quantity: number; weeks: Set<number> }
  >();
  for (const r of rows) {
    const p = r.products as Record<string, unknown>;
    const code = String(p?.code ?? "—");
    const entry =
      byProduct.get(code) ??
      {
        code,
        description: String(p?.description ?? "—"),
        pack_size: String(p?.pack_size ?? ""),
        quantity: 0,
        weeks: new Set<number>(),
      };
    entry.quantity += (r.quantity as number) || 0;
    entry.weeks.add(r.week_number as number);
    byProduct.set(code, entry);
  }

  return [...byProduct.values()]
    .map((e) => ({ ...e, weeks: e.weeks.size }))
    .sort((a, b) => b.quantity - a.quantity);
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

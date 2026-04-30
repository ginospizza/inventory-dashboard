/**
 * Server-side data access functions.
 * Used by page components to fetch data with proper RLS filtering.
 */

import { createClient } from "@/lib/supabase/server";
import { computeNetworkStats, computeBrandStats, generateFlags } from "@/lib/calculations";
import type { WeeklyMetrics, NetworkStats, BrandStats, WeeklyTrend, Brand } from "@/lib/types";

interface MetricsFilters {
  week?: number;
  year?: number;
  brand?: string;
  dsm?: string;
  status?: string;
  storeId?: string;
}

/**
 * Fetch weekly metrics with joins to stores and DSMs.
 * RLS automatically filters by user role.
 */
export async function fetchMetrics(filters: MetricsFilters = {}) {
  const supabase = await createClient();
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
    query = query.eq("week_number", filters.week);
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

  const { data, error } = await query;

  if (error) {
    console.error("fetchMetrics error:", error);
    return [];
  }

  return (data ?? []) as (WeeklyMetrics & { stores: Record<string, unknown> })[];
}

/**
 * Get the latest week number that has data.
 */
export async function getLatestWeek(year?: number): Promise<number | null> {
  const supabase = await createClient();
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
 * Get all available weeks.
 */
export async function getAvailableWeeks(year?: number): Promise<number[]> {
  const supabase = await createClient();
  const y = year ?? new Date().getFullYear();

  const { data } = await supabase
    .from("weekly_metrics")
    .select("week_number")
    .eq("year", y)
    .order("week_number", { ascending: false });

  if (!data) return [];

  return [...new Set(data.map((d: { week_number: number }) => d.week_number))];
}

/**
 * Get all brands that have stores.
 */
export async function getAvailableBrands(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select("brand")
    .order("brand");

  if (!data) return [];
  return [...new Set(data.map((d: { brand: string }) => d.brand))];
}

/**
 * Get all DSMs.
 */
export async function getDsms(): Promise<{ id: string; name: string; region: string }[]> {
  const supabase = await createClient();
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
  const supabase = await createClient();
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
  numWeeks = 8,
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

  // Sort by severity: bad first, then warn, then by most flags
  const sorted = Array.from(byStore.values())
    .filter((m) => m.overall_status !== "ok")
    .sort((a, b) => {
      const statusOrder = { bad: 0, warn: 1, ok: 2 };
      const aOrder = statusOrder[a.overall_status as keyof typeof statusOrder] ?? 2;
      const bOrder = statusOrder[b.overall_status as keyof typeof statusOrder] ?? 2;
      if (aOrder !== bOrder) return aOrder - bOrder;

      const aFlags = generateFlags(a as unknown as WeeklyMetrics).length;
      const bFlags = generateFlags(b as unknown as WeeklyMetrics).length;
      return bFlags - aFlags;
    })
    .slice(0, limit);

  return sorted;
}

/**
 * Get recent uploads.
 */
export async function getRecentUploads(limit = 5) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uploads")
    .select("*, profiles(name)")
    .order("uploaded_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

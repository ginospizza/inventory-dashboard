import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getAvailableWeeks, getAvailableYears, getNetworkStats, fetchMetrics } from "@/lib/data-access";
import { computeNetworkStats } from "@/lib/calculations";
import type { WeeklyMetrics } from "@/lib/types";
import { CompareClient } from "./compare-client";

interface PageProps {
  searchParams: Promise<{
    yearA?: string;
    weekA?: string;
    yearB?: string;
    weekB?: string;
  }>;
}

export default async function ComparePage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const years = await getAvailableYears();

  // Default: latest two weeks of current year
  const currentYear = new Date().getFullYear();
  const currentWeeks = await getAvailableWeeks(currentYear);
  const defaultWeekA = currentWeeks[1] ?? currentWeeks[0] ?? 1; // second latest
  const defaultWeekB = currentWeeks[0] ?? 1; // latest

  const yearA = params.yearA ? Number(params.yearA) : currentYear;
  const weekA = params.weekA ? Number(params.weekA) : defaultWeekA;
  const yearB = params.yearB ? Number(params.yearB) : currentYear;
  const weekB = params.weekB ? Number(params.weekB) : defaultWeekB;

  // Fetch weeks for both selected years
  const [weeksForYearA, weeksForYearB] = await Promise.all([
    getAvailableWeeks(yearA),
    getAvailableWeeks(yearB),
  ]);

  // Fetch metrics for both periods
  const [metricsA, metricsB] = await Promise.all([
    fetchMetrics({ year: yearA, week: weekA }),
    fetchMetrics({ year: yearB, week: weekB }),
  ]);

  // Deduplicate by store
  const dedup = (metrics: typeof metricsA) => {
    const byStore = new Map<string, typeof metricsA[0]>();
    for (const m of metrics) {
      const existing = byStore.get(m.store_id);
      if (!existing || m.week_number > existing.week_number) byStore.set(m.store_id, m);
    }
    return Array.from(byStore.values());
  };

  const dedupA = dedup(metricsA);
  const dedupB = dedup(metricsB);

  const statsA = computeNetworkStats(dedupA as unknown as WeeklyMetrics[]);
  const statsB = computeNetworkStats(dedupB as unknown as WeeklyMetrics[]);

  // Per-store comparison: match stores across both periods
  const storeComparison: {
    store_code: string;
    store_id: string;
    brand: string;
    a: { cheese_diff: number; sauce_diff: number; sc_ratio: number; status: string } | null;
    b: { cheese_diff: number; sauce_diff: number; sc_ratio: number; status: string } | null;
  }[] = [];

  const allStoreIds = new Set([...dedupA.map(m => m.store_id), ...dedupB.map(m => m.store_id)]);
  const mapA = new Map(dedupA.map(m => [m.store_id, m]));
  const mapB = new Map(dedupB.map(m => [m.store_id, m]));

  for (const sid of allStoreIds) {
    const a = mapA.get(sid);
    const b = mapB.get(sid);
    const store = (a?.stores ?? b?.stores) as { code: string; brand: string } | undefined;
    if (!store) continue;

    storeComparison.push({
      store_code: store.code,
      store_id: sid,
      brand: store.brand,
      a: a ? { cheese_diff: a.cheese_diff, sauce_diff: a.sauce_diff, sc_ratio: a.sauce_cheese_ratio, status: a.overall_status } : null,
      b: b ? { cheese_diff: b.cheese_diff, sauce_diff: b.sauce_diff, sc_ratio: b.sauce_cheese_ratio, status: b.overall_status } : null,
    });
  }

  // Sort by biggest change in status (improved or worsened)
  const statusVal = (s: string) => s === "bad" ? 2 : s === "warn" ? 1 : 0;
  storeComparison.sort((a, b) => {
    const changeA = a.a && a.b ? Math.abs(statusVal(a.b.status) - statusVal(a.a.status)) : 0;
    const changeB = b.a && b.b ? Math.abs(statusVal(b.b.status) - statusVal(b.a.status)) : 0;
    return changeB - changeA;
  });

  return (
    <CompareClient
      years={years}
      weeksA={weeksForYearA}
      weeksB={weeksForYearB}
      yearA={yearA}
      weekA={weekA}
      yearB={yearB}
      weekB={weekB}
      statsA={statsA}
      statsB={statsB}
      storeComparison={storeComparison}
    />
  );
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getAvailableWeeks, getAvailableYears, getNetworkStats, fetchMetrics } from "@/lib/data-access";
import { computeNetworkStats } from "@/lib/calculations";
import type { WeeklyMetrics } from "@/lib/types";
import { statusRank } from "@/lib/types";
import { parsePeriod, summariseStores, availableQuarters } from "@/lib/compare-period";
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
  // A period is a week number or a quarter ("q1".."q4") — see lib/compare-period.
  const weekA = parsePeriod(params.weekA, defaultWeekA);
  const yearB = params.yearB ? Number(params.yearB) : currentYear;
  const weekB = parsePeriod(params.weekB, defaultWeekB);

  // Fetch weeks for both selected years
  const [weeksForYearA, weeksForYearB] = await Promise.all([
    getAvailableWeeks(yearA),
    getAvailableWeeks(yearB),
  ]);

  // DSM users only see their own stores
  const dsmFilter = user.role === "dsm" ? user.dsm_id ?? undefined : undefined;

  // Fetch metrics for both periods
  const [metricsA, metricsB] = await Promise.all([
    fetchMetrics({ year: yearA, week: weekA, dsm: dsmFilter }),
    fetchMetrics({ year: yearB, week: weekB, dsm: dsmFilter }),
  ]);

  // Network cards cover every store-week in the period: for a single week that
  // is one row per store, for a quarter it averages the whole quarter.
  const statsA = computeNetworkStats(metricsA as unknown as WeeklyMetrics[]);
  const statsB = computeNetworkStats(metricsB as unknown as WeeklyMetrics[]);

  // Per-store comparison: match stores across both periods
  const storeComparison: {
    store_code: string;
    store_id: string;
    brand: string;
    a: { cheese_diff: number; sauce_diff: number; sc_ratio: number; status: string } | null;
    b: { cheese_diff: number; sauce_diff: number; sc_ratio: number; status: string } | null;
  }[] = [];

  const mapA = summariseStores(metricsA);
  const mapB = summariseStores(metricsB);
  const storeInfo = new Map(
    [...metricsA, ...metricsB].map(m => [m.store_id, m.stores as unknown as { code: string; brand: string }])
  );
  const allStoreIds = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const sid of allStoreIds) {
    const a = mapA.get(sid);
    const b = mapB.get(sid);
    const store = storeInfo.get(sid);
    if (!store) continue;

    storeComparison.push({
      store_code: store.code,
      store_id: sid,
      brand: store.brand,
      a: a ?? null,
      b: b ?? null,
    });
  }

  // Sort by biggest change in status (improved or worsened)
  storeComparison.sort((a, b) => {
    const changeA = a.a && a.b ? Math.abs(statusRank(a.b.status) - statusRank(a.a.status)) : 0;
    const changeB = b.a && b.b ? Math.abs(statusRank(b.b.status) - statusRank(b.a.status)) : 0;
    return changeB - changeA;
  });

  return (
    <CompareClient
      years={years}
      weeksA={weeksForYearA}
      weeksB={weeksForYearB}
      quartersA={availableQuarters(weeksForYearA)}
      quartersB={availableQuarters(weeksForYearB)}
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

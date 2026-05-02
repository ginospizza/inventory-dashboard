import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import {
  getNetworkStats,
  getBrandStats,
  getWeeklyTrend,
  getAtRiskStores,
  getAvailableWeeks,
  getAvailableYears,
  getAvailableBrands,
  getDsms,
  getLatestWeek,
  getAnomalies,
} from "@/lib/data-access";
import { generateFlags } from "@/lib/calculations";
import type { WeeklyMetrics } from "@/lib/types";
import { OverviewClient } from "./overview-client";

interface PageProps {
  searchParams: Promise<{
    week?: string;
    year?: string;
    brand?: string;
    dsm?: string;
  }>;
}

export default async function OverviewPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const selectedYear = params.year ? Number(params.year) : new Date().getFullYear();
  const latestWeek = await getLatestWeek(selectedYear);

  // Support range filters: "all", "ytd", "q1"..."q4", or a number
  const weekParam = params.week;
  const isRange = weekParam && ["all", "ytd", "q1", "q2", "q3", "q4"].includes(weekParam);
  const week: number | string | undefined = isRange
    ? weekParam
    : weekParam
    ? Number(weekParam)
    : latestWeek ?? undefined;

  const filters = {
    week,
    year: selectedYear,
    brand: params.brand,
    dsm: params.dsm,
  };

  const [stats, brandStats, trend, atRisk, weeks, years, brands, dsms, anomalies] =
    await Promise.all([
      getNetworkStats(filters),
      getBrandStats(filters),
      getWeeklyTrend(8, { brand: params.brand, dsm: params.dsm, year: selectedYear }),
      getAtRiskStores(filters),
      getAvailableWeeks(selectedYear),
      getAvailableYears(),
      getAvailableBrands(),
      getDsms(),
      getAnomalies(filters),
    ]);

  // Enrich at-risk stores with flags
  const atRiskWithFlags = atRisk.map((m) => ({
    ...m,
    flags: generateFlags(m as unknown as WeeklyMetrics),
  }));

  return (
    <OverviewClient
      user={user}
      stats={stats}
      brandStats={brandStats}
      trend={trend}
      atRisk={atRiskWithFlags}
      weeks={weeks}
      years={years}
      brands={brands}
      dsms={dsms}
      currentWeek={typeof week === "number" ? week : null}
      currentYear={selectedYear}
      anomalies={anomalies}
    />
  );
}

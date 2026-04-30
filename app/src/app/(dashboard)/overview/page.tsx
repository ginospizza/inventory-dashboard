import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import {
  getNetworkStats,
  getBrandStats,
  getWeeklyTrend,
  getAtRiskStores,
  getAvailableWeeks,
  getAvailableBrands,
  getDsms,
  getLatestWeek,
} from "@/lib/data-access";
import { generateFlags } from "@/lib/calculations";
import type { WeeklyMetrics } from "@/lib/types";
import { OverviewClient } from "./overview-client";

interface PageProps {
  searchParams: Promise<{
    week?: string;
    brand?: string;
    dsm?: string;
  }>;
}

export default async function OverviewPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const latestWeek = await getLatestWeek();
  const week = params.week ? Number(params.week) : latestWeek ?? undefined;

  const filters = {
    week,
    brand: params.brand,
    dsm: params.dsm,
  };

  const [stats, brandStats, trend, atRisk, weeks, brands, dsms] =
    await Promise.all([
      getNetworkStats(filters),
      getBrandStats(filters),
      getWeeklyTrend(8, { brand: params.brand, dsm: params.dsm }),
      getAtRiskStores(filters),
      getAvailableWeeks(),
      getAvailableBrands(),
      getDsms(),
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
      brands={brands}
      dsms={dsms}
      currentWeek={week ?? null}
    />
  );
}

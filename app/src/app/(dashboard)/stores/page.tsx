import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import {
  fetchMetrics,
  getAvailableWeeks,
  getAvailableYears,
  getAvailableBrands,
  getDsms,
  getLatestWeek,
} from "@/lib/data-access";
import { generateFlags } from "@/lib/calculations";
import type { WeeklyMetrics } from "@/lib/types";
import { StoresClient } from "./stores-client";

interface PageProps {
  searchParams: Promise<{
    week?: string;
    year?: string;
    brand?: string;
    dsm?: string;
    status?: string;
  }>;
}

export default async function StoresPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const selectedYear = params.year ? Number(params.year) : new Date().getFullYear();
  const latestWeek = await getLatestWeek(selectedYear);
  const week = params.week ? Number(params.week) : latestWeek ?? undefined;

  const filters = {
    week,
    year: selectedYear,
    brand: params.brand,
    dsm: params.dsm,
  };

  const [metrics, weeks, years, brands, dsms] = await Promise.all([
    fetchMetrics(filters),
    getAvailableWeeks(selectedYear),
    getAvailableYears(),
    getAvailableBrands(),
    getDsms(),
  ]);

  // Deduplicate by store (take latest week)
  const byStore = new Map<string, typeof metrics[0]>();
  for (const m of metrics) {
    const existing = byStore.get(m.store_id);
    if (!existing || m.week_number > existing.week_number) {
      byStore.set(m.store_id, m);
    }
  }

  const storeMetrics = Array.from(byStore.values()).map((m) => ({
    ...m,
    flags: generateFlags(m as unknown as WeeklyMetrics),
  }));

  // Status counts
  const statusCounts = {
    all: storeMetrics.length,
    ok: storeMetrics.filter((m) => m.overall_status === "ok").length,
    warn: storeMetrics.filter((m) => m.overall_status === "warn").length,
    bad: storeMetrics.filter((m) => m.overall_status === "bad").length,
  };

  return (
    <StoresClient
      user={user}
      metrics={storeMetrics}
      weeks={weeks}
      years={years}
      brands={brands}
      dsms={dsms}
      statusCounts={statusCounts}
      statusFilter={params.status}
    />
  );
}

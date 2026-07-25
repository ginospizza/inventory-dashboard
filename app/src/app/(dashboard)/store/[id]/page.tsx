import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMetrics, getAnomalies } from "@/lib/data-access";
import { generateFlags } from "@/lib/calculations";
import type { WeeklyMetrics, Brand } from "@/lib/types";
import { StoreDetailClient } from "./store-detail-client";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string; year?: string }>;
}

/**
 * Resolve the dashboard's Period filter to the index of the week it anchors on,
 * within a newest-first series (James, July 22 2026: "Add the same date filters
 * on the dashboard to the store view").
 *
 * The filter picks WHICH week the page centres on; it deliberately does NOT
 * shrink the data the page keeps. The 6-week rolling average and the status
 * explanations need the weeks BEFORE the anchor, so filtering the series down
 * to a single week would leave the average with nothing to average and make the
 * explanation disagree with the stored status.
 */
function resolveAnchorIndex(
  sorted: { year: number; week_number: number }[],
  week: string | undefined,
  year: number
): number {
  if (!week || week === "" || week === "latest") return 0;

  const inYear = (m: { year: number }) => m.year === year;

  if (week === "all") return 0;
  if (week === "ytd") {
    const i = sorted.findIndex(inYear);
    return i === -1 ? 0 : i;
  }

  const QUARTERS: Record<string, [number, number]> = {
    q1: [1, 13], q2: [14, 26], q3: [27, 39], q4: [40, 52],
  };
  const quarter = QUARTERS[week];
  if (quarter) {
    const [lo, hi] = quarter;
    // Newest week inside the quarter.
    const i = sorted.findIndex(
      (m) => inYear(m) && m.week_number >= lo && m.week_number <= hi
    );
    return i === -1 ? 0 : i;
  }

  const n = Number(week);
  if (Number.isFinite(n)) {
    const i = sorted.findIndex((m) => inYear(m) && m.week_number === n);
    if (i !== -1) return i;
  }
  return 0;
}

const BRAND_COLORS: Record<string, string> = {
  GINOS: "#E2231A",
  TTD: "#0E5FAE",
  PP: "#7A2A2A",
  STORE: "#3D6644",
  DD: "#9C5B14",
  OTHER: "#7A7670",
};

export default async function StoreDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = createAdminClient();

  // Fetch store info
  const { data: store } = await supabase
    .from("stores")
    .select("*, dsms(id, name, region)")
    .eq("id", id)
    .single();

  if (!store) notFound();

  // DSM users can only view their assigned stores
  if (user.role === "dsm" && store.dsm_id !== user.dsm_id) {
    redirect("/stores");
  }

  // Fetch all metrics for this store (all weeks)
  const metrics = await fetchMetrics({ storeId: id });

  // Sort by week descending
  const sorted = [...metrics].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.week_number - a.week_number;
  });

  // The Period/Year filters choose which week the page centres on. The full
  // series still goes to the client so the 6-week average and the status
  // explanations keep the history they need.
  const selectedYear = query.year ? Number(query.year) : new Date().getFullYear();
  const anchorIndex = resolveAnchorIndex(sorted, query.week, selectedYear);

  const latest = sorted[anchorIndex] ?? null;
  const latestFlags = latest
    ? generateFlags(latest as unknown as WeeklyMetrics)
    : [];

  // Years and weeks available for this store, to populate the filter bar.
  const availableYears = [...new Set(sorted.map((m) => m.year))].sort((a, b) => b - a);
  const availableWeeks = sorted
    .filter((m) => m.year === selectedYear)
    .map((m) => m.week_number);

  // Get secondary product orders for the anchored week
  let secondaryOrders: Record<string, unknown>[] = [];
  if (latest) {
    const { data } = await supabase
      .from("weekly_orders")
      .select("*, products(code, description, classification, pack_size)")
      .eq("store_id", id)
      .eq("week_number", latest.week_number)
      .eq("year", latest.year);

    secondaryOrders = (data ?? []).filter(
      (o: Record<string, unknown>) =>
        (o.products as Record<string, unknown>)?.classification === "secondary"
    );
  }

  const brandColor = BRAND_COLORS[store.brand] ?? "#7A7670";

  // Get anomalies for this store
  const anomalies = await getAnomalies({}, id);

  return (
    <StoreDetailClient
      user={user}
      store={store}
      metrics={sorted as unknown as Record<string, unknown>[]}
      latest={latest as unknown as Record<string, unknown> | null}
      anchorIndex={anchorIndex}
      flags={latestFlags}
      secondaryOrders={secondaryOrders}
      brandColor={brandColor}
      anomalies={anomalies}
      years={availableYears}
      weeks={availableWeeks}
    />
  );
}

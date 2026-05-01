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
}

const BRAND_COLORS: Record<string, string> = {
  GINOS: "#E2231A",
  TTD: "#0E5FAE",
  PP: "#7A2A2A",
  STORE: "#3D6644",
  DD: "#9C5B14",
  OTHER: "#7A7670",
};

export default async function StoreDetailPage({ params }: PageProps) {
  const { id } = await params;
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

  // Fetch all metrics for this store (all weeks)
  const metrics = await fetchMetrics({ storeId: id });

  // Sort by week descending
  const sorted = [...metrics].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.week_number - a.week_number;
  });

  const latest = sorted[0] ?? null;
  const latestFlags = latest
    ? generateFlags(latest as unknown as WeeklyMetrics)
    : [];

  // Get secondary product orders for latest week
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
      flags={latestFlags}
      secondaryOrders={secondaryOrders}
      brandColor={brandColor}
      anomalies={anomalies}
    />
  );
}

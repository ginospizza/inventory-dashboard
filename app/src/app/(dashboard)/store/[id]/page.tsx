import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMetrics, getAnomalies, getProductTotals, rangeWeeks, type ProductRange } from "@/lib/data-access";
import { generateFlags } from "@/lib/calculations";
import type { WeeklyMetrics, Brand } from "@/lib/types";
import { StoreDetailClient } from "./store-detail-client";
import { hasAiAccess } from "@/lib/ai/access";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string; year?: string; range?: string }>;
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

/** Box sizes as James refers to them, in menu order. `boxes_*` on weekly_metrics
 *  hold individual boxes (cases × 40), except clamshells/plates which are already
 *  individual pieces. */
const BOX_SIZES = [
  { key: "boxes_small", label: 'Small (10")' },
  { key: "boxes_medium", label: 'Medium (12")' },
  { key: "boxes_large", label: 'Large (14")' },
  { key: "boxes_xl", label: 'X-Large (16")' },
  { key: "boxes_party", label: 'Party (20")' },
  { key: "boxes_party_21x15", label: "Party 21x15" },
  { key: "boxes_clamshell", label: "Clamshell / slice" },
  { key: "boxes_plates", label: "Paper plates" },
] as const;

type BoxKey = (typeof BOX_SIZES)[number]["key"];

/** Sum each box size across a set of store-weeks. */
function summariseBoxes(
  weeks: Pick<WeeklyMetrics, BoxKey>[]
): { label: string; quantity: number }[] {
  return BOX_SIZES.map(({ key, label }) => ({
    label,
    quantity: weeks.reduce((s, m) => s + (m[key] ?? 0), 0),
  }));
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

  // Flag HISTORY, not just the anchored week. The tab has always been called
  // "Flag History" but only ever showed one week's flags, which is why James
  // asking for "occurrence dates" made no sense against it — every row carried
  // the same implicit date. Collect flags across the whole series and stamp each
  // with the week it happened in (James, July 22 2026).
  const flagHistory = sorted.flatMap((m) =>
    generateFlags(m as unknown as WeeklyMetrics).map((f) => ({
      ...f,
      week: m.week_number,
      year: m.year,
    }))
  );

  // Years and weeks available for this store, to populate the filter bar.
  const availableYears = [...new Set(sorted.map((m) => m.year))].sort((a, b) => b - a);
  const availableWeeks = sorted
    .filter((m) => m.year === selectedYear)
    .map((m) => m.week_number);

  // Secondary Products over the selected range, plus the same period a year
  // earlier for the year-over-year column (James, July 22 2026).
  const productRange: ProductRange =
    (["last_week", "last_4_weeks", "q1", "q2", "q3", "q4"] as const).find(
      (r) => r === query.range
    ) ?? "last_week";

  const anchorWeek = latest?.week_number ?? 1;
  const anchorYear = latest?.year ?? selectedYear;
  const [fromWeek, toWeek] = rangeWeeks(productRange, anchorWeek);

  const [secondaryTotals, secondaryPriorYear] = latest
    ? await Promise.all([
        getProductTotals(id, anchorYear, fromWeek, toWeek, "secondary"),
        getProductTotals(id, anchorYear - 1, fromWeek, toWeek, "secondary"),
      ])
    : [[], []];

  // Box quantities come from weekly_metrics, NOT weekly_orders: metrics have the
  // full two-year history whereas line items start at 2026 week 16, so this is
  // the only source where the Boxes tab's year-over-year column can actually be
  // populated.
  const boxWeeksThis = sorted.filter(
    (m) => m.year === anchorYear && m.week_number >= fromWeek && m.week_number <= toWeek
  );
  const priorYearMetrics = await fetchMetrics({ storeId: id, year: anchorYear - 1 });
  const boxWeeksPrior = priorYearMetrics.filter(
    (m) => m.week_number >= fromWeek && m.week_number <= toWeek
  );

  const brandColor = BRAND_COLORS[store.brand] ?? "#7A7670";

  // Get anomalies for this store
  const anomalies = await getAnomalies({}, id);

  return (
    <StoreDetailClient
      user={user}
      aiEnabled={await hasAiAccess(user)}
      store={store}
      metrics={sorted as unknown as Record<string, unknown>[]}
      latest={latest as unknown as Record<string, unknown> | null}
      anchorIndex={anchorIndex}
      flags={flagHistory}
      secondaryTotals={secondaryTotals}
      secondaryPriorYear={secondaryPriorYear}
      boxTotals={summariseBoxes(boxWeeksThis)}
      boxTotalsPriorYear={summariseBoxes(boxWeeksPrior)}
      productRange={productRange}
      rangeLabel={`Wk ${fromWeek}${fromWeek === toWeek ? "" : `–${toWeek}`} ${anchorYear}`}
      priorRangeLabel={`Wk ${fromWeek}${fromWeek === toWeek ? "" : `–${toWeek}`} ${anchorYear - 1}`}
      brandColor={brandColor}
      anomalies={anomalies}
      years={availableYears}
      weeks={availableWeeks}
    />
  );
}

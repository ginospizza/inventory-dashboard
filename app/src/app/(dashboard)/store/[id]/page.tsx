import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMetrics, getAnomalies, getProductTotals, getProductsByClassification, rangeWeeks, type ProductRange } from "@/lib/data-access";
import { generateFlags, ROLLING_WINDOW_WEEKS, BOXES_PER_CASE } from "@/lib/calculations";
import { resolveWindow } from "@/lib/display-window";
import type { WeeklyMetrics, Brand } from "@/lib/types";
import { StoreDetailClient } from "./store-detail-client";
import { hasAiAccess } from "@/lib/ai/access";
import { getEngineConfig } from "@/lib/calculations/engine-config";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string; year?: string; range?: string }>;
}

/**
 * Box sizes as James refers to them, in menu order. `boxes_*` on weekly_metrics
 * hold individual boxes (cases × 40), except clamshells/plates which are
 * already individual pieces.
 *
 * Display units per James (Aug 4 2026): pizza boxes in BUNDLES — "a bundle is
 * a case for the boxes, 40 pieces per" — while clamshells and plates stay in
 * pieces. `divisor` converts the stored individual-box counts.
 */
const BOX_SIZES = [
  { key: "boxes_small", label: 'Small (10")', divisor: BOXES_PER_CASE, unit: "bd" },
  { key: "boxes_medium", label: 'Medium (12")', divisor: BOXES_PER_CASE, unit: "bd" },
  { key: "boxes_large", label: 'Large (14")', divisor: BOXES_PER_CASE, unit: "bd" },
  { key: "boxes_xl", label: 'X-Large (16")', divisor: BOXES_PER_CASE, unit: "bd" },
  { key: "boxes_party", label: 'Party (20")', divisor: BOXES_PER_CASE, unit: "bd" },
  { key: "boxes_party_21x15", label: "Party 21x15", divisor: BOXES_PER_CASE, unit: "bd" },
  { key: "boxes_clamshell", label: "Clamshell / slice", divisor: 1, unit: "pc" },
  { key: "boxes_plates", label: "Paper plates", divisor: 1, unit: "pc" },
] as const;

type BoxKey = (typeof BOX_SIZES)[number]["key"];

/**
 * Sum each box size across a set of store-weeks, in DISPLAY units (bundles for
 * pizza sizes, pieces for clamshell/plates). Year-over-year percentages are
 * unaffected: both years divide by the same divisor.
 */
function summariseBoxes(
  weeks: Pick<WeeklyMetrics, BoxKey>[]
): { label: string; quantity: number; unit: string }[] {
  return BOX_SIZES.map(({ key, label, divisor, unit }) => ({
    label,
    quantity: weeks.reduce((s, m) => s + (m[key] ?? 0), 0) / divisor,
    unit,
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

  // The Year selector was previously inert: fetchMetrics defaults its year
  // filter to the CURRENT year, so selecting 2025 fetched 2026 data and the
  // window resolution silently fell back to the newest week. Fetch the year
  // the user actually chose. (One year at a time keeps the series semantics
  // identical to the upload-time recompute, which is also per-year.)
  const selectedYear = query.year ? Number(query.year) : new Date().getFullYear();
  const metrics = await fetchMetrics({ storeId: id, year: selectedYear });

  // Sort by week descending
  const sorted = [...metrics].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.week_number - a.week_number;
  });

  // The Period/Year filters choose the display WINDOW: a 6-week window anchored
  // on an individual week, or the whole period for Q1..Q4 / YTD / All (James,
  // July 31 2026). The full series still goes to the client so the status
  // explanations keep the history they need.
  const window = resolveWindow(sorted, query.week, selectedYear, ROLLING_WINDOW_WEEKS);
  const anchorIndex = window.start;

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

  const [orderedSecondaries, secondaryPriorYear, allSecondaries] = latest
    ? await Promise.all([
        getProductTotals(id, anchorYear, fromWeek, toWeek, "secondary"),
        getProductTotals(id, anchorYear - 1, fromWeek, toWeek, "secondary"),
        getProductsByClassification("secondary"),
      ])
    : [[], [], []];

  // Every secondary product appears, ordered or not (James, July 31 2026):
  // left-merge the catalog into the ordered totals, zero-filling the gaps.
  // Ordered products first (qty desc, as before), then the zero rows A-Z.
  const orderedByCode = new Map(orderedSecondaries.map((p) => [p.code, p]));
  const secondaryTotals = [
    ...orderedSecondaries,
    ...allSecondaries
      .filter((p) => !orderedByCode.has(p.code))
      .map((p) => ({ ...p, quantity: 0, weeks: 0 })),
  ];

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

  // Ingredients tab (James, July 31 2026): cheese/sauce/flour ordered over the
  // same range, with the same YoY — sourced from weekly_metrics like Boxes, so
  // both years are covered. Raw units here; the client converts to cases/bags
  // with its per-store derived case sizes so this tab ties out with the tiles.
  const sumIngredients = (weeks: typeof sorted) => ({
    cheese_oz: weeks.reduce((s, m) => s + (m.cheese_ordered_oz || 0), 0),
    sauce_floz: weeks.reduce((s, m) => s + (m.sauce_ordered_floz || 0), 0),
    flour_kg: weeks.reduce((s, m) => s + (m.flour_ordered_kg || 0), 0),
    dough_kg: weeks.reduce((s, m) => s + (m.dough_ordered_kg || 0), 0),
  });
  const ingredientTotals = sumIngredients(boxWeeksThis);
  const ingredientTotalsPriorYear = sumIngredients(boxWeeksPrior);

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
      engineConfig={getEngineConfig()}
      windowCount={window.count}
      windowLabel={window.label}
      flags={flagHistory}
      secondaryTotals={secondaryTotals}
      secondaryPriorYear={secondaryPriorYear}
      ingredientTotals={ingredientTotals}
      ingredientTotalsPriorYear={ingredientTotalsPriorYear}
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

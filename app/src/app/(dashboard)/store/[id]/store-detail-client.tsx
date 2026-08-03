"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronDown, Sparkles, RefreshCw, Flag as FlagIcon } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import { StatusPill, DiffCell, RatioCell, FilterBar } from "@/components/dashboard";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import type { AppUser, Flag, ComplianceStatus, Anomaly } from "@/lib/types";
import { brandLabel, statusRank, statusColor } from "@/lib/types";
import { signedPct } from "@/lib/ai/prompts";
import { weekWithDate, weekMondayLabel } from "@/lib/weeks";
import {
  ROLLING_WINDOW_WEEKS,
  SAUCE_CASE_FLOZ,
  FLOUR_BAG_KG,
  KG_TO_OZ,
} from "@/lib/calculations/constants";
import { explainStatus, type StatusExplanation, type RollingWeek } from "@/lib/calculations/engine";
import { setEngineConfig, type EngineConfig } from "@/lib/calculations/engine-config";

interface StoreDetailClientProps {
  user: AppUser;
  /** Whether THIS user may use AI Insights (super admins always; DSMs per
   *  ai_config). Computed server-side; the /api/ai route enforces it too. */
  aiEnabled: boolean;
  store: Record<string, unknown>;
  metrics: Record<string, unknown>[];
  latest: Record<string, unknown> | null;
  /** Index in `metrics` (newest-first) that the Period filter anchors on. */
  anchorIndex: number;
  /** The server's active engine config — thresholds are DB-editable now, so
   *  client-side status explanations must grade with the SAME numbers the
   *  server graded with, not the compiled-in constants. */
  engineConfig: EngineConfig;
  /** Rows in the display window: the 6-week rolling window for an individual
   *  week, or the whole period for Q1..Q4 / YTD / All (James, July 31 2026). */
  windowCount: number;
  /** Label for the window's average, e.g. "6-wk avg" or "Q2 avg · 13 wks". */
  windowLabel: string;
  flags: Flag[];
  secondaryTotals: { code: string; description: string; pack_size: string; quantity: number; weeks: number }[];
  secondaryPriorYear: { code: string; description: string; pack_size: string; quantity: number; weeks: number }[];
  /** Raw-unit sums over the selected range; converted to cases/bags client-side
   *  with the same derived case sizes the tiles use. */
  ingredientTotals: { cheese_oz: number; sauce_floz: number; flour_kg: number; dough_kg: number };
  ingredientTotalsPriorYear: { cheese_oz: number; sauce_floz: number; flour_kg: number; dough_kg: number };
  boxTotals: { label: string; quantity: number }[];
  boxTotalsPriorYear: { label: string; quantity: number }[];
  productRange: string;
  rangeLabel: string;
  priorRangeLabel: string;
  brandColor: string;
  anomalies: Anomaly[];
  years: number[];
  weeks: number[];
}

export function StoreDetailClient({
  user,
  aiEnabled,
  store,
  metrics,
  latest,
  anchorIndex,
  engineConfig,
  windowCount,
  windowLabel,
  flags,
  secondaryTotals,
  secondaryPriorYear,
  ingredientTotals,
  ingredientTotalsPriorYear,
  boxTotals,
  boxTotalsPriorYear,
  productRange,
  rangeLabel,
  priorRangeLabel,
  brandColor,
  anomalies,
  years,
  weeks,
}: StoreDetailClientProps) {
  const [activeTab, setActiveTab] = useState<"primary" | "secondary" | "ingredients" | "boxes" | "trends" | "flags" | "compare">("primary");
  const [aiLoading, setAiLoading] = useState(false);
  // Summary + recommendation are always shown; details (the full diagnostic
  // reasoning) stays collapsed by default -- DSMs manage 30+ stores and skim
  // this per store, they shouldn't have to read a full write-up for each one
  // (James, July 11 2026).
  const [aiInsight, setAiInsight] = useState<{ summary: string; recommendation: string; details: string } | null>(null);
  const [showAiDetails, setShowAiDetails] = useState(false);
  // Which week's status explanation is expanded in the Compare tab, keyed
  // "year-week" (null = none).
  const [openExplanation, setOpenExplanation] = useState<string | null>(null);

  // Activate the server's config for this render before explainStatus runs.
  setEngineConfig(engineConfig);

  const storeCode = store.code as string;
  const storeCity = store.city as string;
  const storeBrand = brandLabel(store.brand as string);
  const dsm = store.dsms as { name: string; region: string } | null;

  // The display window: 6 rolling weeks for an individual Period selection, or
  // the whole period for Q1..Q4 / YTD / All (James, July 31 2026). Everything
  // on the page — tiles, table rows, averages, trends — derives from this, so
  // the Period filter moves the whole page together. Compliance STATUS stays on
  // the engine's fixed 6-week window regardless (see explanationFor).
  const recentWeeks = metrics.slice(anchorIndex, anchorIndex + windowCount);
  const trendData = [...recentWeeks].reverse();

  // Ord / "Usage based on Boxes" display in cases and bags rather than raw
  // oz / fl oz / kg (James, July 22 2026). Sauce and flour are fixed
  // conversions; cheese's and sauce's case sizes vary by store, see deriveCaseSize.
  const cheeseCaseOz = deriveCaseSize(
    metrics, "cheese_ordered_oz", "cheese_estimated_oz", "cheese_diff", 10 * KG_TO_OZ
  );
  const sauceCaseFlozValue = deriveCaseSize(
    metrics, "sauce_ordered_floz", "sauce_estimated_floz", "sauce_diff", SAUCE_CASE_FLOZ
  );
  const toCheeseCases = (oz: number) => (cheeseCaseOz > 0 ? oz / cheeseCaseOz : 0);
  const toSauceCases = (floz: number) => (sauceCaseFlozValue > 0 ? floz / sauceCaseFlozValue : 0);
  const toFlourBags = (kg: number) => kg / FLOUR_BAG_KG;

  // Window average, shown above the current week for every metric (James,
  // July 22 2026). For an individual week this is the same 6-week window the
  // compliance status is smoothed across; for a range period it is the whole
  // period's average (July 31 2026).
  const avgOf = (key: string) =>
    recentWeeks.length === 0
      ? 0
      : recentWeeks.reduce((s, m) => s + (((m[key] as number) ?? 0) || 0), 0) / recentWeeks.length;

  /**
   * Status explanation for the metrics row at `index` (the Compare tab is
   * newest-first, so the rolling window is the entries AFTER it in the array).
   *
   * Built from the same window the engine grades on, so the sentence can never
   * disagree with the pill it sits under.
   */
  const explanationFor = (index: number): StatusExplanation | null => {
    const row = metrics[index];
    if (!row) return null;
    const toRolling = (m: Record<string, unknown>): RollingWeek => ({
      cheese_ordered_oz: (m.cheese_ordered_oz as number) ?? 0,
      sauce_ordered_floz: (m.sauce_ordered_floz as number) ?? 0,
      flour_ordered_kg: (m.flour_ordered_kg as number) ?? 0,
      dough_ordered_kg: (m.dough_ordered_kg as number) ?? 0,
      cheese_estimated_oz: (m.cheese_estimated_oz as number) ?? 0,
      sauce_estimated_floz: (m.sauce_estimated_floz as number) ?? 0,
      flour_estimated_kg: (m.flour_estimated_kg as number) ?? 0,
      dough_estimated_kg: (m.dough_estimated_kg as number) ?? 0,
    });
    // metrics is newest-first: the weeks preceding this one are at higher indices.
    const prior = metrics
      .slice(index + 1, index + 1 + ROLLING_WINDOW_WEEKS - 1)
      .map(toRolling);
    return explainStatus(
      toRolling(row),
      prior,
      (row.store_type as string) === "dough" ? "dough" : "flour"
    );
  };

  const movingAvg = {
    weeks: recentWeeks.length,
    cheeseOrd: toCheeseCases(avgOf("cheese_ordered_oz")),
    cheeseEst: toCheeseCases(avgOf("cheese_estimated_oz")),
    cheeseDiff: avgOf("cheese_diff"),
    sauceOrd: toSauceCases(avgOf("sauce_ordered_floz")),
    sauceEst: toSauceCases(avgOf("sauce_estimated_floz")),
    sauceDiff: avgOf("sauce_diff"),
    flourOrd: toFlourBags(avgOf("flour_ordered_kg")),
    flourEst: toFlourBags(avgOf("flour_estimated_kg")),
    flourDiff: avgOf("flour_diff"),
    sc: avgOf("sauce_cheese_ratio"),
    fc: avgOf("flour_cheese_ratio"),
  };

  async function handleAiInsight() {
    setAiLoading(true);
    setShowAiDetails(false);
    try {
      // Send recent weekly history (oldest → newest) so the AI can spot
      // sustained vs. episodic ("testing the waters") patterns, not just one week.
      // Attach the signed % vs box-expected for each ingredient, computed the
      // same way the dashboard does, so the AI uses it directly instead of
      // trying to back a percentage out of raw case counts (which it gets wrong).
      const withPct = (m: Record<string, unknown>) => ({
        cheese_pct: signedPct(m.cheese_ordered_oz, m.cheese_estimated_oz),
        sauce_pct: signedPct(m.sauce_ordered_floz, m.sauce_estimated_floz),
        flour_pct:
          m.store_type === "dough"
            ? signedPct(m.dough_ordered_kg, m.dough_estimated_kg)
            : signedPct(m.flour_ordered_kg, m.flour_estimated_kg),
      });
      const history = [...metrics]
        .slice(0, 12)
        .reverse()
        .map((m) => ({
          week: m.week_number,
          cheese_diff: m.cheese_diff,
          sauce_diff: m.sauce_diff,
          flour_diff: m.flour_diff,
          ...withPct(m),
          // Estimated usage is box-derived — carried so the AI can see a
          // box-order collapse (estimate cliff) as a boxes signal, not read
          // it as an ingredient spike.
          cheese_est: m.cheese_estimated_oz,
          sauce_est: m.sauce_estimated_floz,
          flour_est: m.store_type === "dough" ? m.dough_estimated_kg : m.flour_estimated_kg,
          sc_ratio: m.sauce_cheese_ratio,
          fc_ratio: m.flour_cheese_ratio,
          status: m.overall_status,
        }));
      const latestWithPct = latest ? { ...latest, ...withPct(latest) } : latest;
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: "store", context: { store: storeCode, latest: latestWithPct, history } }),
      });
      const data = await res.json();
      setAiInsight({
        summary: data.summary ?? "No insights available.",
        recommendation: data.recommendation ?? "",
        details: data.details ?? "",
      });
    } catch {
      setAiInsight({ summary: "Failed to generate insight.", recommendation: "", details: "" });
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div>
      {/* Breadcrumb & header */}
      <Link
        href="/stores"
        className="inline-flex items-center gap-1 text-[12.5px] mb-4 hover:underline"
        style={{ color: "var(--color-ink-3)" }}
      >
        <ChevronLeft className="w-4 h-4" />
        All Stores
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-5 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span
              className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold tracking-[.06em] uppercase text-white"
              style={{ background: brandColor }}
            >
              {storeBrand}
            </span>
            <div className="w-full h-[6px] rounded-full max-w-[60px]" style={{ background: brandColor }} />
          </div>
          <h1 className="font-serif text-[28px] lg:text-[38px] leading-none" style={{ letterSpacing: "-0.015em" }}>
            {storeCode}
            {storeCity && (
              <span className="text-[16px] lg:text-[20px] ml-2 lg:ml-3" style={{ color: "var(--color-ink-3)" }}>
                {storeCity}
              </span>
            )}
          </h1>
          <div className="flex items-center gap-4 mt-2 text-[12.5px]" style={{ color: "var(--color-ink-3)" }}>
            {dsm && <span>DSM: {dsm.name}{dsm.region ? ` · ${dsm.region}` : ""}</span>}
            {latest && <span>Week {latest.week_number as number}</span>}
            {latest && <StatusPill status={latest.overall_status as ComplianceStatus} />}
          </div>
        </div>

        {/* Per-user: super admins always, DSMs per ai_config (James + Raj,
            July 31 2026). /api/ai enforces the same rule server-side. */}
        {aiEnabled && (
          <button
            onClick={handleAiInsight}
            className="flex items-center gap-[7px] px-[14px] py-2 rounded-[9px] text-white text-[13px] font-medium"
            style={{
              background: "var(--color-ginos-red)",
              boxShadow: "0 4px 14px rgba(226,35,26,.25), inset 0 1px 0 rgba(255,255,255,.18)",
            }}
          >
            <Sparkles className="w-4 h-4" />
            AI Insights
          </button>
        )}
      </div>

      {/* Date filters — the dashboard's Year + Period selectors, carried over to
          the store view (James, July 22 2026). Brand and DSM are omitted: a
          single store has exactly one of each, so they'd be inert. */}
      <FilterBar
        user={user}
        weeks={weeks}
        years={years}
        brands={[]}
        dsms={[]}
        showBrandFilter={false}
        showDsmFilter={false}
      />

      {/* AI insight panel */}
      {aiEnabled && (aiLoading || aiInsight) && (
        <div
          className="rounded-[14px] p-[18px] mb-5"
          style={{
            background: "radial-gradient(ellipse at top right, rgba(226,35,26,.06), transparent 60%), linear-gradient(180deg, #FFFDF8, #FBF6EC)",
            border: "1px solid var(--color-line)",
          }}
        >
          {aiLoading ? (
            <div className="flex flex-col gap-3">
              <div className="h-4 w-3/4 rounded animate-shimmer" />
              <div className="h-4 w-full rounded animate-shimmer" />
              <div className="h-4 w-2/3 rounded animate-shimmer" />
            </div>
          ) : aiInsight ? (
            <>
              <h4 className="font-serif text-[20px] mb-2">Store Analysis</h4>
              <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: "var(--color-ink-2)" }}>
                {aiInsight.summary}
              </p>
              {aiInsight.recommendation && (
                <p className="text-[13px] leading-relaxed whitespace-pre-line mt-3 font-medium" style={{ color: "var(--color-ink)" }}>
                  {aiInsight.recommendation}
                </p>
              )}
              {aiInsight.details && (
                <>
                  <button
                    onClick={() => setShowAiDetails((v) => !v)}
                    className="mt-3 text-[12px] font-medium underline"
                    style={{ color: "var(--color-ink-3)" }}
                  >
                    {showAiDetails ? "Hide full analysis" : "Show full analysis"}
                  </button>
                  {showAiDetails && (
                    <p className="text-[13px] leading-relaxed whitespace-pre-line mt-2 pt-2" style={{ color: "var(--color-ink-2)", borderTop: "1px solid var(--color-line)" }}>
                      {aiInsight.details}
                    </p>
                  )}
                </>
              )}
              <button onClick={handleAiInsight} className="flex items-center gap-1 mt-3 text-[12px]" style={{ color: "var(--color-ink-3)" }}>
                <RefreshCw className="w-3 h-3" /> Regenerate
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* KPI strip */}
      {latest && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-[14px] mb-6">
          <KpiStrip label="Cheese" ordered={toCheeseCases(latest.cheese_ordered_oz as number)} estimated={toCheeseCases(latest.cheese_estimated_oz as number)} diff={latest.cheese_diff as number} unit="cs" avgOrdered={movingAvg.cheeseOrd} avgWeeks={movingAvg.weeks} avgLabel={windowLabel} />
          <KpiStrip label="Sauce" ordered={toSauceCases(latest.sauce_ordered_floz as number)} estimated={toSauceCases(latest.sauce_estimated_floz as number)} diff={latest.sauce_diff as number} unit="cs" avgOrdered={movingAvg.sauceOrd} avgWeeks={movingAvg.weeks} avgLabel={windowLabel} />
          <KpiStrip label="Flour" ordered={toFlourBags(latest.flour_ordered_kg as number)} estimated={toFlourBags(latest.flour_estimated_kg as number)} diff={latest.flour_diff as number} unit="bg" avgOrdered={movingAvg.flourOrd} avgWeeks={movingAvg.weeks} avgLabel={windowLabel} />
          <RatioKpi label="Sauce:Cheese" value={latest.sauce_cheese_ratio as number} status={latest.sauce_cheese_status as ComplianceStatus} avgValue={movingAvg.sc} avgWeeks={movingAvg.weeks} avgLabel={windowLabel} />
          <RatioKpi label="Flour:Cheese" value={latest.flour_cheese_ratio as number} status={latest.flour_cheese_status as ComplianceStatus} avgValue={movingAvg.fc} avgWeeks={movingAvg.weeks} avgLabel={windowLabel} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-[3px] rounded-lg" style={{ background: "var(--color-crust)", display: "inline-flex" }}>
        {([
          { key: "primary", label: "Primary Products" },
          { key: "secondary", label: "Secondary Products" },
          // Boxes: James, July 22 2026. Ingredients: July 31 2026 — cheese/
          // sauce/flour cases ordered, same date filters and year over year.
          { key: "ingredients", label: "Ingredients" },
          { key: "boxes", label: "Boxes" },
          { key: "trends", label: "Trends" },
          { key: "compare", label: "Compare" },
          { key: "flags", label: `Flag History (${flags.length})` },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-[7px] rounded-[6px] text-[12.5px] font-medium transition-all"
            style={{
              background: activeTab === tab.key ? "white" : "transparent",
              color: activeTab === tab.key ? "var(--color-ink)" : "var(--color-ink-2)",
              boxShadow: activeTab === tab.key ? "var(--shadow-sm)" : "none",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-[14px] bg-white overflow-hidden" style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}>
        {activeTab === "primary" && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  {/* James, July 22 2026: "Est" renamed to "Usage based on Boxes",
                      the delta symbol spelled out as "Difference", and the ratio
                      columns given their full names. */}
                  {[
                    "Week",
                    "Cheese Ord", "Cheese Usage based on Boxes", "Cheese Difference",
                    "Sauce Ord", "Sauce Usage based on Boxes", "Sauce Difference",
                    "Flour Ord", "Flour Usage based on Boxes", "Flour Difference",
                    "Sauce:Cheese", "Flour:Cheese",
                  ].map((h) => (
                    <th key={h} className="font-semibold text-[11px] tracking-[.06em] uppercase px-3 py-[10px] align-bottom" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)", background: "var(--color-paper)", textAlign: h === "Week" ? "left" : "right", minWidth: h.includes("Usage") ? "104px" : undefined }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Window average, above the weekly rows (James, July 22 2026;
                    July 31: for range periods this is the average of the WHOLE
                    period, not the last 6 weeks of it). Tinted and labelled so
                    it reads as a summary line rather than another week. */}
                {movingAvg.weeks > 0 && (
                  <tr style={{ background: "var(--color-paper)" }}>
                    <td className="px-3 py-[10px] font-semibold text-[11px] tracking-[.04em] uppercase whitespace-nowrap" style={{ borderBottom: "2px solid var(--color-line-2)", color: "var(--color-ink-2)" }}>
                      {windowLabel}
                    </td>
                    {[
                      unitFmt(movingAvg.cheeseOrd, "cs"),
                      unitFmt(movingAvg.cheeseEst, "cs"),
                      null,
                      unitFmt(movingAvg.sauceOrd, "cs"),
                      unitFmt(movingAvg.sauceEst, "cs"),
                      null,
                      unitFmt(movingAvg.flourOrd, "bg"),
                      unitFmt(movingAvg.flourEst, "bg"),
                      null,
                    ].map((val, i) =>
                      val === null ? (
                        <td key={i} className="px-3 py-[10px] text-right" style={{ borderBottom: "2px solid var(--color-line-2)" }}>
                          <DiffCell
                            value={i === 2 ? movingAvg.cheeseDiff : i === 5 ? movingAvg.sauceDiff : movingAvg.flourDiff}
                            unit={i === 8 ? "bg" : "cs"}
                          />
                        </td>
                      ) : (
                        <td key={i} className="px-3 py-[10px] text-right font-mono text-[12px] font-medium" style={{ borderBottom: "2px solid var(--color-line-2)", color: "var(--color-ink-2)" }}>
                          {val}
                        </td>
                      )
                    )}
                    <td className="px-3 py-[10px] text-right" style={{ borderBottom: "2px solid var(--color-line-2)" }}><RatioCell value={movingAvg.sc} /></td>
                    <td className="px-3 py-[10px] text-right" style={{ borderBottom: "2px solid var(--color-line-2)" }}><RatioCell value={movingAvg.fc} /></td>
                  </tr>
                )}
                {recentWeeks.map((m) => (
                  <tr key={`${m.year}-${m.week_number}`} className="hover:bg-[rgba(244,236,221,.4)]">
                    <td className="px-3 py-[10px] font-medium" style={{ borderBottom: "1px solid var(--color-line)" }}>W{m.week_number as number}</td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)" }}>{unitFmt(toCheeseCases(m.cheese_ordered_oz as number), "cs")}</td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-3)" }}>{unitFmt(toCheeseCases(m.cheese_estimated_oz as number), "cs")}</td>
                    <td className="px-3 py-[10px] text-right" style={{ borderBottom: "1px solid var(--color-line)" }}><DiffCell value={m.cheese_diff as number} /></td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)" }}>{unitFmt(toSauceCases(m.sauce_ordered_floz as number), "cs")}</td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-3)" }}>{unitFmt(toSauceCases(m.sauce_estimated_floz as number), "cs")}</td>
                    <td className="px-3 py-[10px] text-right" style={{ borderBottom: "1px solid var(--color-line)" }}><DiffCell value={m.sauce_diff as number} /></td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)" }}>{unitFmt(toFlourBags(m.flour_ordered_kg as number), "bg")}</td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-3)" }}>{unitFmt(toFlourBags(m.flour_estimated_kg as number), "bg")}</td>
                    <td className="px-3 py-[10px] text-right" style={{ borderBottom: "1px solid var(--color-line)" }}><DiffCell value={m.flour_diff as number} unit="bg" /></td>
                    <td className="px-3 py-[10px] text-right" style={{ borderBottom: "1px solid var(--color-line)" }}><RatioCell value={m.sauce_cheese_ratio as number} /></td>
                    <td className="px-3 py-[10px] text-right" style={{ borderBottom: "1px solid var(--color-line)" }}><RatioCell value={m.flour_cheese_ratio as number} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "secondary" && (
          <div className="p-[18px]">
            <RangePicker current={productRange} />
            {secondaryTotals.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <Th>Product</Th>
                      <Th align="right">{rangeLabel}</Th>
                      <Th align="right">{priorRangeLabel}</Th>
                      <Th align="right">Year over Year</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {secondaryTotals.map((p) => {
                      const prior = secondaryPriorYear.find((q) => q.code === p.code);
                      return (
                        <tr key={p.code} className="hover:bg-[rgba(244,236,221,.4)]">
                          <td className="px-3 py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                            <span className="font-medium">{p.description}</span>
                            <span className="text-[11px] ml-2" style={{ color: "var(--color-ink-3)" }}>{p.pack_size}</span>
                          </td>
                          <td className="px-3 py-[10px] text-right font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>
                            {p.quantity.toFixed(0)}
                          </td>
                          <PriorAndYoY current={p.quantity} prior={prior?.quantity} />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {secondaryPriorYear.length === 0 && <NoPriorYearNote />}
              </div>
            ) : (
              <p className="text-center py-8 text-[13px]" style={{ color: "var(--color-ink-3)" }}>
                No secondary product data for {rangeLabel}
              </p>
            )}
          </div>
        )}

        {/* Ingredients — cheese/sauce/flour ordered over the selected range, in
            cases/bags, with year over year (James, July 31 2026). Sourced from
            weekly_metrics like Boxes so both years are covered; converted with
            the same per-store case sizes as the tiles so the numbers tie out. */}
        {activeTab === "ingredients" && (
          <div className="p-[18px]">
            <RangePicker current={productRange} />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <Th>Ingredient</Th>
                    <Th align="right">{rangeLabel}</Th>
                    <Th align="right">{priorRangeLabel}</Th>
                    <Th align="right">Year over Year</Th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const isDough = (store.store_type ?? latest?.store_type) === "dough";
                    const rows = [
                      {
                        label: "Cheese",
                        unit: "cs",
                        current: toCheeseCases(ingredientTotals.cheese_oz),
                        prior: toCheeseCases(ingredientTotalsPriorYear.cheese_oz),
                      },
                      {
                        label: "Sauce",
                        unit: "cs",
                        current: toSauceCases(ingredientTotals.sauce_floz),
                        prior: toSauceCases(ingredientTotalsPriorYear.sauce_floz),
                      },
                      isDough
                        ? {
                            label: "Dough",
                            unit: "kg",
                            current: ingredientTotals.dough_kg,
                            prior: ingredientTotalsPriorYear.dough_kg,
                          }
                        : {
                            label: "Flour",
                            unit: "bg",
                            current: toFlourBags(ingredientTotals.flour_kg),
                            prior: toFlourBags(ingredientTotalsPriorYear.flour_kg),
                          },
                    ];
                    return rows.map((r) => (
                      <tr key={r.label} className="hover:bg-[rgba(244,236,221,.4)]">
                        <td className="px-3 py-[10px] font-medium" style={{ borderBottom: "1px solid var(--color-line)" }}>
                          {r.label}
                          <span className="text-[11px] ml-2" style={{ color: "var(--color-ink-3)" }}>
                            {r.unit === "cs" ? "cases" : r.unit === "bg" ? "bags" : "kg"}
                          </span>
                        </td>
                        <td className="px-3 py-[10px] text-right font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>
                          {unitFmt(r.current, r.unit)}
                        </td>
                        <PriorAndYoY current={r.current} prior={r.prior > 0 ? r.prior : undefined} decimals={1} />
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Boxes — the quantities every ingredient estimate is derived from.
            Sourced from weekly_metrics rather than the per-SKU weekly_orders,
            because metrics carry the full two-year history while line items only
            start at 2026 week 16 — so this is the one place the year-over-year
            column can actually be populated (James, July 22 2026). */}
        {activeTab === "boxes" && (
          <div className="p-[18px]">
            <RangePicker current={productRange} />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <Th>Box size</Th>
                    <Th align="right">{rangeLabel}</Th>
                    <Th align="right">{priorRangeLabel}</Th>
                    <Th align="right">Year over Year</Th>
                  </tr>
                </thead>
                <tbody>
                  {boxTotals.map((b, i) => (
                    <tr key={b.label} className="hover:bg-[rgba(244,236,221,.4)]">
                      <td className="px-3 py-[10px] font-medium" style={{ borderBottom: "1px solid var(--color-line)" }}>{b.label}</td>
                      <td className="px-3 py-[10px] text-right font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>
                        {b.quantity.toFixed(0)}
                      </td>
                      <PriorAndYoY current={b.quantity} prior={boxTotalsPriorYear[i]?.quantity} />
                    </tr>
                  ))}
                  <tr style={{ background: "var(--color-paper)" }}>
                    <td className="px-3 py-[10px] font-semibold" style={{ borderTop: "2px solid var(--color-line-2)" }}>Total</td>
                    <td className="px-3 py-[10px] text-right font-mono font-semibold" style={{ borderTop: "2px solid var(--color-line-2)" }}>
                      {boxTotals.reduce((s, b) => s + b.quantity, 0).toFixed(0)}
                    </td>
                    <PriorAndYoY
                      current={boxTotals.reduce((s, b) => s + b.quantity, 0)}
                      prior={boxTotalsPriorYear.reduce((s, b) => s + b.quantity, 0)}
                      emphasise
                    />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "trends" && (
          <div className="p-[18px] grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
            <TrendChart title="Sauce:Cheese Ratio" data={trendData} dataKey="sauce_cheese_ratio" multiply={100} color="var(--color-mustard)" target={{ low: 75, high: 125 }} />
            <TrendChart title="Flour:Cheese Ratio" data={trendData} dataKey="flour_cheese_ratio" multiply={100} color="var(--color-basil)" target={{ low: 75, high: 125 }} />
            <TrendChart title="Cheese Diff (cases)" data={trendData} dataKey="cheese_diff" color="var(--color-ginos-red)" threshold={6} />
            <TrendChart title="Sauce Diff (cases)" data={trendData} dataKey="sauce_diff" color="var(--color-mustard)" threshold={6} />
          </div>
        )}

        {activeTab === "compare" && (
          <div className="p-[18px]">
            {metrics.length >= 2 ? (
              <div>
                <p className="text-[13px] mb-4" style={{ color: "var(--color-ink-2)" }}>
                  Week-over-week comparison for {storeCode}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        {/* James, July 22 2026: drop "vs Prev", add Flour
                            Difference and the Flour:Cheese ratio. */}
                        {["Week", "Cheese Difference", "Sauce Difference", "Flour Difference", "Sauce:Cheese", "Flour:Cheese", "Status"].map(h => (
                          <th key={h} className="text-left font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.slice(0, 15).map((m, i) => {
                        const weekKey = `${m.year}-${m.week_number}`;
                        const isOpen = openExplanation === weekKey;
                        const explanation = explanationFor(i);
                        return (
                          <Fragment key={weekKey}>
                            <tr className="hover:bg-[rgba(244,236,221,.3)]">
                              <td className="px-[14px] py-[10px] font-mono font-medium" style={{ borderBottom: isOpen ? "none" : "1px solid var(--color-line)" }}>
                                Wk {m.week_number as number}
                                <span className="text-[10px] ml-1" style={{ color: "var(--color-ink-3)" }}>{m.year as number}</span>
                              </td>
                              <td className="px-[14px] py-[10px]" style={{ borderBottom: isOpen ? "none" : "1px solid var(--color-line)" }}>
                                <DiffCell value={m.cheese_diff as number} />
                              </td>
                              <td className="px-[14px] py-[10px]" style={{ borderBottom: isOpen ? "none" : "1px solid var(--color-line)" }}>
                                <DiffCell value={m.sauce_diff as number} />
                              </td>
                              <td className="px-[14px] py-[10px]" style={{ borderBottom: isOpen ? "none" : "1px solid var(--color-line)" }}>
                                <DiffCell value={m.flour_diff as number} unit="bg" />
                              </td>
                              <td className="px-[14px] py-[10px]" style={{ borderBottom: isOpen ? "none" : "1px solid var(--color-line)" }}>
                                <RatioCell value={m.sauce_cheese_ratio as number} />
                              </td>
                              <td className="px-[14px] py-[10px]" style={{ borderBottom: isOpen ? "none" : "1px solid var(--color-line)" }}>
                                <RatioCell value={m.flour_cheese_ratio as number} />
                              </td>
                              <td className="px-[14px] py-[10px]" style={{ borderBottom: isOpen ? "none" : "1px solid var(--color-line)" }}>
                                {/* Click the status to see why it is that status
                                    (James, July 22 2026 — he was open on tooltip
                                    vs click-to-expand; click keeps it readable on
                                    a laptop trackpad and lets the text be a full
                                    sentence, and title= still gives a hover hint). */}
                                <button
                                  onClick={() => setOpenExplanation(isOpen ? null : weekKey)}
                                  title={explanation?.headline ?? undefined}
                                  className="flex items-center gap-[5px] cursor-pointer"
                                  aria-expanded={isOpen}
                                >
                                  <StatusPill status={m.overall_status as ComplianceStatus} />
                                  <ChevronDown
                                    className="w-3 h-3 transition-transform"
                                    style={{ color: "var(--color-ink-3)", transform: isOpen ? "rotate(180deg)" : "none" }}
                                  />
                                </button>
                              </td>
                            </tr>
                            {isOpen && explanation && (
                              <tr>
                                <td colSpan={7} className="px-[14px] pb-[12px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                                  <div
                                    className="rounded-[10px] px-[12px] py-[10px] text-[12.5px] leading-relaxed"
                                    style={{ background: "var(--color-paper)", border: "1px solid var(--color-line)", color: "var(--color-ink-2)" }}
                                  >
                                    {explanation.detail}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-[13px]" style={{ color: "var(--color-ink-3)" }}>Not enough data for comparison</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "flags" && (
          <div className="p-[18px]">
            {flags.length > 0 ? (
              <div className="flex flex-col gap-4">
                {flags.map((f, i) => (
                  <div key={`${f.year}-${f.week}-${f.type}-${i}`} className="flex items-start gap-3">
                    <FlagIcon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--color-ginos-red)" }} />
                    <div>
                      {/* All flag values are percentages now: diff flags carry the
                          signed % vs box-expected, ratio flags the ratio level %. */}
                      <div className="text-[13px] font-medium">
                        {f.metric}: {f.value > 0 && f.type.includes("over") ? "+" : ""}{f.value.toFixed(1)}%
                        {/* Occurrence date (James, July 22 2026). This tab spans
                            every week now, so each row needs to say WHEN. */}
                        {f.week !== undefined && f.year !== undefined && (
                          <span className="font-mono text-[11px] font-normal ml-2" style={{ color: "var(--color-ink-3)" }}>
                            {weekWithDate(f.year, f.week)}
                          </span>
                        )}
                      </div>
                      <div className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>{f.meaning}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-[13px] font-medium" style={{ color: "var(--color-basil)" }}>Clean record — no flags on record</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Anomalies for this store */}
      {anomalies.length > 0 && (
        <div
          className="rounded-[14px] bg-white overflow-hidden mt-[14px]"
          style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="flex items-center gap-2 px-[18px] py-[14px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
            <AlertTriangle className="w-4 h-4" style={{ color: "var(--color-mustard)" }} />
            <h3 className="text-[14px] font-semibold">Anomalies</h3>
            <span className="text-[11px] font-mono px-[6px] py-[2px] rounded-full" style={{ background: "var(--color-mustard-soft)", color: "var(--color-mustard)" }}>
              {anomalies.length}
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--color-line)" }}>
            {anomalies.map((a, i) => (
              <div key={`${a.week}-${a.type}-${i}`} className="flex items-center gap-3 px-[18px] py-[12px]">
                {a.severity === "critical" ? (
                  <AlertCircle className="w-4 h-4 shrink-0" style={{ color: "var(--color-ginos-red)" }} />
                ) : a.severity === "warning" ? (
                  <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--color-mustard)" }} />
                ) : (
                  <Info className="w-4 h-4 shrink-0" style={{ color: "var(--color-ink-3)" }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium">
                    Week {a.week} — {a.metric}
                    <span className="font-mono text-[11px] font-normal ml-2" style={{ color: "var(--color-ink-3)" }}>
                      wk of {weekMondayLabel(a.year, a.week)}
                    </span>
                  </div>
                  <p className="text-[12px]" style={{ color: "var(--color-ink-2)" }}>
                    {a.description}
                    {/* The window average alongside the single-week number, so a
                        one-off spike reads differently from a standing problem
                        (James, July 22 2026). */}
                    {a.window_average !== undefined && a.window_weeks !== undefined && (
                      <span style={{ color: "var(--color-ink-3)" }}>
                        {" · "}{a.window_weeks}-wk avg {a.window_average > 0 ? "+" : ""}{a.window_average.toFixed(1)} cases
                      </span>
                    )}
                  </p>
                </div>
                <span
                  className="shrink-0 text-[10px] font-semibold tracking-[.04em] uppercase px-[7px] py-[2px] rounded-full"
                  style={{
                    background: a.severity === "critical" ? "var(--color-ginos-red-soft)" : a.severity === "warning" ? "var(--color-mustard-soft)" : "var(--color-crust)",
                    color: a.severity === "critical" ? "var(--color-ginos-red)" : a.severity === "warning" ? "var(--color-mustard)" : "var(--color-ink-3)",
                  }}
                >
                  {a.type === "extreme_diff" ? "Extreme" : a.type === "zero_cheese" ? "No Cheese" : a.type === "zero_boxes" ? "No Boxes" : "Spike"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function KpiStrip({ label, ordered, estimated, diff, unit, avgOrdered, avgWeeks, avgLabel }: {
  label: string; ordered: number; estimated: number; diff: number; unit: string;
  avgOrdered: number; avgWeeks: number; avgLabel: string;
}) {
  return (
    <div className="rounded-[14px] p-[16px] bg-white flex flex-col gap-1" style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}>
      <span className="text-[11px] font-semibold tracking-[.06em] uppercase" style={{ color: "var(--color-ink-3)" }}>{label}</span>
      {/* The window average sits ABOVE the current week's figure (James, July 22
          2026) so the week is read against its own recent baseline. For range
          periods the average covers the whole period (July 31 2026). */}
      {avgWeeks > 0 && (
        <span className="text-[11px] font-mono" style={{ color: "var(--color-ink-3)" }}>
          {avgLabel}: {unitFmt(avgOrdered, unit)}
        </span>
      )}
      <span className="font-mono text-[16px] font-medium">{ordered.toFixed(1)} <span className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>{unit}</span></span>
      <span className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>Usage based on Boxes: {unitFmt(estimated, unit)}</span>
      <div className="mt-1"><DiffCell value={diff} unit={unit} /></div>
    </div>
  );
}

function RatioKpi({ label, value, status, avgValue, avgWeeks, avgLabel }: {
  label: string; value: number; status: ComplianceStatus; avgValue: number; avgWeeks: number; avgLabel: string;
}) {
  const pct = value * 100;
  const position = Math.min(Math.max((pct / 200) * 100, 0), 100);

  return (
    <div className="rounded-[14px] p-[16px] bg-white flex flex-col gap-2" style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}>
      <span className="text-[11px] font-semibold tracking-[.06em] uppercase" style={{ color: "var(--color-ink-3)" }}>{label}</span>
      {avgWeeks > 0 && (
        <span className="text-[11px] font-mono -mb-1" style={{ color: "var(--color-ink-3)" }}>
          {avgLabel}: {(avgValue * 100).toFixed(1)}%
        </span>
      )}
      <RatioCell value={value} />
      {/* Range viz */}
      <div className="relative h-[6px] rounded-full mt-1" style={{ background: "var(--color-crust)" }}>
        <div className="absolute h-full rounded-full" style={{ left: "37.5%", width: "25%", background: "var(--color-basil-soft)" }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-full border-2 border-white" style={{ left: `${position}%`, background: statusColor(status), boxShadow: "var(--shadow-sm)" }} />
      </div>
      <div className="flex justify-between text-[9px] font-mono" style={{ color: "var(--color-ink-3)" }}>
        <span>0%</span><span>75%</span><span>125%</span><span>200%</span>
      </div>
    </div>
  );
}

function TrendChart({ title, data, dataKey, multiply, color, target, threshold }: {
  title: string; data: Record<string, unknown>[]; dataKey: string; multiply?: number; color: string; target?: { low: number; high: number }; threshold?: number;
}) {
  const chartData = data.map((d) => ({
    week: d.week_number,
    value: ((d[dataKey] as number) ?? 0) * (multiply ?? 1),
  }));

  return (
    <div>
      <h4 className="text-[13px] font-semibold mb-3" style={{ letterSpacing: "-0.005em" }}>{title}</h4>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="var(--color-line)" vertical={false} />
          {target && <ReferenceArea y1={target.low} y2={target.high} fill="var(--color-basil-soft)" fillOpacity={0.5} />}
          {threshold && <ReferenceLine y={threshold} stroke="var(--color-ginos-red)" strokeDasharray="4 4" />}
          {threshold && <ReferenceLine y={-threshold} stroke="var(--color-ginos-red)" strokeDasharray="4 4" />}
          <XAxis dataKey="week" tickFormatter={(w) => `W${w}`} tick={{ fontSize: 10, fontFamily: "'JetBrains Mono'", fill: "var(--color-ink-3)" }} axisLine={{ stroke: "var(--color-line)" }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fontFamily: "'JetBrains Mono'", fill: "var(--color-ink-3)" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "white", border: "1px solid var(--color-line)", borderRadius: "10px", fontSize: "12px" }} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3, fill: "white", stroke: color, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(1);
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="font-semibold text-[11px] tracking-[.06em] uppercase px-3 py-[10px] whitespace-nowrap"
      style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)", textAlign: align }}
    >
      {children}
    </th>
  );
}

/**
 * Time-range selector for the Secondary Products and Boxes tabs — Last Week,
 * Last 4 Weeks, or a Quarter, as a total sum (James, July 22 2026). Writes to a
 * `range` search param so the server does the aggregation.
 */
function RangePicker({ current }: { current: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const set = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", value);
    router.push(`?${params.toString()}`);
  };

  const OPTIONS = [
    { key: "last_week", label: "Last Week" },
    { key: "last_4_weeks", label: "Last 4 Weeks" },
    { key: "q1", label: "Q1" },
    { key: "q2", label: "Q2" },
    { key: "q3", label: "Q3" },
    { key: "q4", label: "Q4" },
  ];

  return (
    <div className="inline-flex p-[3px] rounded-lg gap-[2px] mb-4" style={{ background: "var(--color-crust)" }}>
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          onClick={() => set(o.key)}
          className="px-3 py-[6px] rounded-[6px] text-[12.5px] font-medium transition-all"
          style={{
            background: current === o.key ? "white" : "transparent",
            color: current === o.key ? "var(--color-ink)" : "var(--color-ink-2)",
            boxShadow: current === o.key ? "var(--shadow-sm)" : "none",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Prior-year quantity plus the year-over-year change, as two cells.
 * `prior` undefined or 0 means there is nothing to compare against — shown as
 * "—" rather than a fake +100%, which is the honest reading when the prior year
 * simply has no data for this product (see getProductTotals' coverage note).
 */
function PriorAndYoY({ current, prior, emphasise = false, decimals = 0 }: { current: number; prior?: number; emphasise?: boolean; decimals?: number }) {
  const border = emphasise ? "2px solid var(--color-line-2)" : "1px solid var(--color-line)";
  const borderProp = emphasise ? { borderTop: border } : { borderBottom: border };
  const hasPrior = prior !== undefined && prior > 0;
  const pct = hasPrior ? ((current - prior) / prior) * 100 : null;

  return (
    <>
      <td className="px-3 py-[10px] text-right font-mono" style={{ ...borderProp, color: "var(--color-ink-3)" }}>
        {hasPrior ? prior.toFixed(decimals) : "—"}
      </td>
      <td
        className="px-3 py-[10px] text-right font-mono"
        style={{
          ...borderProp,
          fontWeight: emphasise ? 600 : 400,
          // Up/down on volume is neutral information, not good or bad — a store
          // selling more pizza SHOULD order more boxes. Deliberately not coloured
          // red/green like the compliance diffs.
          color: pct === null ? "var(--color-ink-3)" : "var(--color-ink-2)",
        }}
      >
        {pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
      </td>
    </>
  );
}

function NoPriorYearNote() {
  return (
    <p className="text-[11.5px] mt-3" style={{ color: "var(--color-ink-3)" }}>
      No prior-year comparison available: per-product order detail only exists from
      week 16 of 2026, when uploads began going through the app. Box quantities on
      the Boxes tab do have full history.
    </p>
  );
}

/**
 * Case/bag quantity with its unit. Cases and bags are small numbers (tens, not
 * thousands, unlike the raw oz these columns used to show), so they read better
 * at one decimal with no "k" abbreviation.
 */
function unitFmt(n: number, unit: string): string {
  return `${n.toFixed(1)} ${unit}`;
}

/**
 * Case size for this store, recovered from stored metrics.
 *
 * James (July 22 2026) wants the Ord and "Usage based on Boxes" columns in
 * cases/bags rather than oz/fl oz/kg. Flour is a fixed conversion (20 kg bags),
 * but CHEESE and SAUCE cases are sized from the store's DOMINANT SKU at
 * aggregation time — stores buy different pack sizes — and that divisor is never
 * persisted; only the resulting diff is.
 *
 * It is recoverable, because the stored diff IS that division:
 *   diff     = (ordered - estimated) / caseSize
 *   caseSize = (ordered - estimated) / diff
 *
 * Deriving it this way (rather than assuming a default) also guarantees the
 * column arithmetic ties out on screen: Ord - Usage equals the Difference
 * column, which is the first thing James would check.
 *
 * Weeks whose diff is near zero are numerically useless — a tiny numerator over
 * a tiny denominator — so we take the MEDIAN of the usable weeks, which ignores
 * those and any one-off outlier. Falls back to the engine's own default when no
 * week is usable.
 *
 * Sauce matters here as much as cheese: there are three sauce SKUs and two of
 * them are 600 fl oz against the 576.19 fl oz of the 6x2.84L product, which is
 * the 4.2-vs-4.0-cases discrepancy James reported on July 28 2026.
 *
 * Persisting the case size on weekly_metrics would be cleaner; it needs a schema
 * change plus a full re-import.
 */
function deriveCaseSize(
  metrics: Record<string, unknown>[],
  orderedKey: string,
  estimatedKey: string,
  diffKey: string,
  fallback: number
): number {
  const derived: number[] = [];
  for (const m of metrics) {
    const ordered = (m[orderedKey] as number) ?? 0;
    const estimated = (m[estimatedKey] as number) ?? 0;
    const diff = (m[diffKey] as number) ?? 0;
    // Need a diff big enough that the division is stable.
    if (Math.abs(diff) < 0.25) continue;
    const size = (ordered - estimated) / diff;
    if (Number.isFinite(size) && size > 1) derived.push(size);
  }
  if (derived.length === 0) return fallback;
  derived.sort((a, b) => a - b);
  return derived[Math.floor(derived.length / 2)];
}

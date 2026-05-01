"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Sparkles, RefreshCw, Flag, TrendingUp, TrendingDown, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { FilterBar, StatusPill, DiffCell, RatioCell } from "@/components/dashboard";
import { DonutChart, ComplianceTrend, Sparkline } from "@/components/charts";
import type { AppUser, NetworkStats, BrandStats, WeeklyTrend, Flag as FlagType, Anomaly } from "@/lib/types";

interface OverviewClientProps {
  user: AppUser;
  stats: NetworkStats;
  brandStats: BrandStats[];
  trend: WeeklyTrend[];
  atRisk: (Record<string, unknown> & { flags: FlagType[] })[];
  weeks: number[];
  years: number[];
  brands: string[];
  dsms: { id: string; name: string }[];
  currentWeek: number | null;
  currentYear: number;
  anomalies: Anomaly[];
}

export function OverviewClient({
  user,
  stats,
  brandStats,
  trend,
  atRisk,
  weeks,
  years,
  brands,
  dsms,
  currentWeek,
  currentYear,
  anomalies,
}: OverviewClientProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);

  async function handleGenerateInsight() {
    console.log("AI Insights clicked — fetching...");
    setAiLoading(true);
    setAiInsight(null);
    // Scroll to AI card
    document.getElementById("ai-insights-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: "overview",
          context: {
            ...stats,
            currentWeek,
            brandBreakdown: brandStats.map(b => ({ brand: b.brand, stores: b.store_count, compliance: b.compliance_pct + "%" })),
            worstStores: atRisk.slice(0, 5).map(m => ({
              store: (m.stores as Record<string, unknown>)?.code ?? m.store_code,
              cheese_diff: m.cheese_diff,
              sauce_diff: m.sauce_diff,
              status: m.overall_status,
            })),
            anomalyCount: anomalies.length,
            anomalySummary: {
              critical: anomalies.filter(a => a.severity === "critical").length,
              warning: anomalies.filter(a => a.severity === "warning").length,
              info: anomalies.filter(a => a.severity === "info").length,
            },
          },
        }),
      });
      const data = await res.json();
      setAiInsight(data.insight ?? "No insights available.");
    } catch {
      setAiInsight("Failed to generate insight. Try again.");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between gap-3 lg:gap-5 mb-[18px] lg:mb-[22px]">
        <div>
          <h1 className="font-serif text-[28px] lg:text-[38px] leading-none" style={{ letterSpacing: "-0.015em" }}>
            Overview
          </h1>
          <p className="text-[13px] mt-[6px]" style={{ color: "var(--color-ink-3)" }}>
            Network-wide compliance at a glance
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            className="hidden sm:flex items-center gap-[7px] px-[14px] py-2 rounded-[9px] bg-white text-[13px] font-medium transition-colors hover:bg-crust"
            style={{ border: "1px solid var(--color-line)" }}
          >
            Export
          </button>
          <button
            onClick={handleGenerateInsight}
            className="flex items-center gap-[7px] px-[10px] sm:px-[14px] py-2 rounded-[9px] text-white text-[13px] font-medium"
            style={{
              background: "var(--color-ginos-red)",
              boxShadow: "0 4px 14px rgba(226,35,26,.25), inset 0 1px 0 rgba(255,255,255,.18)",
            }}
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">AI Insights</span>
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar user={user} weeks={weeks} years={years} brands={brands} dsms={dsms} />

      {/* Top row: Hero compliance + KPI grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_2fr] gap-[14px] mb-[14px]">
        {/* Hero compliance card */}
        <div
          className="rounded-[14px] p-[18px] bg-white relative overflow-hidden"
          style={{
            border: "1px solid var(--color-line)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div
            className="text-[11px] font-semibold tracking-[.06em] uppercase mb-4"
            style={{ color: "var(--color-ink-3)" }}
          >
            {currentWeek ? `Week ${currentWeek}` : "Latest"} &middot; Network Compliance
          </div>

          <div className="flex items-center gap-5">
            <DonutChart value={stats.compliance_pct} />

            <div className="flex-1 flex flex-col gap-2">
              {/* Status bar */}
              <div className="flex h-[10px] rounded-full overflow-hidden" style={{ background: "var(--color-crust)" }}>
                {stats.compliant_count > 0 && (
                  <div
                    style={{
                      width: `${(stats.compliant_count / stats.total_stores) * 100}%`,
                      background: "var(--color-basil)",
                    }}
                  />
                )}
                {stats.borderline_count > 0 && (
                  <div
                    style={{
                      width: `${(stats.borderline_count / stats.total_stores) * 100}%`,
                      background: "var(--color-mustard)",
                    }}
                  />
                )}
                {stats.at_risk_count > 0 && (
                  <div
                    style={{
                      width: `${(stats.at_risk_count / stats.total_stores) * 100}%`,
                      background: "var(--color-ginos-red)",
                    }}
                  />
                )}
              </div>

              <div className="flex flex-col gap-[6px] text-[12px] mt-1">
                <span className="flex items-center gap-[6px]" style={{ color: "var(--color-basil)" }}>
                  <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: "var(--color-basil)" }} />
                  <strong>{stats.compliant_count}</strong> Compliant
                </span>
                <span className="flex items-center gap-[6px]" style={{ color: "var(--color-mustard)" }}>
                  <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: "var(--color-mustard)" }} />
                  <strong>{stats.borderline_count}</strong> Borderline
                </span>
                <span className="flex items-center gap-[6px]" style={{ color: "var(--color-ginos-red)" }}>
                  <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: "var(--color-ginos-red)" }} />
                  <strong>{stats.at_risk_count}</strong> At Risk
                </span>
              </div>
            </div>
          </div>

          {/* Bottom stats */}
          <div
            className="flex gap-6 mt-4 pt-4"
            style={{ borderTop: "1px dashed var(--color-line-2)" }}
          >
            <div className="text-[12px]">
              <span style={{ color: "var(--color-ink-3)" }}>S:C in band</span>
              <span className="font-mono font-medium ml-2">{stats.sauce_cheese_in_band_pct}%</span>
            </div>
            <div className="text-[12px]">
              <span style={{ color: "var(--color-ink-3)" }}>F:C in band</span>
              <span className="font-mono font-medium ml-2">{stats.flour_cheese_in_band_pct}%</span>
            </div>
            <div className="text-[12px]">
              <span style={{ color: "var(--color-ink-3)" }}>Reporting</span>
              <span className="font-mono font-medium ml-2">{stats.stores_reporting}</span>
            </div>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-[14px]">
          <KpiCard
            label="Avg Cheese Diff"
            value={`${stats.avg_cheese_diff > 0 ? "+" : ""}${stats.avg_cheese_diff.toFixed(1)}`}
            unit="cases"
            sparkData={trend.map((t) => t.avg_cheese_diff)}
            sparkColor="var(--color-ginos-red)"
          />
          <KpiCard
            label="Avg Sauce Diff"
            value={`${stats.avg_sauce_diff > 0 ? "+" : ""}${stats.avg_sauce_diff.toFixed(1)}`}
            unit="cases"
            sparkData={trend.map((t) => t.avg_sauce_diff)}
            sparkColor="var(--color-mustard)"
          />
          <KpiCard
            label="Avg Flour Diff"
            value={`${stats.avg_flour_diff > 0 ? "+" : ""}${stats.avg_flour_diff.toFixed(1)}`}
            unit="bags"
            sparkData={trend.map((t) => t.avg_flour_diff)}
            sparkColor="var(--color-basil)"
          />
          <KpiCard
            label="Avg Sauce:Cheese"
            value={`${(stats.avg_sauce_cheese_ratio * 100).toFixed(1)}%`}
            target="75–125%"
            sparkData={trend.map((t) => t.avg_sauce_cheese * 100)}
            sparkColor="var(--color-mustard)"
          />
          <KpiCard
            label="Avg Flour:Cheese"
            value={`${(stats.avg_flour_cheese_ratio * 100).toFixed(1)}%`}
            target="75–125%"
            sparkData={trend.map((t) => t.avg_flour_cheese * 100)}
            sparkColor="var(--color-basil)"
          />
          <KpiCard
            label="Active Flags"
            value={String(stats.active_flags)}
            icon={<Flag className="w-3.5 h-3.5" style={{ color: "var(--color-ginos-red)" }} />}
          />
        </div>
      </div>

      {/* Middle row: Trend + Brand mix */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1.1fr] gap-[14px] mb-[14px]">
        {/* Compliance trend */}
        <div
          className="rounded-[14px] bg-white overflow-hidden"
          style={{
            border: "1px solid var(--color-line)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between px-[18px] py-[14px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
            <h3 className="text-[14px] font-semibold" style={{ letterSpacing: "-0.005em" }}>
              Compliance Trend
            </h3>
            <span className="text-[11.5px]" style={{ color: "var(--color-ink-3)" }}>
              Last {trend.length} weeks
            </span>
          </div>
          <div className="p-[18px]">
            {trend.length > 0 ? (
              <ComplianceTrend data={trend} />
            ) : (
              <div className="h-[240px] flex items-center justify-center text-[13px] text-ink-3">
                No trend data available
              </div>
            )}
          </div>
        </div>

        {/* Brand breakdown */}
        <div
          className="rounded-[14px] bg-white overflow-hidden"
          style={{
            border: "1px solid var(--color-line)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between px-[18px] py-[14px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
            <h3 className="text-[14px] font-semibold" style={{ letterSpacing: "-0.005em" }}>
              Brand Breakdown
            </h3>
          </div>
          <div className="p-[18px] flex flex-col gap-4">
            {brandStats.length > 0 ? (
              brandStats.map((b) => (
                <div key={b.brand} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium">{b.brand}</span>
                    <span className="font-mono text-[12px]" style={{ color: "var(--color-ink-3)" }}>
                      {b.store_count} stores &middot; {b.compliance_pct}%
                    </span>
                  </div>
                  <div
                    className="h-[6px] rounded-full overflow-hidden"
                    style={{ background: "var(--color-crust)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${b.compliance_pct}%`,
                        background: b.color,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-ink-3">No brand data available</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: AI Insights + At-risk stores */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1.6fr] gap-[14px]">
        {/* AI Insights */}
        <div
          id="ai-insights-card"
          className="rounded-[14px] p-[18px] relative overflow-hidden"
          style={{
            background: "radial-gradient(ellipse at top right, rgba(226,35,26,.06), transparent 60%), linear-gradient(180deg, #FFFDF8, #FBF6EC)",
            border: "1px solid var(--color-line)",
          }}
        >
          <div className="flex items-center gap-[10px] mb-[10px]">
            <span
              className="inline-flex items-center gap-[6px] text-[11px] font-semibold tracking-[.04em] uppercase px-[9px] py-1 rounded-full"
              style={{
                background: "linear-gradient(135deg, #1B1A17, #3a2c20)",
                color: "#F4ECDD",
              }}
            >
              <Sparkles className="w-3 h-3" />
              AI Insights
            </span>
          </div>

          {!aiInsight && !aiLoading && (
            <>
              <h4 className="font-serif text-[22px] mb-2" style={{ letterSpacing: "-0.01em" }}>
                What should I focus on this week?
              </h4>
              <p className="text-[13.5px] leading-relaxed mb-4" style={{ color: "var(--color-ink-2)" }}>
                Generate an AI-powered summary of compliance patterns, anomalies, and recommended actions.
              </p>
              <button
                onClick={handleGenerateInsight}
                className="flex items-center gap-[7px] px-[14px] py-2 rounded-[9px] text-white text-[13px] font-medium"
                style={{
                  background: "var(--color-ginos-red)",
                  boxShadow: "0 4px 14px rgba(226,35,26,.25), inset 0 1px 0 rgba(255,255,255,.18)",
                }}
              >
                <Sparkles className="w-4 h-4" />
                Generate insight
              </button>
            </>
          )}

          {aiLoading && (
            <div className="flex flex-col gap-3 mt-2">
              <div className="h-4 w-3/4 rounded animate-shimmer" />
              <div className="h-4 w-full rounded animate-shimmer" />
              <div className="h-4 w-5/6 rounded animate-shimmer" />
              <div className="h-4 w-2/3 rounded animate-shimmer" />
            </div>
          )}

          {aiInsight && !aiLoading && (
            <>
              <h4 className="font-serif text-[22px] mb-3" style={{ letterSpacing: "-0.01em" }}>
                Weekly Summary
              </h4>
              <div className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: "var(--color-ink-2)" }}>
                {aiInsight}
              </div>
              <button
                onClick={handleGenerateInsight}
                className="flex items-center gap-[6px] mt-4 text-[12px] font-medium transition-colors"
                style={{ color: "var(--color-ink-3)" }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate
              </button>
            </>
          )}
        </div>

        {/* At-risk stores */}
        <div
          className="rounded-[14px] bg-white overflow-hidden"
          style={{
            border: "1px solid var(--color-line)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between px-[18px] py-[14px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
            <h3 className="text-[14px] font-semibold" style={{ letterSpacing: "-0.005em" }}>
              Stores Requiring Attention
            </h3>
            <Link
              href="/stores?status=bad"
              className="text-[11.5px] font-medium flex items-center gap-1"
              style={{ color: "var(--color-ginos-red)" }}
            >
              View all <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {atRisk.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th className="text-left font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Store</th>
                    <th className="text-right font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Cheese Δ</th>
                    <th className="text-right font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Sauce Δ</th>
                    <th className="text-right font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>S:C</th>
                    <th className="text-left font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {atRisk.map((m) => {
                    const store = m.stores as Record<string, unknown> | undefined;
                    const storeCode = (store?.code as string) ?? (m.store_code as string) ?? "—";
                    const storeId = (store?.id as string) ?? (m.store_id as string);

                    return (
                      <tr
                        key={storeId + "-" + (m.week_number as number)}
                        className="group cursor-default"
                        style={{ transition: "background .1s" }}
                      >
                        <td className="px-[14px] py-[12px] group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                          <Link href={`/store/${storeId}`} className="font-medium hover:underline">
                            {storeCode}
                          </Link>
                        </td>
                        <td className="px-[14px] py-[12px] text-right group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                          <DiffCell value={m.cheese_diff as number} />
                        </td>
                        <td className="px-[14px] py-[12px] text-right group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                          <DiffCell value={m.sauce_diff as number} />
                        </td>
                        <td className="px-[14px] py-[12px] text-right group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                          <RatioCell value={m.sauce_cheese_ratio as number} />
                        </td>
                        <td className="px-[14px] py-[12px] group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                          <StatusPill status={m.overall_status as "ok" | "warn" | "bad"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-[18px] py-10 text-center">
              <p className="text-[13px]" style={{ color: "var(--color-basil)" }}>
                All stores are in compliance
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div
          className="rounded-[14px] bg-white overflow-hidden mt-[14px]"
          style={{
            border: "1px solid var(--color-line)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between px-[18px] py-[14px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" style={{ color: "var(--color-mustard)" }} />
              <h3 className="text-[14px] font-semibold" style={{ letterSpacing: "-0.005em" }}>
                Anomalies Detected
              </h3>
              <span className="text-[11px] font-mono px-[6px] py-[2px] rounded-full" style={{ background: "var(--color-mustard-soft)", color: "var(--color-mustard)" }}>
                {anomalies.length}
              </span>
            </div>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--color-line)" }}>
            {anomalies.slice(0, 8).map((a, i) => (
              <Link
                key={`${a.store_id}-${a.week}-${a.type}-${i}`}
                href={`/store/${a.store_id}`}
                className="flex items-center gap-3 px-[18px] py-[12px] hover:bg-[rgba(244,236,221,.3)] transition-colors"
              >
                <div className="shrink-0">
                  {a.severity === "critical" ? (
                    <AlertCircle className="w-4 h-4" style={{ color: "var(--color-ginos-red)" }} />
                  ) : a.severity === "warning" ? (
                    <AlertTriangle className="w-4 h-4" style={{ color: "var(--color-mustard)" }} />
                  ) : (
                    <Info className="w-4 h-4" style={{ color: "var(--color-ink-3)" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-medium">{a.store_code}</span>
                    <span className="font-mono text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                      Wk {a.week}
                    </span>
                  </div>
                  <p className="text-[12px] truncate" style={{ color: "var(--color-ink-2)" }}>
                    {a.description}
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
              </Link>
            ))}
          </div>
          {anomalies.length > 8 && (
            <div className="px-[18px] py-[10px] text-center text-[12px]" style={{ color: "var(--color-ink-3)", borderTop: "1px solid var(--color-line)" }}>
              +{anomalies.length - 8} more anomalies
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  unit,
  target,
  icon,
  sparkData,
  sparkColor,
}: {
  label: string;
  value: string;
  unit?: string;
  target?: string;
  icon?: React.ReactNode;
  sparkData?: number[];
  sparkColor?: string;
}) {
  return (
    <div
      className="rounded-[14px] px-[18px] py-[16px] bg-white relative overflow-hidden flex flex-col gap-2"
      style={{
        border: "1px solid var(--color-line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span
          className="text-[11px] font-semibold tracking-[.06em] uppercase"
          style={{ color: "var(--color-ink-3)" }}
        >
          {label}
        </span>
      </div>
      <div className="font-serif text-[38px] leading-none" style={{ letterSpacing: "-0.015em" }}>
        {value}
      </div>
      {unit && (
        <span className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>
          {unit}
        </span>
      )}
      {target && (
        <span className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>
          Target: {target}
        </span>
      )}
      {sparkData && sparkData.length > 0 && (
        <div className="absolute right-0 bottom-0 opacity-90">
          <Sparkline data={sparkData} color={sparkColor} />
        </div>
      )}
    </div>
  );
}

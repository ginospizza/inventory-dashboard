"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Sparkles, RefreshCw, Flag as FlagIcon } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import { StatusPill, DiffCell, RatioCell } from "@/components/dashboard";
import type { AppUser, Flag, ComplianceStatus } from "@/lib/types";

interface StoreDetailClientProps {
  user: AppUser;
  store: Record<string, unknown>;
  metrics: Record<string, unknown>[];
  latest: Record<string, unknown> | null;
  flags: Flag[];
  secondaryOrders: Record<string, unknown>[];
  brandColor: string;
}

export function StoreDetailClient({
  user,
  store,
  metrics,
  latest,
  flags,
  secondaryOrders,
  brandColor,
}: StoreDetailClientProps) {
  const [activeTab, setActiveTab] = useState<"primary" | "secondary" | "trends" | "flags">("primary");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);

  const storeCode = store.code as string;
  const storeCity = store.city as string;
  const storeBrand = store.brand as string;
  const dsm = store.dsms as { name: string; region: string } | null;

  const last5 = metrics.slice(0, 5);
  const trendData = [...metrics].reverse().slice(-8);

  async function handleAiInsight() {
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: "store", context: { store: storeCode, latest } }),
      });
      const data = await res.json();
      setAiInsight(data.insight ?? "No insights available.");
    } catch {
      setAiInsight("Failed to generate insight.");
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

      <div className="flex items-start justify-between gap-5 mb-6">
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
          <h1 className="font-serif text-[38px] leading-none" style={{ letterSpacing: "-0.015em" }}>
            {storeCode}
            {storeCity && (
              <span className="text-[20px] ml-3" style={{ color: "var(--color-ink-3)" }}>
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
      </div>

      {/* AI insight panel */}
      {(aiLoading || aiInsight) && (
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
          ) : (
            <>
              <h4 className="font-serif text-[20px] mb-2">Store Analysis</h4>
              <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: "var(--color-ink-2)" }}>
                {aiInsight}
              </p>
              <button onClick={handleAiInsight} className="flex items-center gap-1 mt-3 text-[12px]" style={{ color: "var(--color-ink-3)" }}>
                <RefreshCw className="w-3 h-3" /> Regenerate
              </button>
            </>
          )}
        </div>
      )}

      {/* KPI strip */}
      {latest && (
        <div className="grid grid-cols-5 gap-[14px] mb-6">
          <KpiStrip label="Cheese" ordered={latest.cheese_ordered_oz as number} estimated={latest.cheese_estimated_oz as number} diff={latest.cheese_diff as number} unit="oz" diffUnit="cs" status={latest.cheese_status as ComplianceStatus} />
          <KpiStrip label="Sauce" ordered={latest.sauce_ordered_floz as number} estimated={latest.sauce_estimated_floz as number} diff={latest.sauce_diff as number} unit="fl oz" diffUnit="cs" status={latest.sauce_status as ComplianceStatus} />
          <KpiStrip label="Flour" ordered={latest.flour_ordered_kg as number} estimated={latest.flour_estimated_kg as number} diff={latest.flour_diff as number} unit="kg" diffUnit="bg" status={latest.flour_status as ComplianceStatus} />
          <RatioKpi label="S:C Ratio" value={latest.sauce_cheese_ratio as number} status={latest.sauce_cheese_status as ComplianceStatus} />
          <RatioKpi label="F:C Ratio" value={latest.flour_cheese_ratio as number} status={latest.flour_cheese_status as ComplianceStatus} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-[3px] rounded-lg" style={{ background: "var(--color-crust)", display: "inline-flex" }}>
        {([
          { key: "primary", label: "Primary Products" },
          { key: "secondary", label: "Secondary Products" },
          { key: "trends", label: "Trends" },
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
                  {["Week", "Cheese Ord", "Cheese Est", "Cheese Δ", "Sauce Ord", "Sauce Est", "Sauce Δ", "Flour Ord", "Flour Est", "Flour Δ", "S:C", "F:C"].map((h) => (
                    <th key={h} className="text-right font-semibold text-[11px] tracking-[.06em] uppercase px-3 py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)", background: "var(--color-paper)", textAlign: h === "Week" ? "left" : "right" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {last5.map((m) => (
                  <tr key={`${m.year}-${m.week_number}`} className="hover:bg-[rgba(244,236,221,.4)]">
                    <td className="px-3 py-[10px] font-medium" style={{ borderBottom: "1px solid var(--color-line)" }}>W{m.week_number as number}</td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)" }}>{fmt(m.cheese_ordered_oz as number)}</td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-3)" }}>{fmt(m.cheese_estimated_oz as number)}</td>
                    <td className="px-3 py-[10px] text-right" style={{ borderBottom: "1px solid var(--color-line)" }}><DiffCell value={m.cheese_diff as number} /></td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)" }}>{fmt(m.sauce_ordered_floz as number)}</td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-3)" }}>{fmt(m.sauce_estimated_floz as number)}</td>
                    <td className="px-3 py-[10px] text-right" style={{ borderBottom: "1px solid var(--color-line)" }}><DiffCell value={m.sauce_diff as number} /></td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)" }}>{fmt(m.flour_ordered_kg as number)}</td>
                    <td className="px-3 py-[10px] text-right font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-3)" }}>{fmt(m.flour_estimated_kg as number)}</td>
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
            {secondaryOrders.length > 0 ? (
              <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th className="text-left font-semibold text-[11px] tracking-[.06em] uppercase px-3 py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Product</th>
                    <th className="text-right font-semibold text-[11px] tracking-[.06em] uppercase px-3 py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {secondaryOrders.map((o, i) => {
                    const prod = o.products as Record<string, unknown> | null;
                    return (
                      <tr key={i} className="hover:bg-[rgba(244,236,221,.4)]">
                        <td className="px-3 py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                          <span className="font-medium">{prod?.description as string ?? "—"}</span>
                          <span className="text-[11px] ml-2" style={{ color: "var(--color-ink-3)" }}>{prod?.pack_size as string}</span>
                        </td>
                        <td className="px-3 py-[10px] text-right font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>
                          {o.quantity as number}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-center py-8 text-[13px]" style={{ color: "var(--color-ink-3)" }}>No secondary product data for this week</p>
            )}
          </div>
        )}

        {activeTab === "trends" && (
          <div className="p-[18px] grid grid-cols-2 gap-[18px]">
            <TrendChart title="Sauce:Cheese Ratio" data={trendData} dataKey="sauce_cheese_ratio" multiply={100} color="var(--color-mustard)" target={{ low: 75, high: 125 }} />
            <TrendChart title="Flour:Cheese Ratio" data={trendData} dataKey="flour_cheese_ratio" multiply={100} color="var(--color-basil)" target={{ low: 75, high: 125 }} />
            <TrendChart title="Cheese Diff (cases)" data={trendData} dataKey="cheese_diff" color="var(--color-ginos-red)" threshold={6} />
            <TrendChart title="Sauce Diff (cases)" data={trendData} dataKey="sauce_diff" color="var(--color-mustard)" threshold={6} />
          </div>
        )}

        {activeTab === "flags" && (
          <div className="p-[18px]">
            {flags.length > 0 ? (
              <div className="flex flex-col gap-4">
                {flags.map((f, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <FlagIcon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--color-ginos-red)" }} />
                    <div>
                      <div className="text-[13px] font-medium">{f.metric}: {f.value.toFixed(1)}</div>
                      <div className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>{f.meaning}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-[13px] font-medium" style={{ color: "var(--color-basil)" }}>Clean record — no flags this week</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function KpiStrip({ label, ordered, estimated, diff, unit, diffUnit, status }: {
  label: string; ordered: number; estimated: number; diff: number; unit: string; diffUnit: string; status: ComplianceStatus;
}) {
  return (
    <div className="rounded-[14px] p-[16px] bg-white flex flex-col gap-1" style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}>
      <span className="text-[11px] font-semibold tracking-[.06em] uppercase" style={{ color: "var(--color-ink-3)" }}>{label}</span>
      <span className="font-mono text-[16px] font-medium">{fmt(ordered)} <span className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>{unit}</span></span>
      <span className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>Est: {fmt(estimated)} {unit}</span>
      <div className="mt-1"><DiffCell value={diff} unit={diffUnit} /></div>
    </div>
  );
}

function RatioKpi({ label, value, status }: { label: string; value: number; status: ComplianceStatus }) {
  const pct = value * 100;
  const position = Math.min(Math.max((pct / 200) * 100, 0), 100);

  return (
    <div className="rounded-[14px] p-[16px] bg-white flex flex-col gap-2" style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}>
      <span className="text-[11px] font-semibold tracking-[.06em] uppercase" style={{ color: "var(--color-ink-3)" }}>{label}</span>
      <RatioCell value={value} />
      {/* Range viz */}
      <div className="relative h-[6px] rounded-full mt-1" style={{ background: "var(--color-crust)" }}>
        <div className="absolute h-full rounded-full" style={{ left: "37.5%", width: "25%", background: "var(--color-basil-soft)" }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-full border-2 border-white" style={{ left: `${position}%`, background: status === "ok" ? "var(--color-basil)" : status === "warn" ? "var(--color-mustard)" : "var(--color-ginos-red)", boxShadow: "var(--shadow-sm)" }} />
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

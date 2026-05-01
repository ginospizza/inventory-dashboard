"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import Link from "next/link";
import { ArrowRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { NetworkStats } from "@/lib/types";

interface StoreCompare {
  store_code: string;
  store_id: string;
  brand: string;
  a: { cheese_diff: number; sauce_diff: number; sc_ratio: number; status: string } | null;
  b: { cheese_diff: number; sauce_diff: number; sc_ratio: number; status: string } | null;
}

interface CompareClientProps {
  years: number[];
  weeksA: number[];
  weeksB: number[];
  yearA: number;
  weekA: number;
  yearB: number;
  weekB: number;
  statsA: NetworkStats;
  statsB: NetworkStats;
  storeComparison: StoreCompare[];
}

const selectStyle: React.CSSProperties = {
  border: "1px solid var(--color-line)",
  background: "white",
  padding: "7px 12px",
  borderRadius: "8px",
  fontSize: "12.5px",
  color: "var(--color-ink)",
  cursor: "default",
};

function DeltaChip({ value, suffix = "", invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  const isPositive = invert ? value < 0 : value > 0;
  const isNegative = invert ? value > 0 : value < 0;
  const color = isPositive ? "var(--color-basil)" : isNegative ? "var(--color-ginos-red)" : "var(--color-ink-3)";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[12px]" style={{ color }}>
      {value > 0 ? "+" : ""}{value.toFixed(1)}{suffix}
      {isPositive && <TrendingUp className="w-3 h-3" />}
      {isNegative && <TrendingDown className="w-3 h-3" />}
      {value === 0 && <Minus className="w-3 h-3" />}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "ok" ? "var(--color-basil)" : status === "warn" ? "var(--color-mustard)" : "var(--color-ginos-red)";
  return <span className="w-[7px] h-[7px] rounded-full inline-block" style={{ background: color }} />;
}

export function CompareClient({
  years,
  weeksA,
  weeksB,
  yearA,
  weekA,
  yearB,
  weekB,
  statsA,
  statsB,
  storeComparison,
}: CompareClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) params.set(k, v);
      router.push(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const complianceDelta = statsB.compliance_pct - statsA.compliance_pct;
  const cheeseDelta = statsB.avg_cheese_diff - statsA.avg_cheese_diff;
  const sauceDelta = statsB.avg_sauce_diff - statsA.avg_sauce_diff;
  const scDelta = (statsB.avg_sauce_cheese_ratio - statsA.avg_sauce_cheese_ratio) * 100;

  // Count improved / worsened stores
  const improved = storeComparison.filter(s => {
    if (!s.a || !s.b) return false;
    const sv = (st: string) => st === "bad" ? 2 : st === "warn" ? 1 : 0;
    return sv(s.b.status) < sv(s.a.status);
  }).length;
  const worsened = storeComparison.filter(s => {
    if (!s.a || !s.b) return false;
    const sv = (st: string) => st === "bad" ? 2 : st === "warn" ? 1 : 0;
    return sv(s.b.status) > sv(s.a.status);
  }).length;

  return (
    <div>
      <div className="mb-[18px] lg:mb-[22px]">
        <h1 className="font-serif text-[28px] lg:text-[38px] leading-none" style={{ letterSpacing: "-0.015em" }}>
          Compare Periods
        </h1>
        <p className="text-[13px] mt-[6px]" style={{ color: "var(--color-ink-3)" }}>
          Side-by-side compliance comparison across any two periods
        </p>
      </div>

      {/* Period selectors */}
      <div
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-[14px] bg-white rounded-[12px] mb-[18px]"
        style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}
      >
        {/* Period A */}
        <div className="flex items-center gap-2 flex-1">
          <span className="text-[11px] font-semibold tracking-[.06em] uppercase px-[8px] py-[3px] rounded-full" style={{ background: "var(--color-crust)", color: "var(--color-ink-3)" }}>A</span>
          <select value={yearA} onChange={(e) => updateParams({ yearA: e.target.value })} style={selectStyle}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={weekA} onChange={(e) => updateParams({ weekA: e.target.value })} style={selectStyle}>
            {weeksA.map(w => <option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>

        <ArrowRight className="w-5 h-5 mx-2 shrink-0 hidden sm:block" style={{ color: "var(--color-ink-3)" }} />

        {/* Period B */}
        <div className="flex items-center gap-2 flex-1">
          <span className="text-[11px] font-semibold tracking-[.06em] uppercase px-[8px] py-[3px] rounded-full" style={{ background: "var(--color-ginos-red-soft)", color: "var(--color-ginos-red)" }}>B</span>
          <select value={yearB} onChange={(e) => updateParams({ yearB: e.target.value })} style={selectStyle}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={weekB} onChange={(e) => updateParams({ weekB: e.target.value })} style={selectStyle}>
            {weeksB.map(w => <option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>
      </div>

      {/* Network summary comparison */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-[14px]">
        <CompareCard
          label="Compliance"
          valueA={`${statsA.compliance_pct}%`}
          valueB={`${statsB.compliance_pct}%`}
          delta={<DeltaChip value={complianceDelta} suffix="%" />}
        />
        <CompareCard
          label="Avg Cheese Diff"
          valueA={`${statsA.avg_cheese_diff > 0 ? "+" : ""}${statsA.avg_cheese_diff.toFixed(1)}`}
          valueB={`${statsB.avg_cheese_diff > 0 ? "+" : ""}${statsB.avg_cheese_diff.toFixed(1)}`}
          delta={<DeltaChip value={cheeseDelta} invert />}
        />
        <CompareCard
          label="Avg Sauce Diff"
          valueA={`${statsA.avg_sauce_diff > 0 ? "+" : ""}${statsA.avg_sauce_diff.toFixed(1)}`}
          valueB={`${statsB.avg_sauce_diff > 0 ? "+" : ""}${statsB.avg_sauce_diff.toFixed(1)}`}
          delta={<DeltaChip value={sauceDelta} invert />}
        />
        <CompareCard
          label="Avg S:C Ratio"
          valueA={`${(statsA.avg_sauce_cheese_ratio * 100).toFixed(1)}%`}
          valueB={`${(statsB.avg_sauce_cheese_ratio * 100).toFixed(1)}%`}
          delta={<DeltaChip value={scDelta} suffix="%" />}
        />
      </div>

      {/* Movement summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[14px] mb-[18px]">
        <div className="rounded-[12px] px-[16px] py-[14px] bg-white flex items-center gap-3" style={{ border: "1px solid var(--color-line)" }}>
          <TrendingUp className="w-5 h-5" style={{ color: "var(--color-basil)" }} />
          <div>
            <div className="font-serif text-[24px] leading-none">{improved}</div>
            <div className="text-[11px] mt-1" style={{ color: "var(--color-ink-3)" }}>Stores Improved</div>
          </div>
        </div>
        <div className="rounded-[12px] px-[16px] py-[14px] bg-white flex items-center gap-3" style={{ border: "1px solid var(--color-line)" }}>
          <TrendingDown className="w-5 h-5" style={{ color: "var(--color-ginos-red)" }} />
          <div>
            <div className="font-serif text-[24px] leading-none">{worsened}</div>
            <div className="text-[11px] mt-1" style={{ color: "var(--color-ink-3)" }}>Stores Worsened</div>
          </div>
        </div>
        <div className="rounded-[12px] px-[16px] py-[14px] bg-white flex items-center gap-3" style={{ border: "1px solid var(--color-line)" }}>
          <Minus className="w-5 h-5" style={{ color: "var(--color-ink-3)" }} />
          <div>
            <div className="font-serif text-[24px] leading-none">{storeComparison.filter(s => s.a && s.b).length - improved - worsened}</div>
            <div className="text-[11px] mt-1" style={{ color: "var(--color-ink-3)" }}>No Change</div>
          </div>
        </div>
      </div>

      {/* Store-by-store comparison table */}
      <div
        className="rounded-[14px] bg-white overflow-hidden"
        style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="px-[18px] py-[14px] flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-line)" }}>
          <h3 className="text-[14px] font-semibold">Store-by-Store Changes</h3>
          <span className="text-[11.5px]" style={{ color: "var(--color-ink-3)" }}>{storeComparison.length} stores</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="text-left font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Store</th>
                <th className="text-center font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Status A</th>
                <th className="text-center font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Status B</th>
                <th className="text-right font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Cheese Δ</th>
                <th className="text-right font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>S:C Change</th>
                <th className="text-center font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {storeComparison.slice(0, 30).map((s) => {
                const sv = (st: string) => st === "bad" ? 2 : st === "warn" ? 1 : 0;
                const statusChange = s.a && s.b ? sv(s.b.status) - sv(s.a.status) : 0;
                const cheeseDiff = s.a && s.b ? s.b.cheese_diff - s.a.cheese_diff : 0;
                const scChange = s.a && s.b ? (s.b.sc_ratio - s.a.sc_ratio) * 100 : 0;

                return (
                  <tr key={s.store_id} className="hover:bg-[rgba(244,236,221,.3)] transition-colors">
                    <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <Link href={`/store/${s.store_id}`} className="font-medium hover:underline">{s.store_code}</Link>
                      <span className="text-[10px] ml-2" style={{ color: "var(--color-ink-3)" }}>{s.brand}</span>
                    </td>
                    <td className="px-[14px] py-[10px] text-center" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      {s.a ? <StatusDot status={s.a.status} /> : <span className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>—</span>}
                    </td>
                    <td className="px-[14px] py-[10px] text-center" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      {s.b ? <StatusDot status={s.b.status} /> : <span className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>—</span>}
                    </td>
                    <td className="px-[14px] py-[10px] text-right font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      {s.a && s.b ? <DeltaChip value={cheeseDiff} invert /> : "—"}
                    </td>
                    <td className="px-[14px] py-[10px] text-right font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      {s.a && s.b ? <DeltaChip value={scChange} suffix="%" /> : "—"}
                    </td>
                    <td className="px-[14px] py-[10px] text-center" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      {statusChange < 0 ? (
                        <span className="text-[10px] font-semibold px-[6px] py-[2px] rounded-full" style={{ background: "var(--color-basil-soft)", color: "var(--color-basil)" }}>Improved</span>
                      ) : statusChange > 0 ? (
                        <span className="text-[10px] font-semibold px-[6px] py-[2px] rounded-full" style={{ background: "var(--color-ginos-red-soft)", color: "var(--color-ginos-red)" }}>Worsened</span>
                      ) : (
                        <span className="text-[10px] px-[6px] py-[2px] rounded-full" style={{ background: "var(--color-crust)", color: "var(--color-ink-3)" }}>Same</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CompareCard({ label, valueA, valueB, delta }: { label: string; valueA: string; valueB: string; delta: React.ReactNode }) {
  return (
    <div className="rounded-[14px] px-[16px] py-[14px] bg-white" style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}>
      <div className="text-[11px] font-semibold tracking-[.06em] uppercase mb-2" style={{ color: "var(--color-ink-3)" }}>{label}</div>
      <div className="flex items-baseline gap-3 mb-1">
        <div>
          <span className="text-[10px] mr-1" style={{ color: "var(--color-ink-3)" }}>A</span>
          <span className="font-serif text-[22px]">{valueA}</span>
        </div>
        <ArrowRight className="w-3 h-3 shrink-0" style={{ color: "var(--color-ink-3)" }} />
        <div>
          <span className="text-[10px] mr-1" style={{ color: "var(--color-ginos-red)" }}>B</span>
          <span className="font-serif text-[22px]">{valueB}</span>
        </div>
      </div>
      <div>{delta}</div>
    </div>
  );
}

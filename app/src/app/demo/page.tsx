"use client";

import { useState } from "react";
import {
  LayoutDashboard, Store, Upload, Settings, ChevronRight,
  Sparkles, Flag, Search, Bell,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
  PieChart, Pie, Cell,
} from "recharts";

/* ── Mock data ──────────────────────────────────────────────── */

const STORES = [
  { code: "GINOS032", city: "Guelph", brand: "GINOS", dsm: "Paul", cd: 8.2, sd: -2.1, fd: 3.4, sc: 0.82, fc: 0.91, st: "bad" as const },
  { code: "GINOS017", city: "Milton", brand: "GINOS", dsm: "Michel", cd: -7.5, sd: 4.2, fd: -1.2, sc: 1.31, fc: 0.88, st: "bad" as const },
  { code: "TTD BARRIE", city: "Barrie", brand: "TTD", dsm: "Brijesh", cd: 5.8, sd: 6.3, fd: 2.1, sc: 0.72, fc: 1.05, st: "bad" as const },
  { code: "GINOS065", city: "Peterborough", brand: "GINOS", dsm: "Raj", cd: 3.8, sd: -4.5, fd: 1.8, sc: 0.69, fc: 1.12, st: "warn" as const },
  { code: "PP/WM14", city: "Waterloo", brand: "PP", dsm: "Paul", cd: -3.2, sd: 1.5, fd: -4.1, sc: 1.18, fc: 0.78, st: "warn" as const },
  { code: "GINOS008", city: "Burlington", brand: "GINOS", dsm: "Michel", cd: 2.1, sd: -0.8, fd: 0.5, sc: 0.95, fc: 1.02, st: "ok" as const },
  { code: "TTD HAMILTON", city: "Hamilton", brand: "TTD", dsm: "Jim", cd: -1.5, sd: 0.3, fd: 1.2, sc: 1.08, fc: 0.97, st: "ok" as const },
  { code: "GINOS003", city: "Oakville", brand: "GINOS", dsm: "Michel", cd: 0.8, sd: -1.2, fd: 0.3, sc: 0.99, fc: 1.01, st: "ok" as const },
];

const TREND = [
  { week: 8, v: 72 }, { week: 9, v: 68 }, { week: 10, v: 74 }, { week: 11, v: 71 },
  { week: 12, v: 76 }, { week: 13, v: 73 }, { week: 14, v: 78 }, { week: 15, v: 78 },
];

const BRANDS = [
  { brand: "GINOS", color: "#E2231A", count: 85, pct: 81 },
  { brand: "TTD", color: "#0E5FAE", count: 31, pct: 74 },
  { brand: "PP/WM", color: "#7A2A2A", count: 11, pct: 64 },
  { brand: "STORE", color: "#3D6644", count: 13, pct: 85 },
  { brand: "DD", color: "#9C5B14", count: 8, pct: 75 },
];

const BC: Record<string, string> = { GINOS: "#E2231A", TTD: "#0E5FAE", PP: "#7A2A2A", STORE: "#3D6644", DD: "#9C5B14" };
const SC = { ok: "#2E7D4F", warn: "#C77A00", bad: "#E2231A" };
const SBG = { ok: "#E6F1EA", warn: "#FBEFD9", bad: "#FCEAE9" };
const SL = { ok: "In compliance", warn: "Borderline", bad: "Out of compliance" };

/* ── Helpers ────────────────────────────────────────────────── */

function diffColor(v: number) { const a = Math.abs(v); return a > 6 ? SC.bad : a > 3 ? SC.warn : SC.ok; }
function ratioColor(v: number) { const p = v * 100; return p >= 75 && p <= 125 ? SC.ok : p >= 65 && p <= 135 ? SC.warn : SC.bad; }

function Diff({ v, u = "cs" }: { v: number; u?: string }) {
  return <span className="font-mono" style={{ color: diffColor(v), fontSize: 13, fontWeight: 500, fontFeatureSettings: "'tnum'" }}>{v > 0 ? "+" : ""}{v.toFixed(1)}<span style={{ color: "#7A7670", fontSize: 11, marginLeft: 2 }}>{u}</span></span>;
}
function Ratio({ v }: { v: number }) {
  return <span className="font-mono" style={{ color: ratioColor(v), fontSize: 13, fontWeight: 500, fontFeatureSettings: "'tnum'" }}>{(v * 100).toFixed(1)}%</span>;
}
function Pill({ s }: { s: "ok" | "warn" | "bad" }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, background: SBG[s], color: SC[s], fontSize: 11.5, fontWeight: 600, lineHeight: 1.4 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor" }} />{SL[s]}</span>;
}

/* ── Page ───────────────────────────────────────────────────── */

export default function DemoPage() {
  const [page, setPage] = useState<"overview" | "stores">("overview");

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside style={{ position: "fixed", top: 0, left: 0, height: "100vh", width: 232, background: "linear-gradient(180deg, #1B1A17 0%, #2A211A 100%)", color: "#F4ECDD", padding: "20px 16px", display: "flex", flexDirection: "column", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px 18px" }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: "white", padding: 3, display: "grid", placeItems: "center", boxShadow: "0 4px 14px rgba(226,35,26,.35)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 6, background: "#E2231A", display: "grid", placeItems: "center", color: "white", fontWeight: 700, fontSize: 12 }}>G</div>
          </div>
          <div style={{ lineHeight: 1.05 }}>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22 }}>Gino&apos;s</div>
            <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#C9B68B" }}>Inventory</div>
          </div>
        </div>

        <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#8A7C5F", padding: "14px 8px 6px" }}>Analytics</div>
        {([["overview", "Overview", LayoutDashboard], ["stores", "All Stores", Store]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setPage(key as "overview" | "stores")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, fontSize: 13.5, fontWeight: 500, letterSpacing: "-0.005em", color: page === key ? "white" : "#E0D5BD", background: page === key ? "#E2231A" : "transparent", boxShadow: page === key ? "inset 0 0 0 1px rgba(255,255,255,.08), 0 4px 14px rgba(226,35,26,.35)" : "none", border: "none", cursor: "pointer", width: "100%", textAlign: "left" }}>
            <Icon style={{ width: 16, height: 16, opacity: page === key ? 1 : 0.8 }} />{label}
          </button>
        ))}

        <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#8A7C5F", padding: "14px 8px 6px" }}>Management</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, fontSize: 13.5, fontWeight: 500, color: "#C9B68B", opacity: 0.6 }}>
          <Upload style={{ width: 16, height: 16, opacity: 0.8 }} />Upload Data
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, fontSize: 13.5, fontWeight: 500, color: "#C9B68B", opacity: 0.6 }}>
          <Settings style={{ width: 16, height: 16, opacity: 0.8 }} />Admin Panel
        </div>

        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: 10, borderTop: "1px solid rgba(255,255,255,.07)", fontSize: 12 }}>
          <div style={{ width: 30, height: 30, borderRadius: 999, background: "#E2231A", display: "grid", placeItems: "center", color: "white", fontWeight: 700, fontSize: 12 }}>JD</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 600, color: "#FBF8F2" }}>James D.</div>
            <div style={{ fontSize: 10.5, letterSpacing: ".04em", color: "#8A7C5F" }}>Super Admin</div>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────── */}
      <main style={{ marginLeft: 232, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <header style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: 14, padding: "14px 28px", background: "#FBF8F2", borderBottom: "1px solid #E7DFCE" }}>
          <div style={{ fontSize: 12.5, color: "#7A7670", display: "flex", alignItems: "center", gap: 6 }}>
            Dashboard <span>/</span> <span style={{ fontWeight: 600, color: "#1B1A17" }}>{page === "overview" ? "Overview" : "All Stores"}</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", background: "white", border: "1px solid #E7DFCE", borderRadius: 999, fontSize: 12.5, color: "#4A4843" }}>
              <Search style={{ width: 14, height: 14 }} />Search stores...
            </div>
            <div style={{ position: "relative", width: 34, height: 34, display: "grid", placeItems: "center", background: "white", border: "1px solid #E7DFCE", borderRadius: 9, color: "#4A4843" }}>
              <Bell style={{ width: 16, height: 16 }} />
              <span style={{ position: "absolute", top: 7, right: 8, width: 7, height: 7, borderRadius: 999, background: "#E2231A", border: "2px solid white" }} />
            </div>
          </div>
        </header>

        <div style={{ padding: "24px 28px 64px", maxWidth: 1640, overflowX: "hidden" }}>
          {page === "overview" ? <Overview /> : <AllStores />}
        </div>
      </main>
    </div>
  );
}

/* ── Overview ───────────────────────────────────────────────── */

function Overview() {
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 38, letterSpacing: "-0.015em", lineHeight: 1 }}>Overview</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#7A7670" }}>Network-wide compliance at a glance</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9, background: "white", border: "1px solid #E7DFCE", fontSize: 13, fontWeight: 500, color: "#1B1A17", cursor: "pointer" }}>Export</button>
          <button style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9, background: "#E2231A", border: "1px solid #E2231A", color: "white", fontSize: 13, fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 14px rgba(226,35,26,.25), inset 0 1px 0 rgba(255,255,255,.18)" }}>
            <Sparkles style={{ width: 16, height: 16 }} />AI Insights
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: 10, background: "white", border: "1px solid #E7DFCE", borderRadius: 10, marginBottom: 18, boxShadow: "0 1px 0 rgba(27,26,23,.04), 0 1px 2px rgba(27,26,23,.04)" }}>
        <Lbl>Week</Lbl><Sel options={["Week 15", "Week 14", "Week 13"]} />
        <Lbl>Brand</Lbl><Sel options={["All Brands", "GINOS", "TTD", "PP/WM"]} />
        <Lbl>DSM</Lbl><Sel options={["All DSMs", "Brijesh", "Jim", "Michel", "Paul", "Raj"]} />
      </div>

      {/* Top row: Hero + KPI grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 2fr", gap: 14, marginBottom: 14 }}>
        {/* Hero compliance */}
        <div className="checker" style={{ borderRadius: 14, padding: 18, background: "white", border: "1px solid #E7DFCE", boxShadow: "0 1px 0 rgba(27,26,23,.04), 0 1px 2px rgba(27,26,23,.04)", overflow: "hidden" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#7A7670", marginBottom: 16 }}>
            Week 15 &middot; Network Compliance
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <Donut value={78} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "#F4ECDD" }}>
                <div style={{ width: "78%", background: "#2E7D4F" }} />
                <div style={{ width: "10%", background: "#C77A00" }} />
                <div style={{ width: "12%", background: "#E2231A" }} />
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                <span style={{ color: "#2E7D4F" }}><b>118</b> in compliance</span>
                <span style={{ color: "#C77A00" }}><b>15</b> borderline</span>
                <span style={{ color: "#E2231A" }}><b>18</b> at risk</span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 16, paddingTop: 16, borderTop: "1px dashed #D6CDB7" }}>
            <Stat label="S:C in band" val="82%" /><Stat label="F:C in band" val="86%" /><Stat label="Reporting" val="151" />
          </div>
        </div>

        {/* KPI grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 14 }}>
          <Kpi label="Avg Cheese Diff" value="+3.2" sub="cases" />
          <Kpi label="Avg Sauce Diff" value="-1.4" sub="cases" />
          <Kpi label="Avg Flour Diff" value="+0.8" sub="bags" />
          <Kpi label="Avg Sauce:Cheese" value="94.2%" sub="Target: 75–125%" />
          <Kpi label="Avg Flour:Cheese" value="98.7%" sub="Target: 75–125%" />
          <Kpi label="Active Flags" value="47" icon={<Flag style={{ width: 14, height: 14, color: "#E2231A" }} />} />
        </div>
      </div>

      {/* Middle: Trend + Brand */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1.1fr", gap: 14, marginBottom: 14 }}>
        {/* Trend */}
        <Card title="Compliance Trend" meta="Last 8 weeks">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={TREND} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#E7DFCE" vertical={false} />
              <ReferenceArea y1={75} y2={100} fill="#E6F1EA" fillOpacity={0.5} />
              <ReferenceLine y={75} stroke="#2E7D4F" strokeDasharray="4 4" strokeWidth={1} />
              <XAxis dataKey="week" tickFormatter={(w) => `W${w}`} tick={{ fontSize: 10.5, fontFamily: "'JetBrains Mono'", fill: "#7A7670" }} axisLine={{ stroke: "#E7DFCE" }} tickLine={false} />
              <YAxis domain={[60, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10.5, fontFamily: "'JetBrains Mono'", fill: "#7A7670" }} axisLine={false} tickLine={false} />
              <Line type="monotone" dataKey="v" stroke="#E2231A" strokeWidth={2.5} dot={{ r: 4, fill: "white", stroke: "#E2231A", strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Brand */}
        <Card title="Brand Breakdown">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {BRANDS.map((b) => (
              <div key={b.brand}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
                  <span style={{ fontWeight: 500 }}>{b.brand}</span>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#7A7670" }}>{b.count} stores &middot; {b.pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, overflow: "hidden", background: "#F4ECDD" }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${b.pct}%`, background: b.color }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Bottom: AI + At-risk */}
      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1.6fr", gap: 14 }}>
        {/* AI */}
        <div style={{ borderRadius: 14, padding: 18, background: "radial-gradient(ellipse at top right, rgba(226,35,26,.06), transparent 60%), linear-gradient(180deg, #FFFDF8, #FBF6EC)", border: "1px solid #E7DFCE" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", padding: "4px 9px", borderRadius: 999, background: "linear-gradient(135deg, #1B1A17, #3a2c20)", color: "#F4ECDD" }}>
              <Sparkles style={{ width: 12, height: 12 }} />AI Insights
            </span>
          </div>
          <h4 style={{ margin: 0, fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400, letterSpacing: "-0.01em" }}>What should I focus on this week?</h4>
          <p style={{ color: "#4A4843", fontSize: 13.5, lineHeight: 1.55, margin: "8px 0 16px" }}>Generate an AI-powered summary of compliance patterns, anomalies, and recommended actions.</p>
          <button style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9, background: "#E2231A", border: "none", color: "white", fontSize: 13, fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 14px rgba(226,35,26,.25)" }}>
            <Sparkles style={{ width: 16, height: 16 }} />Generate insight
          </button>
        </div>

        {/* At-risk table */}
        <Card title="Stores Requiring Attention" action={<span style={{ color: "#E2231A", fontSize: 11.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>View all<ChevronRight style={{ width: 14, height: 14 }} /></span>}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                {["Store", "DSM", "Cheese Δ", "Sauce Δ", "S:C", "Status"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontWeight: 600, fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "#7A7670", padding: "10px 14px", borderBottom: "1px solid #E7DFCE" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STORES.filter((s) => s.st !== "ok").map((s) => (
                <tr key={s.code}>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 4, height: 32, borderRadius: 999, background: BC[s.brand] ?? "#7A7670" }} />
                      <div><div style={{ fontWeight: 500 }}>{s.code}</div><div style={{ fontSize: 11, color: "#7A7670" }}>{s.city}</div></div>
                    </div>
                  </td>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE", fontSize: 12.5 }}>{s.dsm}</td>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE" }}><Diff v={s.cd} /></td>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE" }}><Diff v={s.sd} /></td>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE" }}><Ratio v={s.sc} /></td>
                  <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE" }}><Pill s={s.st} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

/* ── All Stores ─────────────────────────────────────────────── */

function AllStores() {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 38, letterSpacing: "-0.015em", lineHeight: 1 }}>All Stores</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#7A7670" }}>View and compare performance across all franchise locations</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: 10, background: "white", border: "1px solid #E7DFCE", borderRadius: 10, marginBottom: 18, boxShadow: "0 1px 0 rgba(27,26,23,.04), 0 1px 2px rgba(27,26,23,.04)" }}>
        <Lbl>Week</Lbl><Sel options={["Week 15"]} />
        <Lbl>Brand</Lbl><Sel options={["All Brands"]} />
        <div style={{ marginLeft: "auto", display: "inline-flex", padding: 3, background: "#F4ECDD", borderRadius: 8, gap: 2 }}>
          {[["All", 151, true], ["At risk", 18, false], ["Borderline", 15, false], ["Compliant", 118, false]].map(([label, count, active]) => (
            <button key={label as string} style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12.5, fontWeight: 500, background: active ? "white" : "transparent", color: active ? "#1B1A17" : "#4A4843", boxShadow: active ? "0 1px 0 rgba(27,26,23,.04), 0 1px 2px rgba(27,26,23,.04)" : "none", border: "none", cursor: "pointer" }}>
              {label as string} <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#7A7670", marginLeft: 4 }}>{count as number}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ borderRadius: 14, background: "white", border: "1px solid #E7DFCE", boxShadow: "0 1px 0 rgba(27,26,23,.04), 0 1px 2px rgba(27,26,23,.04)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr>
              {["Store", "DSM", "Cheese Δ", "Sauce Δ", "Flour Δ", "S:C Ratio", "F:C Ratio", "Status", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", fontWeight: 600, fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "#7A7670", padding: "10px 14px", borderBottom: "1px solid #E7DFCE", background: "#FBF8F2" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STORES.map((s) => (
              <tr key={s.code} style={{ cursor: "default" }} onMouseEnter={(e) => { for (const td of e.currentTarget.children) (td as HTMLElement).style.background = "rgba(244,236,221,.4)"; }} onMouseLeave={(e) => { for (const td of e.currentTarget.children) (td as HTMLElement).style.background = ""; }}>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 4, height: 32, borderRadius: 999, background: BC[s.brand] ?? "#7A7670" }} />
                    <div><div style={{ fontWeight: 500 }}>{s.code}</div><div style={{ fontSize: 11, color: "#7A7670" }}>{s.city}</div></div>
                  </div>
                </td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE", fontSize: 12.5 }}>{s.dsm}</td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE", textAlign: "right" }}><Diff v={s.cd} /></td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE", textAlign: "right" }}><Diff v={s.sd} /></td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE", textAlign: "right" }}><Diff v={s.fd} u="bg" /></td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE", textAlign: "right" }}><Ratio v={s.sc} /></td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE", textAlign: "right" }}><Ratio v={s.fc} /></td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE" }}><Pill s={s.st} /></td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #E7DFCE" }}><ChevronRight style={{ width: 16, height: 16, color: "#7A7670" }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Shared pieces ──────────────────────────────────────────── */

function Donut({ value }: { value: number }) {
  const data = [{ v: value }, { v: 100 - value }];
  return (
    <div style={{ position: "relative", width: 132, height: 132, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart><Pie data={data} cx="50%" cy="50%" innerRadius={52} outerRadius={66} startAngle={90} endAngle={-270} dataKey="v" stroke="none"><Cell fill="#E2231A" /><Cell fill="#F4ECDD" /></Pie></PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 32, lineHeight: 1 }}>{value}%</span>
        <span style={{ fontSize: 11, marginTop: 4, color: "#7A7670" }}>Compliant</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 14, padding: "16px 18px", background: "white", border: "1px solid #E7DFCE", boxShadow: "0 1px 0 rgba(27,26,23,.04), 0 1px 2px rgba(27,26,23,.04)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#7A7670" }}>{label}</span>
      </div>
      <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 38, lineHeight: 1, letterSpacing: "-0.015em" }}>{value}</div>
      {sub && <span style={{ fontSize: 12, color: "#7A7670" }}>{sub}</span>}
    </div>
  );
}

function Card({ title, meta, action, children }: { title: string; meta?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 14, background: "white", border: "1px solid #E7DFCE", boxShadow: "0 1px 0 rgba(27,26,23,.04), 0 1px 2px rgba(27,26,23,.04)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #E7DFCE" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em" }}>{title}</h3>
        {meta && <span style={{ fontSize: 11.5, color: "#7A7670" }}>{meta}</span>}
        {action}
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}

function Stat({ label, val }: { label: string; val: string }) {
  return <div style={{ fontSize: 12 }}><span style={{ color: "#7A7670" }}>{label}</span><span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 500, marginLeft: 8 }}>{val}</span></div>;
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11.5, color: "#7A7670", letterSpacing: ".04em", textTransform: "uppercase", fontWeight: 600, padding: "0 6px 0 10px" }}>{children}</span>;
}

function Sel({ options }: { options: string[] }) {
  return (
    <select style={{ border: "1px solid #E7DFCE", background: "white", padding: "7px 12px", borderRadius: 8, fontSize: 12.5, color: "#1B1A17" }}>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

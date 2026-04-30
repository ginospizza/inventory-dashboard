"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ChevronRight, ChevronUp, ChevronDown, Search } from "lucide-react";
import { FilterBar, StatusPill, DiffCell, RatioCell } from "@/components/dashboard";
import type { AppUser, Flag, ComplianceStatus } from "@/lib/types";

type SortKey = "store" | "cheese_diff" | "sauce_diff" | "flour_diff" | "sauce_cheese_ratio" | "flour_cheese_ratio" | "overall_status";
type SortDir = "asc" | "desc";

interface StoreRow {
  store_id: string;
  store_code: string;
  cheese_diff: number;
  sauce_diff: number;
  flour_diff: number;
  sauce_cheese_ratio: number;
  flour_cheese_ratio: number;
  overall_status: string;
  flags: Flag[];
  stores: Record<string, unknown>;
}

interface StoresClientProps {
  user: AppUser;
  metrics: StoreRow[];
  weeks: number[];
  brands: string[];
  dsms: { id: string; name: string }[];
  statusCounts: { all: number; ok: number; warn: number; bad: number };
  statusFilter?: string;
}

const BRAND_COLORS: Record<string, string> = {
  GINOS: "#E2231A",
  TTD: "#0E5FAE",
  PP: "#7A2A2A",
  STORE: "#3D6644",
  DD: "#9C5B14",
  WM: "#7A2A2A",
  OTHER: "#7A7670",
};

export function StoresClient({
  user,
  metrics,
  weeks,
  brands,
  dsms,
  statusCounts,
  statusFilter,
}: StoresClientProps) {
  const [sortKey, setSortKey] = useState<SortKey>("overall_status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "overall_status" ? "asc" : "desc");
    }
  }

  const filtered = useMemo(() => {
    let result = [...metrics];

    // Status filter from URL params
    if (statusFilter && statusFilter !== "all") {
      result = result.filter((m) => m.overall_status === statusFilter);
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          (m.stores?.code as string)?.toLowerCase().includes(q) ||
          (m.stores?.city as string)?.toLowerCase().includes(q) ||
          (m.stores?.name as string)?.toLowerCase().includes(q)
      );
    }

    // Sort
    const statusOrder = { bad: 0, warn: 1, ok: 2 };
    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "store") {
        cmp = ((a.stores?.code as string) ?? "").localeCompare((b.stores?.code as string) ?? "");
      } else if (sortKey === "overall_status") {
        cmp =
          (statusOrder[a.overall_status as keyof typeof statusOrder] ?? 2) -
          (statusOrder[b.overall_status as keyof typeof statusOrder] ?? 2);
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [metrics, statusFilter, search, sortKey, sortDir]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between gap-5 mb-[22px]">
        <div>
          <h1 className="font-serif text-[38px] leading-none" style={{ letterSpacing: "-0.015em" }}>
            All Stores
          </h1>
          <p className="text-[13px] mt-[6px]" style={{ color: "var(--color-ink-3)" }}>
            View and compare performance across all franchise locations
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        user={user}
        weeks={weeks}
        brands={brands}
        dsms={dsms}
        statusCounts={statusCounts}
        showStatusFilter
      />

      {/* Search bar */}
      <div className="mb-3 flex items-center gap-2">
        <div
          className="flex items-center gap-2 px-3 py-[7px] bg-white rounded-lg"
          style={{ border: "1px solid var(--color-line)", fontSize: "12.5px" }}
        >
          <Search className="w-[14px] h-[14px]" style={{ color: "var(--color-ink-3)" }} />
          <input
            type="text"
            placeholder="Search by store code or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 outline-none bg-transparent text-[13px] w-[240px]"
            style={{ color: "var(--color-ink)" }}
          />
        </div>
        <span className="text-[12px] ml-auto" style={{ color: "var(--color-ink-3)" }}>
          {filtered.length} stores
        </span>
      </div>

      {/* Table */}
      <div
        className="rounded-[14px] bg-white overflow-hidden"
        style={{
          border: "1px solid var(--color-line)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <SortHeader label="Store" sortKey="store" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="DSM" sortKey="store" current={sortKey} dir={sortDir} onSort={handleSort} align="left" />
                <SortHeader label="Cheese Δ" sortKey="cheese_diff" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Sauce Δ" sortKey="sauce_diff" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Flour Δ" sortKey="flour_diff" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="S:C Ratio" sortKey="sauce_cheese_ratio" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="F:C Ratio" sortKey="flour_cheese_ratio" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Status" sortKey="overall_status" current={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="w-[40px]" style={{ borderBottom: "1px solid var(--color-line)" }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const store = m.stores;
                const brandColor = BRAND_COLORS[(store?.brand as string)] ?? "#7A7670";

                return (
                  <tr
                    key={m.store_id}
                    className="group cursor-default"
                  >
                    <td
                      className="px-[14px] py-[12px] group-hover:bg-[rgba(244,236,221,.4)]"
                      style={{ borderBottom: "1px solid var(--color-line)" }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-1 h-8 rounded-full"
                          style={{ background: brandColor }}
                        />
                        <div>
                          <Link
                            href={`/store/${m.store_id}`}
                            className="font-medium hover:underline"
                          >
                            {(store?.code as string) ?? "—"}
                          </Link>
                          <div className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                            {(store?.city as string) ?? ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td
                      className="px-[14px] py-[12px] group-hover:bg-[rgba(244,236,221,.4)]"
                      style={{ borderBottom: "1px solid var(--color-line)" }}
                    >
                      {(() => {
                        const dsms = store?.dsms as Record<string, unknown> | null;
                        return (
                          <>
                            <span className="text-[12.5px]">{(dsms?.name as string) ?? "—"}</span>
                            {dsms?.region && (
                              <div className="text-[10.5px]" style={{ color: "var(--color-ink-3)" }}>
                                {dsms.region as string}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-[14px] py-[12px] text-right group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <DiffCell value={m.cheese_diff} />
                    </td>
                    <td className="px-[14px] py-[12px] text-right group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <DiffCell value={m.sauce_diff} />
                    </td>
                    <td className="px-[14px] py-[12px] text-right group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <DiffCell value={m.flour_diff} unit="bg" />
                    </td>
                    <td className="px-[14px] py-[12px] text-right group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <RatioCell value={m.sauce_cheese_ratio} />
                    </td>
                    <td className="px-[14px] py-[12px] text-right group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <RatioCell value={m.flour_cheese_ratio} />
                    </td>
                    <td className="px-[14px] py-[12px] group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <StatusPill status={m.overall_status as ComplianceStatus} />
                    </td>
                    <td className="px-[14px] py-[12px] group-hover:bg-[rgba(244,236,221,.4)]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                      <Link href={`/store/${m.store_id}`}>
                        <ChevronRight className="w-4 h-4" style={{ color: "var(--color-ink-3)" }} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-[14px] py-10 text-center text-[13px]" style={{ color: "var(--color-ink-3)" }}>
                    No stores found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Sort header component ────────────────────────────────────

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = current === sortKey;

  return (
    <th
      onClick={() => onSort(sortKey)}
      className="cursor-default select-none"
      style={{
        textAlign: align,
        fontWeight: 600,
        fontSize: "11px",
        letterSpacing: ".06em",
        textTransform: "uppercase",
        color: "var(--color-ink-3)",
        padding: "10px 14px",
        borderBottom: "1px solid var(--color-line)",
        background: "var(--color-paper)",
      }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (
          dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        )}
      </span>
    </th>
  );
}

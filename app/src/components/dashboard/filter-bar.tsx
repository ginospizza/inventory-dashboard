"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { AppUser, ComplianceStatus } from "@/lib/types";

interface FilterBarProps {
  user: AppUser;
  weeks: number[];
  years?: number[];
  brands: string[];
  dsms: { id: string; name: string }[];
  statusCounts?: {
    all: number;
    ok: number;
    warn: number;
    bad: number;
  };
  showStatusFilter?: boolean;
}

export function FilterBar({
  user,
  weeks,
  years,
  brands,
  dsms,
  statusCounts,
  showStatusFilter = false,
}: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentWeek = searchParams.get("week") ?? "";
  const currentBrand = searchParams.get("brand") ?? "all";
  const currentDsm = searchParams.get("dsm") ?? "all";
  const currentStatus = searchParams.get("status") ?? "all";

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all" || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.push(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const isDsm = user.role === "dsm";

  return (
    <div
      className="flex items-center gap-2 flex-wrap p-[10px] bg-white rounded-[10px] mb-[18px]"
      style={{
        border: "1px solid var(--color-line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Year filter */}
      {years && years.length > 1 && (
        <>
          <FilterLabel>Year</FilterLabel>
          <select
            value={searchParams.get("year") ?? ""}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams.toString());
              if (e.target.value) {
                params.set("year", e.target.value);
              } else {
                params.delete("year");
              }
              params.delete("week"); // reset week when year changes
              router.push(`?${params.toString()}`);
            }}
            className="filter-select"
            style={selectStyle}
          >
            <option value="">{new Date().getFullYear()}</option>
            {years.filter(y => y !== new Date().getFullYear()).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </>
      )}

      {/* Week filter */}
      <FilterLabel>Week</FilterLabel>
      <select
        value={currentWeek}
        onChange={(e) => updateParam("week", e.target.value)}
        className="filter-select"
        style={selectStyle}
      >
        <option value="">Latest</option>
        {weeks.map((w) => (
          <option key={w} value={w}>
            Week {w}
          </option>
        ))}
      </select>

      {/* Brand filter */}
      <FilterLabel>Brand</FilterLabel>
      <select
        value={currentBrand}
        onChange={(e) => updateParam("brand", e.target.value)}
        className="filter-select"
        style={selectStyle}
      >
        <option value="all">All Brands</option>
        {brands.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>

      {/* DSM filter — admin only */}
      {!isDsm && (
        <>
          <FilterLabel>DSM</FilterLabel>
          <select
            value={currentDsm}
            onChange={(e) => updateParam("dsm", e.target.value)}
            className="filter-select"
            style={selectStyle}
          >
            <option value="all">All DSMs</option>
            {dsms.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </>
      )}

      {/* DSM locked pill for DSM users */}
      {isDsm && (
        <div
          className="flex items-center gap-[6px] px-3 py-[6px] rounded-full text-ginos-red bg-ginos-red-soft"
          style={{ fontSize: "12px", fontWeight: 600 }}
        >
          <span
            className="w-[6px] h-[6px] rounded-full bg-ginos-red"
          />
          {dsms.find((d) => d.id === user.dsm_id)?.name ?? "Your District"}
        </div>
      )}

      {/* Status segmented control */}
      {showStatusFilter && statusCounts && (
        <div className="ml-auto flex">
          <div
            className="inline-flex p-[3px] rounded-lg gap-[2px]"
            style={{ background: "var(--color-crust)" }}
          >
            {(
              [
                { key: "all", label: "All", count: statusCounts.all },
                { key: "bad", label: "At risk", count: statusCounts.bad },
                { key: "warn", label: "Borderline", count: statusCounts.warn },
                { key: "ok", label: "Compliant", count: statusCounts.ok },
              ] as const
            ).map((seg) => (
              <button
                key={seg.key}
                onClick={() => updateParam("status", seg.key)}
                className="px-3 py-[6px] rounded-[6px] transition-all duration-100"
                style={{
                  fontSize: "12.5px",
                  fontWeight: 500,
                  color:
                    currentStatus === seg.key
                      ? "var(--color-ink)"
                      : "var(--color-ink-2)",
                  background:
                    currentStatus === seg.key ? "white" : "transparent",
                  boxShadow:
                    currentStatus === seg.key ? "var(--shadow-sm)" : "none",
                  border: "none",
                  cursor: "default",
                }}
              >
                {seg.label}
                <span
                  className="ml-1.5 font-mono text-[11px]"
                  style={{ color: "var(--color-ink-3)" }}
                >
                  {seg.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="px-[6px] pl-[10px]"
      style={{
        fontSize: "11.5px",
        color: "var(--color-ink-3)",
        letterSpacing: ".04em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
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

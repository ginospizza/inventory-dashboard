import { diffStatus } from "@/lib/calculations";
import type { ComplianceStatus } from "@/lib/types";

interface DiffCellProps {
  value: number;
  unit?: string; // "cs" for cases, "bg" for bags
}

const STATUS_COLORS: Record<ComplianceStatus, string> = {
  ok: "var(--color-basil)",
  warn: "var(--color-mustard)",
  bad: "var(--color-ginos-red)",
};

export function DiffCell({ value, unit = "cs" }: DiffCellProps) {
  const status = diffStatus(value);
  const sign = value > 0 ? "+" : "";
  const color = STATUS_COLORS[status];

  return (
    <span
      className="font-mono tnum whitespace-nowrap"
      style={{
        color,
        fontSize: "13px",
        fontWeight: 500,
      }}
    >
      {sign}
      {value.toFixed(1)}
      <span
        style={{
          color: "var(--color-ink-3)",
          fontSize: "11px",
          marginLeft: "2px",
        }}
      >
        {unit}
      </span>
    </span>
  );
}

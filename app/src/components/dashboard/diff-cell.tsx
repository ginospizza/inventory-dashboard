import { diffStatus } from "@/lib/calculations";
import { STATUS_COLOR } from "@/lib/types";

interface DiffCellProps {
  value: number;
  unit?: string; // "cs" for cases, "bg" for bags
}

export function DiffCell({ value, unit = "cs" }: DiffCellProps) {
  const status = diffStatus(value);
  const sign = value > 0 ? "+" : "";
  const color = STATUS_COLOR[status];

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

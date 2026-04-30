import { ratioStatus } from "@/lib/calculations";
import type { ComplianceStatus } from "@/lib/types";

interface RatioCellProps {
  value: number; // decimal, e.g. 0.878
}

const STATUS_COLORS: Record<ComplianceStatus, string> = {
  ok: "var(--color-basil)",
  warn: "var(--color-mustard)",
  bad: "var(--color-ginos-red)",
};

export function RatioCell({ value }: RatioCellProps) {
  const status = ratioStatus(value);
  const pct = (value * 100).toFixed(1);

  return (
    <span
      className="font-mono tnum"
      style={{
        color: STATUS_COLORS[status],
        fontSize: "13px",
        fontWeight: 500,
      }}
    >
      {pct}%
    </span>
  );
}

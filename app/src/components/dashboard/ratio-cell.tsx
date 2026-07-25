import { ratioStatus } from "@/lib/calculations";
import { STATUS_COLOR } from "@/lib/types";

interface RatioCellProps {
  value: number; // decimal, e.g. 0.878
}

export function RatioCell({ value }: RatioCellProps) {
  const status = ratioStatus(value);
  const pct = (value * 100).toFixed(1);

  return (
    <span
      className="font-mono tnum"
      style={{
        color: STATUS_COLOR[status],
        fontSize: "13px",
        fontWeight: 500,
      }}
    >
      {pct}%
    </span>
  );
}

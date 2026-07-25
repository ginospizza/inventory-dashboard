import type { ComplianceStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StatusPillProps {
  status: ComplianceStatus;
  className?: string;
}

// Compliant / Borderline / At Risk are soft-tinted pills. Severe is the only
// SOLID one — a fourth tint of red would have read as a shade of At Risk rather
// than an escalation past it, and the whole point of the tier (James, July 22
// 2026) is that the urgent handful stands out from a long At Risk list.
const STATUS_CONFIG: Record<ComplianceStatus, { bg: string; text: string }> = {
  ok: {
    bg: "var(--color-basil-soft)",
    text: "var(--color-basil)",
  },
  warn: {
    bg: "var(--color-mustard-soft)",
    text: "var(--color-mustard)",
  },
  bad: {
    bg: "var(--color-ginos-red-soft)",
    text: "var(--color-ginos-red)",
  },
  severe: {
    bg: "var(--color-ginos-red-deep)",
    text: "#FFFFFF",
  },
};

export function StatusPill({ status, className }: StatusPillProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] px-[8px] py-[3px] rounded-full whitespace-nowrap",
        className
      )}
      style={{
        background: config.bg,
        color: config.text,
        fontSize: "11.5px",
        fontWeight: 600,
        letterSpacing: "-0.005em",
        lineHeight: 1.4,
      }}
    >
      <span
        className="w-[6px] h-[6px] rounded-full"
        style={{ background: "currentColor" }}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

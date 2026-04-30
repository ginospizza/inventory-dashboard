import type { ComplianceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StatusPillProps {
  status: ComplianceStatus;
  className?: string;
}

const STATUS_CONFIG: Record<
  ComplianceStatus,
  { label: string; bg: string; text: string }
> = {
  ok: {
    label: "In compliance",
    bg: "var(--color-basil-soft)",
    text: "var(--color-basil)",
  },
  warn: {
    label: "Borderline",
    bg: "var(--color-mustard-soft)",
    text: "var(--color-mustard)",
  },
  bad: {
    label: "Out of compliance",
    bg: "var(--color-ginos-red-soft)",
    text: "var(--color-ginos-red)",
  },
};

export function StatusPill({ status, className }: StatusPillProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[6px] px-[9px] py-[3px] rounded-full",
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
      {config.label}
    </span>
  );
}

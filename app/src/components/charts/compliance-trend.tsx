"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import type { WeeklyTrend } from "@/lib/types";

interface ComplianceTrendProps {
  data: WeeklyTrend[];
  height?: number;
}

export function ComplianceTrend({ data, height = 240 }: ComplianceTrendProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
        <CartesianGrid
          strokeDasharray="4 4"
          stroke="var(--color-line)"
          vertical={false}
        />
        <ReferenceArea
          y1={75}
          y2={100}
          fill="var(--color-basil-soft)"
          fillOpacity={0.5}
        />
        <ReferenceLine
          y={75}
          stroke="var(--color-basil)"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        <XAxis
          dataKey="week"
          tickFormatter={(w) => `W${w}`}
          tick={{
            fontSize: 10.5,
            fontFamily: "'JetBrains Mono', monospace",
            fill: "var(--color-ink-3)",
          }}
          axisLine={{ stroke: "var(--color-line)" }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{
            fontSize: 10.5,
            fontFamily: "'JetBrains Mono', monospace",
            fill: "var(--color-ink-3)",
          }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "white",
            border: "1px solid var(--color-line)",
            borderRadius: "10px",
            boxShadow: "var(--shadow-md)",
            fontSize: "12px",
          }}
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Compliance"]}
          labelFormatter={(label) => `Week ${label}`}
        />
        <Line
          type="monotone"
          dataKey="compliance_pct"
          stroke="var(--color-ginos-red)"
          strokeWidth={2.5}
          dot={{
            r: 4,
            fill: "white",
            stroke: "var(--color-ginos-red)",
            strokeWidth: 2,
          }}
          activeDot={{
            r: 6,
            fill: "var(--color-ginos-red)",
            stroke: "white",
            strokeWidth: 2,
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

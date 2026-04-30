"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface DonutChartProps {
  value: number; // 0-100 percentage
  size?: number;
  strokeWidth?: number;
}

export function DonutChart({ value, size = 132, strokeWidth = 14 }: DonutChartProps) {
  const data = [
    { name: "filled", value: value },
    { name: "empty", value: 100 - value },
  ];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={size / 2 - strokeWidth}
            outerRadius={size / 2}
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            stroke="none"
          >
            <Cell fill="var(--color-ginos-red)" />
            <Cell fill="var(--color-crust)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-[32px] leading-none" style={{ letterSpacing: "-0.015em" }}>
          {Math.round(value)}%
        </span>
        <span className="text-[11px] mt-1" style={{ color: "var(--color-ink-3)" }}>
          Compliant
        </span>
      </div>
    </div>
  );
}

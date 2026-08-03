import { describe, it, expect } from "vitest";
import { resolveWindow } from "../display-window";

/**
 * James, July 31 2026: individual weeks keep the 6-week window; Q1..Q4 / YTD /
 * All display the average of the WHOLE period, "rather than just the last 6
 * weeks of it".
 */

// Newest-first series, like the store page builds: 2026 weeks 29..1.
const series = Array.from({ length: 29 }, (_, i) => ({
  year: 2026,
  week_number: 29 - i,
}));

describe("resolveWindow — Period filter to display window", () => {
  it("Latest anchors a 6-week window on the newest row", () => {
    const w = resolveWindow(series, undefined, 2026, 6);
    expect(w).toMatchObject({ start: 0, count: 6 });
    expect(w.label).toBe("6-wk avg");
  });

  it("an individual week keeps the 6-week rolling window — James's explicit carve-out", () => {
    const w = resolveWindow(series, "24", 2026, 6);
    expect(series[w.start].week_number).toBe(24);
    expect(w.count).toBe(6); // weeks 24..19
    expect(w.label).toBe("6-wk avg");
  });

  it("a quarter covers the whole quarter, not its last 6 weeks", () => {
    const w = resolveWindow(series, "q1", 2026, 6);
    expect(series[w.start].week_number).toBe(13);
    expect(w.count).toBe(13); // weeks 13..1
    expect(w.label).toBe("Q1 avg · 13 wks");
  });

  it("a partial quarter covers only the weeks that exist", () => {
    const w = resolveWindow(series, "q3", 2026, 6); // data stops at wk 29
    expect(series[w.start].week_number).toBe(29);
    expect(w.count).toBe(3); // weeks 29, 28, 27
    expect(w.label).toBe("Q3 avg · 3 wks");
  });

  it("YTD covers every week of the year", () => {
    const w = resolveWindow(series, "ytd", 2026, 6);
    expect(w.start).toBe(0);
    expect(w.count).toBe(29);
    expect(w.label).toBe("YTD avg · 29 wks");
  });

  it("All Weeks covers the year and labels it by year", () => {
    const w = resolveWindow(series, "all", 2026, 6);
    expect(w.count).toBe(29);
    expect(w.label).toBe("2026 avg · 29 wks");
  });

  it("a week near the end of the data clamps the rolling count", () => {
    const w = resolveWindow(series, "3", 2026, 6);
    expect(series[w.start].week_number).toBe(3);
    expect(w.count).toBe(3); // weeks 3, 2, 1 — only 3 rows left
    expect(w.label).toBe("3-wk avg");
  });

  it("a quarter with no data falls back to the newest rolling window", () => {
    const w = resolveWindow(series, "q4", 2026, 6);
    expect(w).toMatchObject({ start: 0, count: 6 });
  });

  it("gap-tolerant: quarter windows follow the rows, not week arithmetic", () => {
    // Weeks 13..1 with week 7 missing — Q1 should cover the 12 present rows.
    const gappy = series.filter((m) => m.week_number <= 13 && m.week_number !== 7);
    const w = resolveWindow(gappy, "q1", 2026, 6);
    expect(w.count).toBe(12);
  });

  it("a different selected year with no rows falls back safely", () => {
    const w = resolveWindow(series, "q1", 2025, 6);
    expect(w).toMatchObject({ start: 0, count: 6 });
  });
});

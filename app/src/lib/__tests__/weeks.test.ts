import { describe, it, expect } from "vitest";
import { mondayOfWeek, weekMondayLabel, weekWithDate } from "../weeks";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("mondayOfWeek — first-Monday-of-January convention", () => {
  it("matches the one datapoint James gave us: WK27 2026 = 07/06", () => {
    // From his July 22 screenshot of the week filter. This is the anchor that
    // decides the convention — ISO weeks would say 2026-06-29 instead.
    expect(weekMondayLabel(2026, 27)).toBe("07/06");
    expect(iso(mondayOfWeek(2026, 27))).toBe("2026-07-06");
  });

  it("starts 2026 on Jan 5 (Jan 1 is a Thursday)", () => {
    expect(iso(mondayOfWeek(2026, 1))).toBe("2026-01-05");
  });

  it("starts 2025 on Jan 6 (Jan 1 is a Wednesday)", () => {
    expect(iso(mondayOfWeek(2025, 1))).toBe("2025-01-06");
  });

  it("always lands on a Monday, every week of both loaded years", () => {
    for (const year of [2025, 2026]) {
      for (let w = 1; w <= 52; w++) {
        expect(mondayOfWeek(year, w).getUTCDay()).toBe(1);
      }
    }
  });

  it("advances exactly 7 days per week", () => {
    const a = mondayOfWeek(2026, 10).getTime();
    const b = mondayOfWeek(2026, 11).getTime();
    expect(b - a).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("handles a year that begins ON a Monday without skipping a week", () => {
    // 2029-01-01 is a Monday, so week 1 must be Jan 1 itself, not Jan 8.
    expect(iso(mondayOfWeek(2029, 1))).toBe("2029-01-01");
  });

  it("is timezone-stable (computed in UTC, not local time)", () => {
    // A local-time implementation would drift by a day west of Greenwich.
    expect(mondayOfWeek(2026, 27).getUTCHours()).toBe(0);
  });

  it("formats the combined week+date label", () => {
    expect(weekWithDate(2026, 27)).toBe("Wk 27 · 07/06");
  });
});

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

  // James, July 31 2026: "Our system goes Monday to Sunday and lists the last
  // week of the year as 52, and the remainder of that week as 0, and begins week
  // 1 from the first Monday of the year." These three cases are checked against
  // the actual sheet names in 2025 raw data for Gloo.xlsx.
  describe("week 0 and week 52, per James's confirmed convention", () => {
    it("week 1 of 2025 is Jan 6 — sheet 'Export Data Jan 6 - 10'", () => {
      expect(iso(mondayOfWeek(2025, 1))).toBe("2025-01-06");
    });

    it("week 52 of 2025 is Dec 29 — sheet 'Dec 29 - Jan 4'", () => {
      expect(iso(mondayOfWeek(2025, 52))).toBe("2025-12-29");
    });

    it("week 0 of 2025 is Dec 30 2024 — sheet 'Export Data Dec 30 - Jan 5'", () => {
      // Week 0 is the leftover Monday-week between week 52 of the prior year and
      // week 1 of this one. firstMonday - 7 gives it with no special case.
      expect(iso(mondayOfWeek(2025, 0))).toBe("2024-12-30");
      expect(weekMondayLabel(2025, 0)).toBe("12/30");
    });

    it("week 0 sits exactly one week before week 1, and is still a Monday", () => {
      for (const year of [2025, 2026, 2027]) {
        const wk0 = mondayOfWeek(year, 0);
        const wk1 = mondayOfWeek(year, 1);
        expect(wk0.getUTCDay()).toBe(1);
        expect(wk1.getTime() - wk0.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
      }
    });

    it("week 52 never overlaps the next year's week 1", () => {
      // If it did, the numbering would double-count a week somewhere.
      for (const year of [2025, 2026, 2027, 2028, 2029]) {
        const wk52 = mondayOfWeek(year, 52);
        const nextWk1 = mondayOfWeek(year + 1, 1);
        expect(wk52.getTime()).toBeLessThan(nextWk1.getTime());
      }
    });
  });
});

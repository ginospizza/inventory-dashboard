import { describe, it, expect } from "vitest";
import { parsePeriod, availableQuarters, summariseStores } from "../compare-period";

describe("parsePeriod", () => {
  it("accepts week numbers and quarters, falls back otherwise", () => {
    expect(parsePeriod("37", 1)).toBe(37);
    expect(parsePeriod("q3", 1)).toBe("q3");
    expect(parsePeriod("Q2", 1)).toBe("q2");
    expect(parsePeriod(undefined, 38)).toBe(38);
    expect(parsePeriod("q5", 38)).toBe(38);
    expect(parsePeriod("-2", 38)).toBe(38);
  });
});

describe("availableQuarters", () => {
  it("lists only quarters with data, labelled with the weeks present", () => {
    const weeks = [38, 37, 36, 30, 27, 26, 14, 13, 1];
    expect(availableQuarters(weeks)).toEqual([
      { value: "q1", label: "Q1 · Wk 1–13" },
      { value: "q2", label: "Q2 · Wk 14–26" },
      { value: "q3", label: "Q3 · Wk 27–38" },
    ]);
  });

  it("labels a single-week quarter without a range", () => {
    expect(availableQuarters([40])).toEqual([{ value: "q4", label: "Q4 · Wk 40" }]);
  });
});

describe("summariseStores", () => {
  const row = (store_id: string, cheese_diff: number, overall_status: string) =>
    ({ store_id, cheese_diff, sauce_diff: 0, sauce_cheese_ratio: 1, overall_status });

  it("averages a store's weeks and takes its most common status", () => {
    const s = summariseStores([row("a", 1, "ok"), row("a", 3, "ok"), row("a", 5, "bad")]).get("a")!;
    expect(s.cheese_diff).toBe(3);
    expect(s.status).toBe("ok");
  });

  it("breaks a status tie toward the worse status", () => {
    expect(summariseStores([row("a", 0, "ok"), row("a", 0, "severe")]).get("a")!.status).toBe("severe");
  });

  it("a single week is that week unchanged", () => {
    const s = summariseStores([row("b", -1.4, "warn")]).get("b")!;
    expect(s).toEqual({ cheese_diff: -1.4, sauce_diff: 0, sc_ratio: 1, status: "warn" });
  });
});

import { describe, it, expect } from "vitest";
import { rangeWeeks } from "../data-access";

describe("rangeWeeks — Secondary Products / Boxes time ranges", () => {
  it("Last Week is just the anchor week", () => {
    expect(rangeWeeks("last_week", 28)).toEqual([28, 28]);
  });

  it("Last 4 Weeks is the anchor plus the three before it", () => {
    expect(rangeWeeks("last_4_weeks", 28)).toEqual([25, 28]);
  });

  it("clamps Last 4 Weeks at week 1 instead of going negative", () => {
    expect(rangeWeeks("last_4_weeks", 2)).toEqual([1, 2]);
    expect(rangeWeeks("last_4_weeks", 1)).toEqual([1, 1]);
  });

  it("uses fixed calendar bounds for quarters, ignoring the anchor", () => {
    expect(rangeWeeks("q1", 28)).toEqual([1, 13]);
    expect(rangeWeeks("q2", 28)).toEqual([14, 26]);
    expect(rangeWeeks("q3", 5)).toEqual([27, 39]);
    expect(rangeWeeks("q4", 5)).toEqual([40, 52]);
  });
});

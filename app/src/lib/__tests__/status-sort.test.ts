import { describe, it, expect } from "vitest";
import { statusRank } from "../types";

/**
 * The All Stores list sorts by severity with the worst tier first in its default
 * ("asc") direction, i.e. DESCENDING by statusRank.
 *
 * This is guarded because the same defect has now appeared three times: a local
 * `{ bad: 0, warn: 1, ok: 2 }` map with a `?? 2` fallback, which silently gives
 * any unrecognised status the same rank as "ok". James found the third instance
 * on July 31 2026: "on the main All Stores page, Severe is mixed in Compliant.
 * It should be ranked above At Risk."
 */
const compareForStoresList = (a: string, b: string) => statusRank(b) - statusRank(a);

describe("All Stores severity ordering", () => {
  it("ranks Severe above At Risk, and never alongside Compliant", () => {
    const sorted = ["ok", "bad", "severe", "warn", "ok"].sort(compareForStoresList);
    expect(sorted).toEqual(["severe", "bad", "warn", "ok", "ok"]);
  });

  it("puts Severe strictly first", () => {
    expect(["ok", "warn", "bad", "severe"].sort(compareForStoresList)[0]).toBe("severe");
  });

  it("does not group Severe with Compliant — the reported symptom", () => {
    // The old map returned 2 for BOTH "ok" and "severe", so they tied and fell
    // back to input order, interleaving them.
    expect(statusRank("severe")).not.toBe(statusRank("ok"));
    expect(statusRank("severe")).toBeGreaterThan(statusRank("bad"));
  });

  it("sorts an unrecognised status as worst rather than best", () => {
    expect(["ok", "mystery"].sort(compareForStoresList)[0]).toBe("mystery");
  });
});

/**
 * Store-code normalization and ignore rules — shared by the historical
 * importer and the self-serve upload route. If these drift, uploads create
 * duplicate stores next to the canonical ones.
 */

import { describe, it, expect } from "vitest";
import { normalizeStoreCode, preferCanonicalStore, shouldIgnoreStore } from "../stores";

describe("normalizeStoreCode", () => {
  it("strips OLD/NEW suffixes and collapses whitespace", () => {
    expect(normalizeStoreCode("GINOS002 NEW")).toBe("GINOS002");
    expect(normalizeStoreCode("TTD HESPELER NEW")).toBe("TTD HESPELER");
    expect(normalizeStoreCode("STORE 015OLD2")).toBe("STORE 015");
    expect(normalizeStoreCode("  ttd   blockline ")).toBe("TTD BLOCKLINE");
  });

  it("leaves canonical codes unchanged", () => {
    expect(normalizeStoreCode("GINOS103")).toBe("GINOS103");
    expect(normalizeStoreCode("PP/WM51 GINOS078")).toBe("PP/WM51 GINOS078");
    expect(normalizeStoreCode("WM3/PP11 GINOS097")).toBe("WM3/PP11 GINOS097");
  });
});

describe("shouldIgnoreStore", () => {
  it("ignores head offices, wholesalers, and summary rows", () => {
    expect(shouldIgnoreStore("SAPUTO")).toBe(true);
    expect(shouldIgnoreStore("SUNDRY")).toBe(true);
    expect(shouldIgnoreStore("GRAND TOTAL")).toBe(true);
    expect(shouldIgnoreStore("GINOS HEAD OFFICE")).toBe(true);
    expect(shouldIgnoreStore("SKYBLUE WHOLESALE")).toBe(true);
  });

  it("ignores anything without a brand prefix", () => {
    expect(shouldIgnoreStore("RANDOM CUSTOMER")).toBe(true);
  });

  it("keeps real stores across all brands", () => {
    expect(shouldIgnoreStore("GINOS103")).toBe(false);
    expect(shouldIgnoreStore("TTD ACTON")).toBe(false);
    expect(shouldIgnoreStore("STORE 055")).toBe(false);
    expect(shouldIgnoreStore("PP/WM51 GINOS078")).toBe(false);
    expect(shouldIgnoreStore("WM3/PP11 GINOS097")).toBe(false);
    expect(shouldIgnoreStore("DD01")).toBe(false);
  });

  it("counts TTD Woolwich Head Office as a real store (James, July 9 2026)", () => {
    // It went back to being a functioning corporate-operated store in 2026,
    // distinct from the un-ignored "TTD WOOLWICH" store proper.
    expect(shouldIgnoreStore("TTD WOOLWICH HEAD OFFICE")).toBe(false);
    expect(shouldIgnoreStore("TTD WOOLWICH")).toBe(false);
  });

  it("still ignores the other named head offices", () => {
    expect(shouldIgnoreStore("TWICE THE DEAL HEAD OFFICE")).toBe(true);
    expect(shouldIgnoreStore("DOUBLE DOUBLE PIZZA CHICKEN HEAD OFFICE")).toBe(true);
  });
});

// ── The July 31 2026 duplicate-store fixes ───────────────────
describe("normalizeStoreCode — internal space in GINOS codes", () => {
  it("collapses 'GINOS 005' to 'GINOS005' — James's Unassigned duplicate", () => {
    expect(normalizeStoreCode("GINOS 005")).toBe("GINOS005");
    expect(normalizeStoreCode("GINOS 009")).toBe("GINOS009");
    expect(normalizeStoreCode("GINOS 065")).toBe("GINOS065");
  });

  it("combines with suffix stripping", () => {
    expect(normalizeStoreCode("GINOS 005 OLD")).toBe("GINOS005");
    expect(normalizeStoreCode("ginos 176 old2")).toBe("GINOS176");
  });

  it("leaves legitimately-spaced codes alone", () => {
    // STORE nnn is the canonical form WITH the space; TTD codes are city names;
    // PP/WM compounds carry spaces by design.
    expect(normalizeStoreCode("STORE 015")).toBe("STORE 015");
    expect(normalizeStoreCode("TTD NEW HAMBURG NEW")).toBe("TTD NEW HAMBURG");
    expect(normalizeStoreCode("PP/WM14 WM081")).toBe("PP/WM14 WM081");
    expect(normalizeStoreCode("STORE 004 WM101")).toBe("STORE 004 WM101");
  });

  it("does not touch GINOS codes followed by non-digits", () => {
    expect(normalizeStoreCode("GINOS HEAD OFFICE")).toBe("GINOS HEAD OFFICE");
  });
});

describe("preferCanonicalStore — which duplicate row receives upload data", () => {
  const store = (code: string, dsm_id: string | null = null) => ({ code, dsm_id });

  it("prefers the row whose code IS the normalized key", () => {
    // The GINOS176 case: uploads must attach to the canonical row, not the
    // 'OLD2' orphan that used to win by table order.
    const winner = preferCanonicalStore(store("GINOS176 OLD2"), store("GINOS176", "dsm-raj"), "GINOS176");
    expect(winner.code).toBe("GINOS176");
    // Same result regardless of which row the DB returned first.
    const winner2 = preferCanonicalStore(store("GINOS176", "dsm-raj"), store("GINOS176 OLD2"), "GINOS176");
    expect(winner2.code).toBe("GINOS176");
  });

  it("falls back to the row with a DSM when neither code is exact", () => {
    const winner = preferCanonicalStore(store("GINOS 005"), store("GINOS005 OLD", "dsm-paul"), "GINOS005");
    expect(winner.code).toBe("GINOS005 OLD");
  });

  it("keeps the incumbent when nothing distinguishes them", () => {
    const a = store("GINOS159 OLD");
    expect(preferCanonicalStore(a, store("GINOS159 OLD2"), "GINOS159")).toBe(a);
  });

  it("returns the candidate when there is no incumbent", () => {
    const c = store("GINOS176");
    expect(preferCanonicalStore(undefined, c, "GINOS176")).toBe(c);
  });
});

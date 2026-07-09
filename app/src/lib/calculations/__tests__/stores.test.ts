/**
 * Store-code normalization and ignore rules — shared by the historical
 * importer and the self-serve upload route. If these drift, uploads create
 * duplicate stores next to the canonical ones.
 */

import { describe, it, expect } from "vitest";
import { normalizeStoreCode, shouldIgnoreStore } from "../stores";

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
});

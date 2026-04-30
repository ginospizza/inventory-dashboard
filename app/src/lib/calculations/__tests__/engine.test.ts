/**
 * Tests for the Gino's compliance calculation engine (v2: Brand-Aware).
 *
 * Validates Flour stores (GINOS/TTD) and Dough stores (DD/WM) paths.
 * Box ratios confirmed by James on April 28, 2026.
 */

import { describe, it, expect } from "vitest";
import {
  estimatedCheeseOz,
  estimatedSauceFloz,
  estimatedDoughKg,
  estimatedFlourKg,
  cheeseDiff,
  sauceDiff,
  flourDiff,
  doughDiff,
  sauceCheeseRatio,
  flourCheeseRatio,
  doughCheeseRatio,
  diffStatus,
  ratioStatus,
  overallStatus,
  computeWeeklyMetrics,
  generateFlags,
  detectBrand,
  defaultStoreType,
} from "../engine";

import { FLOUR_YIELD_FACTOR, BOX_RATIOS, BOXES_PER_CASE } from "../constants";
import type { Product, RawOrderRow, WeeklyMetrics } from "@/lib/types";

// ── Helper to build aggregates for testing ───────────────────

function makeAgg(opts: {
  cheese_oz?: number;
  sauce_floz?: number;
  flour_kg?: number;
  dough_kg?: number;
  small?: number;
  medium?: number;
  large?: number;
  xl?: number;
  party_20?: number;
  party_21x15?: number;
  clamshell?: number;
  cheese_by_sku?: Map<string, { qty: number; weight_kg: number }>;
  dough_by_sku?: Map<string, { qty: number; weight_kg: number }>;
}) {
  return {
    store_code: "TEST",
    week_number: 1,
    year: 2026,
    cheese_by_sku: opts.cheese_by_sku ?? new Map(),
    total_cheese_oz: opts.cheese_oz ?? 0,
    total_sauce_floz: opts.sauce_floz ?? 0,
    total_flour_kg: opts.flour_kg ?? 0,
    dough_by_sku: opts.dough_by_sku ?? new Map(),
    total_dough_kg: opts.dough_kg ?? 0,
    boxes_small: opts.small ?? 0,
    boxes_medium: opts.medium ?? 0,
    boxes_large: opts.large ?? 0,
    boxes_xl: opts.xl ?? 0,
    boxes_party_20: opts.party_20 ?? 0,
    boxes_party_21x15: opts.party_21x15 ?? 0,
    boxes_clamshell: opts.clamshell ?? 0,
    wing_boxes: 0,
  };
}

// ── G27 sample data (Flour store, no clamshells) ─────────────
// IQF 2x5KG Cheese (10kg) = 140 cases
// V Food Sauce = 47 cases
// V Food Flour = 106 bags
// Party=5, XL=29, Large=36, Medium=26, Small=5

const G27 = {
  cheese_oz: 140 * 10 * 35.27,       // 49378 oz
  sauce_floz: 47 * 6 * 2.84 * 33.814, // ~27080.96
  flour_kg: 106 * 20,                 // 2120 kg
  party_21x15: 5, xl: 29, large: 36, medium: 26, small: 5,
};

// G27 uses T010316 = TTD 15x21 Party Box -> party_21x15 (20oz/13oz/1.5kg)
const G27_EST_CHEESE =
  5 * 40 * 20 + 29 * 40 * 10 + 36 * 40 * 8 + 26 * 40 * 6 + 5 * 40 * 4;
const G27_EST_SAUCE =
  5 * 40 * 13 + 29 * 40 * 6 + 36 * 40 * 5 + 26 * 40 * 4 + 5 * 40 * 2.5;
const G27_EST_DOUGH =
  5 * 40 * 1.5 + 29 * 40 * 0.775 + 36 * 40 * 0.6 + 26 * 40 * 0.45 + 5 * 40 * 0.3;
const G27_EST_FLOUR = G27_EST_DOUGH / 1.6;

// ── Estimated usage tests ────────────────────────────────────

describe("Estimated cheese (no clamshell)", () => {
  it("matches G27", () => {
    const agg = makeAgg(G27);
    expect(estimatedCheeseOz(agg, false)).toBeCloseTo(G27_EST_CHEESE, 0);
  });

  it("returns 0 with no boxes", () => {
    expect(estimatedCheeseOz(makeAgg({}), false)).toBe(0);
  });
});

describe("Estimated cheese (with clamshell)", () => {
  it("adds clamshell contribution for GINOS stores", () => {
    const agg = makeAgg({ large: 10, clamshell: 5 });
    const withoutClam = estimatedCheeseOz(agg, false);
    const withClam = estimatedCheeseOz(agg, true);
    const clamContrib = 5 * BOXES_PER_CASE * BOX_RATIOS.clamshell.cheese_oz;
    expect(withClam - withoutClam).toBeCloseTo(clamContrib, 2);
  });
});

describe("Estimated sauce", () => {
  it("matches G27", () => {
    const agg = makeAgg(G27);
    expect(estimatedSauceFloz(agg, false)).toBeCloseTo(G27_EST_SAUCE, 0);
  });
});

describe("Estimated dough (direct)", () => {
  it("matches G27", () => {
    const agg = makeAgg(G27);
    expect(estimatedDoughKg(agg, false)).toBeCloseTo(G27_EST_DOUGH, 1);
  });
});

describe("Estimated flour (Flour stores)", () => {
  it("equals estimated dough / 1.6", () => {
    const agg = makeAgg(G27);
    expect(estimatedFlourKg(agg, false)).toBeCloseTo(G27_EST_FLOUR, 1);
  });
});

describe("Party 21x15 box ratios", () => {
  it("uses 20oz cheese, 13oz sauce, 1.5kg dough", () => {
    const agg = makeAgg({ party_21x15: 1 });
    expect(estimatedCheeseOz(agg, false)).toBe(1 * 40 * 20);
    expect(estimatedSauceFloz(agg, false)).toBe(1 * 40 * 13);
    expect(estimatedDoughKg(agg, false)).toBe(1 * 40 * 1.5);
  });
});

// ── Diff tests ───────────────────────────────────────────────

describe("Cheese diff", () => {
  it("uses dominant cheese SKU weight as divisor", () => {
    const agg = makeAgg({
      cheese_oz: G27.cheese_oz,
      cheese_by_sku: new Map([["20103", { qty: 140, weight_kg: 10 }]]),
      ...G27,
    });
    const est = estimatedCheeseOz(agg, false);
    const result = cheeseDiff(agg, est);
    expect(result).toBeCloseTo((G27.cheese_oz - G27_EST_CHEESE) / (10 * 35.27), 1);
  });

  it("uses 24kg divisor for Gold Cheese", () => {
    const oz = 25 * 24 * 35.27;
    const agg = makeAgg({
      cheese_oz: oz,
      cheese_by_sku: new Map([["T020111", { qty: 25, weight_kg: 24 }]]),
      large: 10,
    });
    const est = estimatedCheeseOz(agg, false);
    expect(cheeseDiff(agg, est)).toBeCloseTo((oz - est) / (24 * 35.27), 1);
  });
});

describe("Flour diff (Flour stores)", () => {
  it("divides by 20 (bag weight)", () => {
    expect(flourDiff(2120, G27_EST_FLOUR)).toBeCloseTo((2120 - G27_EST_FLOUR) / 20, 1);
  });
});

describe("Dough diff (Dough stores)", () => {
  it("uses dominant dough SKU case weight as divisor", () => {
    // DD store ordering Large Dough PT (36x550 = 19.8kg/case), 10 cases
    const totalDough = 10 * 19.8;
    const agg = makeAgg({
      dough_kg: totalDough,
      dough_by_sku: new Map([["50122", { qty: 10, weight_kg: 19.8 }]]),
      large: 5,
    });
    const estDough = estimatedDoughKg(agg, false);
    const result = doughDiff(agg, estDough);
    expect(result).toBeCloseTo((totalDough - estDough) / 19.8, 1);
  });
});

// ── Ratio tests ──────────────────────────────────────────────

describe("Sauce:Cheese ratio", () => {
  it("matches G27", () => {
    const expected = (G27.sauce_floz / 5) / (G27.cheese_oz / 8);
    expect(sauceCheeseRatio(G27.sauce_floz, G27.cheese_oz)).toBeCloseTo(expected, 3);
  });

  it("returns 0 with no cheese", () => {
    expect(sauceCheeseRatio(1000, 0)).toBe(0);
  });
});

describe("Flour:Cheese ratio (Flour stores)", () => {
  it("uses flour * 1.6 / 0.6 formula", () => {
    const expected = (G27.flour_kg * 1.6 / 0.6) / (G27.cheese_oz / 8);
    expect(flourCheeseRatio(G27.flour_kg, G27.cheese_oz)).toBeCloseTo(expected, 3);
  });
});

describe("Dough:Cheese ratio (Dough stores)", () => {
  it("uses dough / 0.6 formula (no 1.6 multiplier)", () => {
    const doughKg = 200;
    const cheeseOz = 50000;
    const expected = (doughKg / 0.6) / (cheeseOz / 8);
    expect(doughCheeseRatio(doughKg, cheeseOz)).toBeCloseTo(expected, 4);
  });
});

// ── Status tests ─────────────────────────────────────────────

describe("diffStatus", () => {
  it("ok within ±3", () => { expect(diffStatus(2.5)).toBe("ok"); expect(diffStatus(-2.9)).toBe("ok"); });
  it("warn at 3-6", () => { expect(diffStatus(4)).toBe("warn"); expect(diffStatus(-5.5)).toBe("warn"); });
  it("bad beyond ±6", () => { expect(diffStatus(7)).toBe("bad"); expect(diffStatus(-10)).toBe("bad"); });
});

describe("ratioStatus", () => {
  it("ok at 75-125%", () => { expect(ratioStatus(0.80)).toBe("ok"); expect(ratioStatus(1.24)).toBe("ok"); });
  it("warn at 65-75% or 125-135%", () => { expect(ratioStatus(0.70)).toBe("warn"); expect(ratioStatus(1.30)).toBe("warn"); });
  it("bad outside 65-135%", () => { expect(ratioStatus(0.50)).toBe("bad"); expect(ratioStatus(1.50)).toBe("bad"); });
});

describe("overallStatus", () => {
  it("bad if any bad", () => { expect(overallStatus(["ok", "ok", "bad", "ok", "ok"])).toBe("bad"); });
  it("warn if any warn, no bad", () => { expect(overallStatus(["ok", "warn", "ok", "ok", "ok"])).toBe("warn"); });
  it("ok if all ok", () => { expect(overallStatus(["ok", "ok", "ok", "ok", "ok"])).toBe("ok"); });
});

// ── Flags ────────────────────────────────────────────────────

describe("generateFlags", () => {
  it("flags cheese_over for Flour store", () => {
    const m = makeMetrics({ cheese_diff: 8, store_type: "flour" });
    expect(generateFlags(m).some(f => f.type === "cheese_over")).toBe(true);
  });

  it("flags dough_under for Dough store", () => {
    const m = makeMetrics({ dough_diff: -8, store_type: "dough" });
    expect(generateFlags(m).some(f => f.type === "dough_under")).toBe(true);
  });

  it("no flour flags for Dough store", () => {
    const m = makeMetrics({ flour_diff: 10, store_type: "dough" });
    expect(generateFlags(m).some(f => f.type === "flour_over")).toBe(false);
  });

  it("no dough flags for Flour store", () => {
    const m = makeMetrics({ dough_diff: 10, store_type: "flour" });
    expect(generateFlags(m).some(f => f.type === "dough_over")).toBe(false);
  });

  it("no flags for compliant store", () => {
    const m = makeMetrics({ cheese_diff: 2, sauce_diff: -1, flour_diff: 0.5, sauce_cheese_ratio: 0.95, flour_cheese_ratio: 1.05, store_type: "flour" });
    expect(generateFlags(m)).toHaveLength(0);
  });
});

// ── Brand detection ──────────────────────────────────────────

describe("detectBrand", () => {
  it("GINOS", () => expect(detectBrand("GINOS032")).toBe("GINOS"));
  it("TTD", () => expect(detectBrand("TTD BLOCKLINE")).toBe("TTD"));
  it("PP", () => expect(detectBrand("PP/WM14 WM081")).toBe("PP"));
  it("DD from STORE prefix", () => expect(detectBrand("STORE 008")).toBe("DD"));
  it("DD from DD prefix", () => expect(detectBrand("DD HAMILTON")).toBe("DD"));
  it("OTHER", () => expect(detectBrand("SAPUTO")).toBe("OTHER"));
});

describe("defaultStoreType", () => {
  it("flour for GINOS", () => expect(defaultStoreType("GINOS")).toBe("flour"));
  it("flour for TTD", () => expect(defaultStoreType("TTD")).toBe("flour"));
  it("dough for DD", () => expect(defaultStoreType("DD")).toBe("dough"));
  it("dough for WM", () => expect(defaultStoreType("WM")).toBe("dough"));
  it("dough for STORE", () => expect(defaultStoreType("STORE")).toBe("dough"));
  it("flour for PP (default)", () => expect(defaultStoreType("PP")).toBe("flour"));
});

// ── Integration: computeWeeklyMetrics ────────────────────────

describe("computeWeeklyMetrics — Flour store (G27)", () => {
  it("produces correct metrics", () => {
    const products = buildFlourProducts();
    const rows: RawOrderRow[] = [
      { company_name: "G27", week_number: 50, product_code: "20103", description: "IQF 2x5KG CHEESE", total_qty: 140 },
      { company_name: "G27", week_number: 50, product_code: "40114", description: "V Food Premium Pizza Sauce 6x2.84L", total_qty: 47 },
      { company_name: "G27", week_number: 50, product_code: "T050106", description: "V Food Flour (20 Kg)", total_qty: 106 },
      { company_name: "G27", week_number: 50, product_code: "T010316", description: "TTD 15x21 Party Pizza Box", total_qty: 5 },
      { company_name: "G27", week_number: 50, product_code: "T010314B", description: "TTD 16 XL Pizza Box 2 COLOR", total_qty: 29 },
      { company_name: "G27", week_number: 50, product_code: "T010313B", description: "TTD Large Pizza Box 2 Color", total_qty: 36 },
      { company_name: "G27", week_number: 50, product_code: "T010312B", description: "TTD Medium Pizza Box 2 Color", total_qty: 26 },
      { company_name: "G27", week_number: 50, product_code: "T010315", description: "TTD SMALL BOX 10 Yellow -40/cs", total_qty: 5 },
    ];

    const m = computeWeeklyMetrics(rows, products, 2025, "flour", false);

    expect(m.store_type).toBe("flour");
    expect(m.cheese_ordered_oz).toBeCloseTo(G27.cheese_oz, 0);
    expect(m.flour_ordered_kg).toBe(2120);
    expect(m.dough_ordered_kg).toBe(0);
    expect(m.cheese_estimated_oz).toBeCloseTo(G27_EST_CHEESE, 0);
    expect(m.flour_estimated_kg).toBeCloseTo(G27_EST_FLOUR, 0);
    expect(m.flour_diff).toBeCloseTo((2120 - G27_EST_FLOUR) / 20, 1);
    expect(m.dough_diff).toBe(0);
  });
});

describe("computeWeeklyMetrics — Dough store", () => {
  it("produces correct dough metrics", () => {
    const products = buildDoughProducts();
    const rows: RawOrderRow[] = [
      { company_name: "DD01", week_number: 10, product_code: "20103", description: "IQF CHEESE", total_qty: 30 },
      { company_name: "DD01", week_number: 10, product_code: "40114", description: "V Food Sauce", total_qty: 10 },
      { company_name: "DD01", week_number: 10, product_code: "50122", description: "Large Dough PT (36x550)", total_qty: 8 },
      { company_name: "DD01", week_number: 10, product_code: "T010313B", description: "Large Pizza Box", total_qty: 10 },
    ];

    const m = computeWeeklyMetrics(rows, products, 2026, "dough", false);

    expect(m.store_type).toBe("dough");
    expect(m.flour_ordered_kg).toBe(0);
    expect(m.dough_ordered_kg).toBeCloseTo(8 * 19.8, 1);
    expect(m.flour_diff).toBe(0);
    expect(m.dough_diff).not.toBe(0);
    // Dough:Cheese ratio should use dough/0.6 formula (no *1.6)
    expect(m.dough_cheese_ratio).toBeCloseTo(
      (m.dough_ordered_kg / 0.6) / (m.cheese_ordered_oz / 8), 3
    );
    expect(m.flour_cheese_ratio).toBe(0);
  });
});

// ── Test product lookups ─────────────────────────────────────

function makeMetrics(overrides: Partial<WeeklyMetrics>): WeeklyMetrics {
  return {
    id: "test", store_id: "test", store_code: "TEST", store_type: "flour",
    week_number: 1, year: 2026,
    cheese_ordered_oz: 0, sauce_ordered_floz: 0, flour_ordered_kg: 0, dough_ordered_kg: 0,
    boxes_small: 0, boxes_medium: 0, boxes_large: 0, boxes_xl: 0, boxes_party: 0,
    boxes_party_21x15: 0, boxes_clamshell: 0, boxes_total: 0,
    cheese_estimated_oz: 0, sauce_estimated_floz: 0, flour_estimated_kg: 0, dough_estimated_kg: 0,
    cheese_diff: 0, sauce_diff: 0, flour_diff: 0, dough_diff: 0,
    sauce_cheese_ratio: 1, flour_cheese_ratio: 1, dough_cheese_ratio: 0,
    total_boxes_ordered: 0, estimated_pizza_sales: 0, weekly_pizza_sales: 0,
    cheese_status: "ok", sauce_status: "ok", flour_status: "ok", dough_status: "ok",
    sauce_cheese_status: "ok", flour_cheese_status: "ok", dough_cheese_status: "ok",
    overall_status: "ok",
    ...overrides,
  };
}

function buildFlourProducts(): Map<string, Product> {
  const prods: Product[] = [
    { id: "1", code: "20103", description: "SAP 20% PMZ IQF 1/8 3D 2x5KG CHEESE", type: "Cheese", classification: "primary", pack_size: "2x5KG", weight: 10, weight_unit: "kg" },
    { id: "6", code: "40114", description: "V Food Premium Pizza Sauce 6x2.84L", type: "Pizza Sauce", classification: "primary", pack_size: "6x2.84L", weight: 6 * 2.84 * 33.814, weight_unit: "Fl oz" },
    { id: "8", code: "T050106", description: "V Food Flour (20 Kg)", type: "Flour", classification: "primary", pack_size: "20kg", weight: 20, weight_unit: "kg" },
    { id: "20", code: "T010315", description: "TTD SMALL BOX 10 Yellow -40/cs", type: "Packaging", classification: "primary", pack_size: "40/cs", weight: 40, weight_unit: "each" },
    { id: "21", code: "T010312B", description: "TTD Medium Pizza Box 2 Color", type: "Packaging", classification: "primary", pack_size: "40/cs", weight: 40, weight_unit: "each" },
    { id: "22", code: "T010313B", description: "TTD Large Pizza Box 2 Color", type: "Packaging", classification: "primary", pack_size: "40/cs", weight: 40, weight_unit: "each" },
    { id: "23", code: "T010314B", description: "TTD 16 XL Pizza Box 2 COLOR", type: "Packaging", classification: "primary", pack_size: "40/cs", weight: 40, weight_unit: "each" },
    { id: "24", code: "T010316", description: "TTD 15x21 Party Pizza Box Yellow -40/cs", type: "Packaging", classification: "primary", pack_size: "40/cs", weight: 40, weight_unit: "each" },
  ];
  return new Map(prods.map(p => [p.code, p]));
}

function buildDoughProducts(): Map<string, Product> {
  const prods: Product[] = [
    { id: "1", code: "20103", description: "SAP 20% PMZ IQF 1/8 3D 2x5KG CHEESE", type: "Cheese", classification: "primary", pack_size: "2x5KG", weight: 10, weight_unit: "kg" },
    { id: "6", code: "40114", description: "V Food Premium Pizza Sauce 6x2.84L", type: "Pizza Sauce", classification: "primary", pack_size: "6x2.84L", weight: 6 * 2.84 * 33.814, weight_unit: "Fl oz" },
    { id: "9", code: "50122", description: "Large Dough PT (36x550)", type: "Dough", classification: "primary", pack_size: "36x550g", weight: 19.8, weight_unit: "kg" },
    { id: "22", code: "T010313B", description: "TTD Large Pizza Box 2 Color", type: "Packaging", classification: "primary", pack_size: "40/cs", weight: 40, weight_unit: "each" },
  ];
  return new Map(prods.map(p => [p.code, p]));
}

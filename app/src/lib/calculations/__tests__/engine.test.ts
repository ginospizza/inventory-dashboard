/**
 * Tests for the Gino's compliance calculation engine (v2: Brand-Aware).
 *
 * Validates Flour stores (GINOS/TTD) and Dough stores (DD/WM) paths.
 * Box ratios confirmed by James on April 28, 2026.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateStoreWeek,
  estimatedCheeseOz,
  platesCountForBrand,
  resolveStoreType,
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
  smoothedDiffStatuses,
  recomputeRollingStatuses,
  type RollingWeek,
  type RollingStatusRow,
} from "../engine";

import { FLOUR_YIELD_FACTOR, BOX_RATIOS, BOXES_PER_CASE } from "../constants";
import type { Product, RawOrderRow, WeeklyMetrics, ComplianceStatus } from "@/lib/types";

// ── Rolling-average smoothing (both sides) ───────────────────
describe("smoothedDiffStatuses — 4-week rolling average, both sides", () => {
  const wk = (orderedMult: number): RollingWeek => ({
    // ordered = multiplier × the box-expected; estimated held steady at the same base
    cheese_ordered_oz: 100 * orderedMult, cheese_estimated_oz: 100,
    sauce_ordered_floz: 100 * orderedMult, sauce_estimated_floz: 100,
    flour_ordered_kg: 100 * orderedMult, flour_estimated_kg: 100,
    dough_ordered_kg: 0, dough_estimated_kg: 0,
  });

  it("a single stock-up spike is smoothed away by the prior weeks", () => {
    // This week +110% over (would be At Risk in isolation), but the 3 prior weeks
    // were on-target, so the 4-week average is only ~+28% -> Borderline, not At Risk.
    const s = smoothedDiffStatuses(wk(2.1), [wk(1), wk(1), wk(1)], "flour");
    expect(s.cheese_status).toBe("warn");
  });

  it("a sustained over-order stays At Risk (smoothing does not rescue it)", () => {
    // Over by +100% every week -> average is still +100% -> At Risk. This is the
    // GINOS014 case: a chronic over-order is not a spike and must not be smoothed away.
    const s = smoothedDiffStatuses(wk(2), [wk(2), wk(2), wk(2)], "flour");
    expect(s.cheese_status).toBe("bad");
  });

  it("with no prior weeks, grades the week in isolation", () => {
    const s = smoothedDiffStatuses(wk(2), [], "flour");
    expect(s.cheese_status).toBe("bad");
  });

  it("smooths box-expected too: a boxes dip with steady orders is not flagged", () => {
    // Orders steady at 100; this week's boxes dipped so single-week looks +100% over,
    // but averaging estimated across the window pulls it back into band.
    const spikeWeek: RollingWeek = { ...wk(1), cheese_estimated_oz: 50 };
    const s = smoothedDiffStatuses(spikeWeek, [wk(1), wk(1), wk(1)], "flour");
    expect(s.cheese_status).toBe("ok");
  });
});

describe("recomputeRollingStatuses — canonical rolling-window recompute", () => {
  const row = (orderedMult: number, ratioStatus: ComplianceStatus = "ok"): RollingStatusRow => ({
    cheese_ordered_oz: 100 * orderedMult, cheese_estimated_oz: 100,
    sauce_ordered_floz: 100 * orderedMult, sauce_estimated_floz: 100,
    flour_ordered_kg: 100 * orderedMult, flour_estimated_kg: 100,
    dough_ordered_kg: 0, dough_estimated_kg: 0,
    store_type: "flour",
    sauce_cheese_status: ratioStatus,
    flour_cheese_status: "ok",
    dough_cheese_status: "ok",
  });

  it("matches calling smoothedDiffStatuses + overallStatus by hand for the same window", () => {
    const rows = [row(1), row(1), row(1), row(2.1)]; // 3 on-target weeks then a spike
    const results = recomputeRollingStatuses(rows);
    // The 4th (current) row's window is the 3 rows immediately before it.
    const expected = smoothedDiffStatuses(rows[3], [rows[0], rows[1], rows[2]], "flour");
    expect(results[3].cheese_status).toBe(expected.cheese_status);
    expect(results[3].overall_status).toBe(overallStatus([expected.cheese_status, expected.sauce_status, expected.flour_status, "ok", "ok"]));
  });

  it("is gap-tolerant: uses the up-to-3 preceding ARRAY entries, not week-number arithmetic", () => {
    // Only 2 rows exist (e.g. weeks 1 and 5 -- a gap) -- the window for the
    // 2nd row is just the 1 row that exists before it, same as smoothedDiffStatuses([]).
    const rows = [row(1), row(2)];
    const results = recomputeRollingStatuses(rows);
    const expected = smoothedDiffStatuses(rows[1], [rows[0]], "flour");
    expect(results[1].cheese_status).toBe(expected.cheese_status);
  });

  it("folds in the same-week ratio status for overall_status", () => {
    // Every diff is on-target (ok), but the ratio status is bad -> overall bad.
    // This is the GINOS003 case (James, July 9 2026): a single-week ratio spike
    // can drive overall_status to bad even when every smoothed diff is fine.
    const rows = [row(1), row(1), row(1), row(1, "bad")];
    const results = recomputeRollingStatuses(rows);
    expect(results[3].cheese_status).toBe("ok");
    expect(results[3].overall_status).toBe("bad");
  });

  it("upload-time and backfill-time recompute agree given the same data (GINOS008, July 10 2026)", () => {
    // Chronic mild cheese/flour over-ordering across several weeks, individually
    // within the smoothed band, must NOT be pushed to "bad" just because the
    // window happens to be recomputed via a different call site.
    const rows = [row(1.2), row(1.25), row(1.1), row(1.05)];
    const a = recomputeRollingStatuses(rows);
    const b = rows.map((_, i) => {
      const prior = rows.slice(Math.max(0, i - 3), i);
      const diff = smoothedDiffStatuses(rows[i], prior, "flour");
      return overallStatus([diff.cheese_status, diff.sauce_status, diff.flour_status, "ok", "ok"]);
    });
    expect(a.map((r) => r.overall_status)).toEqual(b);
  });
});

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
  plates?: number;
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
    boxes_plates: opts.plates ?? 0,
    wing_8: 0,
    wing_10: 0,
    wing_12: 0,
    wing_14: 0,
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

// G27 uses T010316 = TTD 15x21 Party Box -> party_21x15, which counts the
// same as party_20 (16oz/10oz/1.2kg) since July 6 2026 — 315 sq in ≈ 20" round.
const G27_EST_CHEESE =
  5 * 40 * 16 + 29 * 40 * 10 + 36 * 40 * 8 + 26 * 40 * 6 + 5 * 40 * 4;
const G27_EST_SAUCE =
  5 * 40 * 10 + 29 * 40 * 6 + 36 * 40 * 5 + 26 * 40 * 4 + 5 * 40 * 2.5;
const G27_EST_DOUGH =
  5 * 40 * 1.2 + 29 * 40 * 0.775 + 36 * 40 * 0.6 + 26 * 40 * 0.45 + 5 * 40 * 0.3;
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
  it("adds clamshell contribution for every brand (James, July 3 2026)", () => {
    // boxes_clamshell stores individual pieces (not cases), so the ratio applies
    // per piece — and it is no longer gated by brand.
    const clamPieces = 5 * BOXES_PER_CASE;
    const agg = makeAgg({ large: 10, clamshell: clamPieces });
    const clamContrib = clamPieces * BOX_RATIOS.clamshell.cheese_oz;
    const boxesOnly = 10 * BOXES_PER_CASE * BOX_RATIOS.large.cheese_oz;
    expect(estimatedCheeseOz(agg, false)).toBeCloseTo(boxesOnly + clamContrib, 2);
    expect(estimatedCheeseOz(agg, true)).toBeCloseTo(boxesOnly + clamContrib, 2);
  });
});

describe("Estimated cheese (paper plates — TTD/PP/WM only)", () => {
  it("adds plate contribution only when the brand counts plates", () => {
    // 2 cases of 60501 = 2 x 1200 pieces; same per-piece usage as clamshells.
    const platePieces = 2 * 1200;
    const agg = makeAgg({ large: 10, plates: platePieces });
    const boxesOnly = 10 * BOXES_PER_CASE * BOX_RATIOS.large.cheese_oz;
    const plateContrib = platePieces * BOX_RATIOS.plate.cheese_oz;
    expect(estimatedCheeseOz(agg, true)).toBeCloseTo(boxesOnly + plateContrib, 2);  // TTD/PP/WM
    expect(estimatedCheeseOz(agg, false)).toBeCloseTo(boxesOnly, 2);                // GINOS/DD
  });

  it("platesCountForBrand: every brand except GINOS (DD confirmed July 6)", () => {
    expect(platesCountForBrand("TTD")).toBe(true);
    expect(platesCountForBrand("PP")).toBe(true);
    expect(platesCountForBrand("WM")).toBe(true);
    expect(platesCountForBrand("DD")).toBe(true);
    expect(platesCountForBrand("STORE")).toBe(true);
    expect(platesCountForBrand("GINOS")).toBe(false);
  });

  it("slice tray (G060510) classifies as clamshell-class at 500 pieces/case", () => {
    const tray: Product = {
      id: "p-tray",
      code: "G060510",
      description: "Ginos Pizza Slice Tray - 500/cs",
      type: "Packaging",
      classification: "primary",
      pack_size: "500/cs",
      weight: 500,
      weight_unit: "each",
    };
    const lookup = new Map<string, Product>([[tray.code, tray]]);
    const agg = aggregateStoreWeek(
      [{ company_name: "GINOS002", week_number: 15, product_code: "G060510", description: tray.description, total_qty: 2 }],
      lookup,
      2026
    );
    expect(agg.boxes_clamshell).toBe(1000);
  });
});

describe("Estimated sauce", () => {
  it("matches G27", () => {
    const agg = makeAgg(G27);
    expect(estimatedSauceFloz(agg, false)).toBeCloseTo(G27_EST_SAUCE, 0);
  });
});

// ── Clamshell SKU mapping (GINOS103 W15 2026 regression) ─────
// James's report, July 3 2026: 9 cases of G060511A (100 pieces/case) were
// dropped from the estimate because the SKU was missing from the product
// table. With the product mapped, the estimate must include 9 x 100 x 2 oz.

const CLAMSHELL_PRODUCT: Product = {
  id: "p-clam",
  code: "G060511A",
  description: "Ginos Clamshell Box - 100/CS BOX LOCK CORNER",
  type: "Packaging",
  classification: "primary",
  pack_size: "100/cs",
  weight: 100, // pieces per case
  weight_unit: "each",
};

const XL_BOX_PRODUCT: Product = {
  id: "p-xl",
  code: "G010314",
  description: 'Ginos X-Large Pizza Box 16" (40)',
  type: "Packaging",
  classification: "primary",
  pack_size: "40/cs",
  weight: 40,
  weight_unit: "each",
};

const PLATE_PRODUCT: Product = {
  id: "p-plate",
  code: "60501",
  description: "9 Paper Plates - 12x100",
  type: "Packaging",
  classification: "primary",
  pack_size: "12x100",
  weight: 1200, // pieces per case
  weight_unit: "each",
};

function orderRow(code: string, description: string, qty: number): RawOrderRow {
  return { company_name: "GINOS103", week_number: 15, product_code: code, description, total_qty: qty };
}

describe("Clamshell aggregation and totals", () => {
  const lookup = new Map<string, Product>([
    [CLAMSHELL_PRODUCT.code, CLAMSHELL_PRODUCT],
    [XL_BOX_PRODUCT.code, XL_BOX_PRODUCT],
  ]);

  it("converts clamshell cases to pieces via the product's units-per-case", () => {
    const agg = aggregateStoreWeek([orderRow("G060511A", CLAMSHELL_PRODUCT.description, 9)], lookup, 2026);
    expect(agg.boxes_clamshell).toBe(900);
  });

  it("matches James's GINOS103 W15 cheese estimate (12,440 with clamshells)", () => {
    const agg = makeAgg({ xl: 10, large: 20, medium: 1, clamshell: 900 });
    // Clamshells count regardless of the plates flag.
    expect(estimatedCheeseOz(agg, false)).toBeCloseTo(12440, 2);
    expect(estimatedCheeseOz(agg, true)).toBeCloseTo(12440, 2);
  });

  it("counts clamshell pieces once (no x40) in boxes_total and pizza sales", () => {
    const rows = [
      orderRow("G010314", XL_BOX_PRODUCT.description, 10),
      orderRow("G060511A", CLAMSHELL_PRODUCT.description, 9),
    ];
    const m = computeWeeklyMetrics(rows, lookup, 2026, "flour", "GINOS");
    expect(m.boxes_clamshell).toBe(900);
    expect(m.boxes_total).toBe(10 * 40 + 900);
    // 10 XL cases x 40 x 17 pizzas + 900 clamshell pieces x 1 slice
    expect(m.estimated_pizza_sales).toBe(10 * 40 * 17 + 900);
  });

  it("counts paper plates for TTD but not for GINOS in metrics", () => {
    const plateLookup = new Map<string, Product>([
      [XL_BOX_PRODUCT.code, XL_BOX_PRODUCT],
      [PLATE_PRODUCT.code, PLATE_PRODUCT],
    ]);
    const rows = [
      orderRow("G010314", XL_BOX_PRODUCT.description, 10),
      orderRow("60501", PLATE_PRODUCT.description, 2),
    ];
    const ttd = computeWeeklyMetrics(rows, plateLookup, 2026, "flour", "TTD");
    expect(ttd.boxes_plates).toBe(2400);
    expect(ttd.boxes_total).toBe(10 * 40 + 2400);
    expect(ttd.cheese_estimated_oz).toBeCloseTo(10 * 40 * 10 + 2400 * 2, 2);

    const ginos = computeWeeklyMetrics(rows, plateLookup, 2026, "flour", "GINOS");
    expect(ginos.boxes_plates).toBe(0);
    expect(ginos.boxes_total).toBe(10 * 40);
    expect(ginos.cheese_estimated_oz).toBeCloseTo(10 * 40 * 10, 2);
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
  it("counts the same as party_20: 16oz cheese, 10oz sauce, 1.2kg dough", () => {
    const agg = makeAgg({ party_21x15: 1 });
    expect(estimatedCheeseOz(agg, false)).toBe(1 * 40 * 16);
    expect(estimatedSauceFloz(agg, false)).toBe(1 * 40 * 10);
    expect(estimatedDoughKg(agg, false)).toBeCloseTo(1 * 40 * 1.2, 6);
  });
});

describe("Wing boxes — volume only, never in estimates", () => {
  it("excludes wing box cases from estimated usage (James, July 6 2026)", () => {
    const agg = makeAgg({ large: 10 });
    const withWings = { ...agg, wing_8: 2, wing_10: 3, wing_12: 1, wing_14: 4 };
    expect(estimatedCheeseOz(withWings, false)).toBe(estimatedCheeseOz(agg, false));
    expect(estimatedSauceFloz(withWings, false)).toBe(estimatedSauceFloz(agg, false));
    expect(estimatedDoughKg(withWings, false)).toBe(estimatedDoughKg(agg, false));
  });
});

describe("PP41/WM2 GINOS058 W15 2026 regression (James, July 6 2026)", () => {
  it("matches James's 5,760 oz: party@16, wing boxes excluded, clamshells in", () => {
    // 1 small, 3 medium, 5 large, 2 XL, 2 party 21x15, 600 clamshell pieces;
    // the 2 cases of 8-wing boxes the store ordered must contribute nothing.
    const agg = makeAgg({ small: 1, medium: 3, large: 5, xl: 2, party_21x15: 2, clamshell: 600 });
    const withWings = { ...agg, wing_8: 2 };
    expect(estimatedCheeseOz(withWings, true)).toBeCloseTo(5760, 2);
  });
});

describe("Store type defaults — DD/PP/WM buy commissary dough", () => {
  it("PP defaults to dough (James, July 6 2026)", () => {
    expect(defaultStoreType("PP")).toBe("dough");
    expect(defaultStoreType("WM")).toBe("dough");
    expect(defaultStoreType("DD")).toBe("dough");
    expect(defaultStoreType("GINOS")).toBe("flour");
    expect(defaultStoreType("TTD")).toBe("flour");
  });
});

// ── Diff tests ───────────────────────────────────────────────

describe("Cheese diff", () => {
  it("uses dominant cheese SKU weight as divisor", () => {
    const agg = makeAgg({
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
  it("dough for PP (commissary dough, July 6 2026)", () => expect(defaultStoreType("PP")).toBe("dough"));
});

describe("resolveStoreType — PP/WM flour-method hybrids (July 8 2026)", () => {
  it("forces flour for the named hybrid stores that buy flour", () => {
    expect(resolveStoreType("PP/WM27 GINOS057", "PP")).toBe("flour");
    expect(resolveStoreType("PP/WM33 GINOS083", "PP")).toBe("flour");
    expect(resolveStoreType("PP/WM35 GINOS069", "PP")).toBe("flour");
    expect(resolveStoreType("PP/WM79 GINOS079", "PP")).toBe("flour");
  });
  it("leaves other PP/WM stores on the brand default (dough)", () => {
    expect(resolveStoreType("PP/WM51 GINOS078", "PP")).toBe("dough");
    expect(resolveStoreType("PP41/WM2 GINOS058", "PP")).toBe("dough");
    expect(resolveStoreType("WM3/PP11 GINOS097", "PP")).toBe("dough");
  });
  it("does not disturb non-PP brands", () => {
    expect(resolveStoreType("GINOS103", "GINOS")).toBe("flour");
    expect(resolveStoreType("STORE 055", "STORE")).toBe("dough");
  });
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

    const m = computeWeeklyMetrics(rows, products, 2025, "flour", "TTD");

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

    const m = computeWeeklyMetrics(rows, products, 2026, "dough", "DD");

    expect(m.store_type).toBe("dough");
    expect(m.dough_ordered_kg).toBeCloseTo(8 * 19.8, 1);
    expect(m.dough_diff).not.toBe(0);
    // Dough:Cheese ratio should use dough/0.6 formula (no *1.6)
    expect(m.dough_cheese_ratio).toBeCloseTo(
      (m.dough_ordered_kg / 0.6) / (m.cheese_ordered_oz / 8), 3
    );
    // Flour columns show the flour-EQUIVALENT of dough (dough / 1.6) for
    // comparability, not 0 (James, July 7 2026). Grading still uses dough_*.
    expect(m.flour_ordered_kg).toBeCloseTo(m.dough_ordered_kg / 1.6, 2);
    expect(m.flour_diff).not.toBe(0);
    expect(m.flour_cheese_ratio).toBeCloseTo(m.dough_cheese_ratio, 4);
  });

  it("shows dough as flour-bag equivalent (James's WM3/PP11 GINOS097 table)", () => {
    // James's numbers: dough ordered totals 634.4 kg -> 396.5 kg flour
    // (634.4 / 1.6) -> 19.8 flour bags (396.5 / 20).
    const products = new Map<string, Product>([
      ["50120", { id: "s", code: "50120", description: "Small Dough PT (72x300)", type: "Dough", classification: "primary", pack_size: "72x300g", weight: 21.6, weight_unit: "kg" }],
      ["50121", { id: "m", code: "50121", description: "Medium Dough PT (40x410)", type: "Dough", classification: "primary", pack_size: "40x410g", weight: 16.4, weight_unit: "kg" }],
      ["50122", { id: "l", code: "50122", description: "Large Dough PT (36x550)", type: "Dough", classification: "primary", pack_size: "36x550g", weight: 19.8, weight_unit: "kg" }],
      ["50123", { id: "xl", code: "50123", description: "X-Large Dough PT (24x800)", type: "Dough", classification: "primary", pack_size: "24x800g", weight: 19.2, weight_unit: "kg" }],
      ["50124", { id: "p", code: "50124", description: "Party Dough PT(20x1000)", type: "Dough", classification: "primary", pack_size: "20x1000g", weight: 20, weight_unit: "kg" }],
    ]);
    const rows: RawOrderRow[] = [
      { company_name: "WM3", week_number: 15, product_code: "50122", description: "Large Dough PT (36x550)", total_qty: 10 },
      { company_name: "WM3", week_number: 15, product_code: "50121", description: "Medium Dough PT (40x410)", total_qty: 3 },
      { company_name: "WM3", week_number: 15, product_code: "50124", description: "Party Dough PT(20x1000)", total_qty: 1 },
      { company_name: "WM3", week_number: 15, product_code: "50120", description: "Small Dough PT (72x300)", total_qty: 1 },
      { company_name: "WM3", week_number: 15, product_code: "50123", description: "X-Large Dough PT (24x800)", total_qty: 18 },
    ];
    const m = computeWeeklyMetrics(rows, products, 2026, "dough", "WM");
    expect(m.dough_ordered_kg).toBeCloseTo(634.4, 1);
    expect(m.flour_ordered_kg).toBeCloseTo(396.5, 1);       // 634.4 / 1.6
    expect(m.flour_ordered_kg / 20).toBeCloseTo(19.825, 2); // flour-bag equivalent
  });

  it("combines flour + dough for a flour-method hybrid that buys both (PP/WM, July 8 2026)", () => {
    // A PP/WM store graded on the flour method that also bought a case of
    // pre-portioned dough: flour_ordered = real flour + dough / 1.6.
    const products = new Map<string, Product>([
      ["G050106", { id: "f", code: "G050106", description: "Ginos Flour (20 Kg)", type: "Flour", classification: "primary", pack_size: "20kg", weight: 20, weight_unit: "kg" }],
      ["50122", { id: "d", code: "50122", description: "Large Dough PT (36x550)", type: "Dough", classification: "primary", pack_size: "36x550g", weight: 19.8, weight_unit: "kg" }],
      ["20103", { id: "c", code: "20103", description: "IQF CHEESE", type: "Cheese", classification: "primary", pack_size: "2x5KG", weight: 10, weight_unit: "kg" }],
    ]);
    const rows: RawOrderRow[] = [
      { company_name: "PP/WM35", week_number: 15, product_code: "G050106", description: "Ginos Flour (20 Kg)", total_qty: 5 },   // 100 kg flour
      { company_name: "PP/WM35", week_number: 15, product_code: "50122", description: "Large Dough PT (36x550)", total_qty: 1 }, // 19.8 kg dough
      { company_name: "PP/WM35", week_number: 15, product_code: "20103", description: "IQF CHEESE", total_qty: 10 },
    ];
    const m = computeWeeklyMetrics(rows, products, 2026, "flour", "PP");
    // 100 kg flour + 19.8 kg dough / 1.6 = 100 + 12.375 = 112.375 kg
    expect(m.flour_ordered_kg).toBeCloseTo(112.375, 2);
  });
});

// ── Test product lookups ─────────────────────────────────────

function makeMetrics(overrides: Partial<WeeklyMetrics>): WeeklyMetrics {
  return {
    id: "test", store_id: "test", store_code: "TEST", store_type: "flour",
    week_number: 1, year: 2026,
    cheese_ordered_oz: 0, sauce_ordered_floz: 0, flour_ordered_kg: 0, dough_ordered_kg: 0,
    boxes_small: 0, boxes_medium: 0, boxes_large: 0, boxes_xl: 0, boxes_party: 0,
    boxes_party_21x15: 0, boxes_clamshell: 0, boxes_plates: 0, boxes_total: 0,
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

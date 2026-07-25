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
  diffStatusPct,
  ratioStatus,
  overallStatus,
  computeWeeklyMetrics,
  computeNetworkStats,
  generateFlags,
  detectBrand,
  defaultStoreType,
  smoothedDiffStatuses,
  smoothedRatioStatuses,
  recomputeRollingStatuses,
  severityScore,
  type RollingWeek,
  type RollingStatusRow,
} from "../engine";

import {
  FLOUR_YIELD_FACTOR,
  BOX_RATIOS,
  BOXES_PER_CASE,
  ROLLING_WINDOW_WEEKS,
  ROLLING_PRIOR_WEEKS,
} from "../constants";
import type { Product, RawOrderRow, WeeklyMetrics, ComplianceStatus } from "@/lib/types";
import { statusRank } from "@/lib/types";

// ── Four-tier grading bands (James, July 22 2026) ────────────
describe("diffStatusPct — ingredient bands", () => {
  // ordered vs a box-expected of 100, so the numbers read as percentages.
  const at = (pct: number) => diffStatusPct(100 + pct, 100);

  it("grades each band, over and under", () => {
    expect(at(0)).toBe("ok");
    expect(at(24)).toBe("ok");
    expect(at(26)).toBe("warn");
    expect(at(49)).toBe("warn");
    expect(at(51)).toBe("bad");
    expect(at(74)).toBe("bad");
    expect(at(76)).toBe("severe");
    expect(at(400)).toBe("severe");

    // Symmetric on the under side — it's an absolute deviation.
    expect(at(-24)).toBe("ok");
    expect(at(-26)).toBe("warn");
    expect(at(-51)).toBe("bad");
    expect(at(-76)).toBe("severe");
  });

  it("treats the boundaries themselves as the kinder tier", () => {
    // Thresholds are exclusive (`>`), so exactly 25/50/75% does not escalate.
    expect(at(25)).toBe("ok");
    expect(at(50)).toBe("warn");
    expect(at(75)).toBe("bad");
  });

  it("returns ok when there is no box-expected to compare against", () => {
    expect(diffStatusPct(500, 0)).toBe("ok");
  });
});

describe("ratioStatus — ratio bands", () => {
  it("grades each band, high and low", () => {
    expect(ratioStatus(1.0)).toBe("ok");
    expect(ratioStatus(1.24)).toBe("ok");
    expect(ratioStatus(1.3)).toBe("warn");
    expect(ratioStatus(1.4)).toBe("bad");
    expect(ratioStatus(1.6)).toBe("severe");

    expect(ratioStatus(0.8)).toBe("ok");
    expect(ratioStatus(0.7)).toBe("warn");
    expect(ratioStatus(0.6)).toBe("bad");
    expect(ratioStatus(0.4)).toBe("severe");
  });

  it("keeps an uncomputable (zero) ratio at bad rather than promoting it to severe", () => {
    // The ratio helpers return 0 when cheese is 0, i.e. one side was never
    // ordered. 0 is outside 50-150, so without the guard every no-cheese week
    // would read as Severe — data absence dressed up as the most urgent tier.
    expect(ratioStatus(0)).toBe("bad");
  });
});

describe("overallStatus — worst metric wins", () => {
  it("picks the worst tier present", () => {
    expect(overallStatus(["ok", "ok"])).toBe("ok");
    expect(overallStatus(["ok", "warn"])).toBe("warn");
    expect(overallStatus(["ok", "warn", "bad"])).toBe("bad");
    expect(overallStatus(["ok", "warn", "bad", "severe"])).toBe("severe");
    // One severe metric outranks any number of healthy ones.
    expect(overallStatus(["severe", "ok", "ok", "ok", "ok"])).toBe("severe");
  });

  it("is ok for an empty list", () => {
    expect(overallStatus([])).toBe("ok");
  });
});

describe("statusRank — ordering used by every severity sort", () => {
  it("orders best to worst", () => {
    expect(statusRank("ok")).toBeLessThan(statusRank("warn"));
    expect(statusRank("warn")).toBeLessThan(statusRank("bad"));
    expect(statusRank("bad")).toBeLessThan(statusRank("severe"));
  });

  it("ranks an unrecognised status as worst, not best", () => {
    // The old inline `s === "bad" ? 2 : s === "warn" ? 1 : 0` ranked anything
    // unknown as 0 — best in class — which would have buried Severe stores at
    // the bottom of Stores Requiring Attention.
    expect(statusRank("something-new")).toBe(statusRank("severe"));
    expect(statusRank(undefined)).toBe(statusRank("severe"));
  });
});

// ── Rolling-average smoothing (both sides) ───────────────────
describe("smoothedDiffStatuses — rolling average, both sides", () => {
  const wk = (orderedMult: number): RollingWeek => ({
    // ordered = multiplier × the box-expected; estimated held steady at the same base
    cheese_ordered_oz: 100 * orderedMult, cheese_estimated_oz: 100,
    sauce_ordered_floz: 100 * orderedMult, sauce_estimated_floz: 100,
    flour_ordered_kg: 100 * orderedMult, flour_estimated_kg: 100,
    dough_ordered_kg: 0, dough_estimated_kg: 0,
  });

  it("a single stock-up spike is smoothed away by the prior weeks", () => {
    // This week +110% over (would be At Risk in isolation), but the 3 prior weeks
    // were on-target, so the average is only ~+28% -> Borderline, not At Risk.
    const s = smoothedDiffStatuses(wk(2.1), [wk(1), wk(1), wk(1)], "flour");
    expect(s.cheese_status).toBe("warn");
  });

  it("a full 6-week window smooths that same spike further than 4 weeks did", () => {
    // Same +110% spike, now against 5 on-target priors: (2.1 + 5)/6 = +18.3%,
    // inside the 25% band -> Compliant. This is the relaxation the move from a
    // 4-week to a 6-week window produces (James, July 22 2026), and it is the
    // whole reason a re-score backfill is required alongside the change.
    const priors = Array.from({ length: ROLLING_PRIOR_WEEKS }, () => wk(1));
    expect(smoothedDiffStatuses(wk(2.1), priors, "flour").cheese_status).toBe("ok");
  });

  it("a sustained over-order is not rescued by smoothing", () => {
    // Over by +100% every week -> average is still +100%. This is the GINOS014
    // case: a chronic over-order is not a spike and must not be smoothed away.
    // +100% is past the 75% line, so it grades Severe rather than At Risk.
    const s = smoothedDiffStatuses(wk(2), [wk(2), wk(2), wk(2)], "flour");
    expect(s.cheese_status).toBe("severe");
  });

  it("a sustained over-order between 50% and 75% stays At Risk, not Severe", () => {
    // +60% every week — chronic, but not past the Severe line.
    const s = smoothedDiffStatuses(wk(1.6), [wk(1.6), wk(1.6), wk(1.6)], "flour");
    expect(s.cheese_status).toBe("bad");
  });

  it("with no prior weeks, grades the week in isolation", () => {
    const s = smoothedDiffStatuses(wk(2), [], "flour");
    expect(s.cheese_status).toBe("severe");
  });

  it("smooths box-expected too: a boxes dip with steady orders is not flagged", () => {
    // Orders steady at 100; this week's boxes dipped so single-week looks +100% over,
    // but averaging estimated across the window pulls it back into band.
    const spikeWeek: RollingWeek = { ...wk(1), cheese_estimated_oz: 50 };
    const s = smoothedDiffStatuses(spikeWeek, [wk(1), wk(1), wk(1)], "flour");
    expect(s.cheese_status).toBe("ok");
  });
});

describe("smoothedRatioStatuses — ratios smoothed over the rolling window (July 14 2026)", () => {
  // cheese fixed so cheese/8 = 100; then S:C = sauce/500, F:C = flour/37.5.
  const rw = (sc: number, fc = 1.0): RollingWeek => ({
    cheese_ordered_oz: 800, cheese_estimated_oz: 800,
    sauce_ordered_floz: sc * 500, sauce_estimated_floz: sc * 500,
    flour_ordered_kg: fc * 37.5, flour_estimated_kg: fc * 37.5,
    dough_ordered_kg: 0, dough_estimated_kg: 0,
  });

  it("a single out-of-band S:C week is smoothed by in-band prior weeks", () => {
    // This week S:C 1.6 (bad in isolation); 3 priors on-target -> window avg
    // ~1.15 -> back in band. This is James's slow-season spike-down case.
    const s = smoothedRatioStatuses(rw(1.6), [rw(1.0), rw(1.0), rw(1.0)], "flour");
    expect(s.sauce_cheese_status).not.toBe("bad");
  });

  it("a sustained out-of-band S:C is not rescued by smoothing", () => {
    // S:C 160% sustained — past the 150% Severe line.
    const s = smoothedRatioStatuses(rw(1.6), [rw(1.6), rw(1.6), rw(1.6)], "flour");
    expect(s.sauce_cheese_status).toBe("severe");
  });

  it("a sustained S:C inside 150% stays At Risk, not Severe", () => {
    const s = smoothedRatioStatuses(rw(1.4), [rw(1.4), rw(1.4), rw(1.4)], "flour");
    expect(s.sauce_cheese_status).toBe("bad");
  });

  it("with no priors, grades the ratio in isolation", () => {
    expect(smoothedRatioStatuses(rw(1.6), [], "flour").sauce_cheese_status).toBe("severe");
  });

  it("dough stores get D:C (F:C stays ok), flour stores get F:C (D:C stays ok)", () => {
    const flour = smoothedRatioStatuses(rw(1.0, 1.0), [], "flour");
    expect(flour.dough_cheese_status).toBe("ok");
    const doughWeek: RollingWeek = { ...rw(1.0), flour_ordered_kg: 0, flour_estimated_kg: 0, dough_ordered_kg: 100, dough_estimated_kg: 100 };
    const dough = smoothedRatioStatuses(doughWeek, [], "dough");
    expect(dough.flour_cheese_status).toBe("ok");
  });
});

describe("recomputeRollingStatuses — canonical rolling-window recompute", () => {
  // In-band S:C (1.0) and F:C (1.0) at every multiplier: sauce = 62.5*mult,
  // flour = 4.6875*mult against cheese = 100*mult. Diffs move with mult.
  const row = (orderedMult: number): RollingStatusRow => ({
    cheese_ordered_oz: 100 * orderedMult, cheese_estimated_oz: 100,
    sauce_ordered_floz: 62.5 * orderedMult, sauce_estimated_floz: 62.5,
    flour_ordered_kg: 4.6875 * orderedMult, flour_estimated_kg: 4.6875,
    dough_ordered_kg: 0, dough_estimated_kg: 0,
    store_type: "flour",
  });
  // A week whose S:C is forced out of band (sauce doubled vs the on-target row).
  const badRatioRow = (orderedMult: number): RollingStatusRow => ({
    ...row(orderedMult),
    sauce_ordered_floz: 130 * orderedMult, sauce_estimated_floz: 130,
  });

  it("matches calling smoothedDiffStatuses + smoothedRatioStatuses by hand for the same window", () => {
    const rows = [row(1), row(1), row(1), row(2.1)]; // 3 on-target weeks then a spike
    const results = recomputeRollingStatuses(rows);
    const prior = [rows[0], rows[1], rows[2]];
    const diff = smoothedDiffStatuses(rows[3], prior, "flour");
    const rat = smoothedRatioStatuses(rows[3], prior, "flour");
    expect(results[3].cheese_status).toBe(diff.cheese_status);
    expect(results[3].sauce_cheese_status).toBe(rat.sauce_cheese_status);
    expect(results[3].overall_status).toBe(
      overallStatus([diff.cheese_status, diff.sauce_status, diff.flour_status, rat.sauce_cheese_status, rat.flour_cheese_status])
    );
  });

  it("is gap-tolerant: uses the preceding ARRAY entries, not week-number arithmetic", () => {
    const rows = [row(1), row(2)];
    const results = recomputeRollingStatuses(rows);
    const expected = smoothedDiffStatuses(rows[1], [rows[0]], "flour");
    expect(results[1].cheese_status).toBe(expected.cheese_status);
  });

  it(`windows exactly ${ROLLING_WINDOW_WEEKS} weeks — the edge week counts, one older does not`, () => {
    // Every other prior fixture is short enough that Math.max(0, ...) clamps to
    // the start of the array, which makes the window size invisible: a 4-week
    // window and a 6-week window give identical answers. To pin the size, put a
    // huge spike at EXACTLY the oldest position the window still reaches, then
    // one position beyond it.
    const steady = (n: number) => Array.from({ length: n }, () => row(1));

    // Spike sits ROLLING_PRIOR_WEEKS back from the last week -> still inside.
    const atEdge = [row(50), ...steady(ROLLING_PRIOR_WEEKS)];
    const edgeResult = recomputeRollingStatuses(atEdge);
    expect(edgeResult[edgeResult.length - 1].cheese_status).toBe("severe");

    // One week further back -> falls out, last week grades clean.
    const pastEdge = [row(50), ...steady(ROLLING_WINDOW_WEEKS)];
    const pastResult = recomputeRollingStatuses(pastEdge);
    expect(pastResult[pastResult.length - 1].cheese_status).toBe("ok");
  });

  it("smooths a single-week ratio spike out of overall (James, July 14 2026)", () => {
    // Diffs on target; only the LAST week's S:C spikes out of band. Smoothed
    // across the window the ratio comes back in band -> overall not At Risk.
    const rows = [row(1), row(1), row(1), badRatioRow(1)];
    const results = recomputeRollingStatuses(rows);
    expect(results[3].overall_status).not.toBe("bad");
  });

  it("keeps a SUSTAINED out-of-band ratio out of compliance", () => {
    const rows = [badRatioRow(1), badRatioRow(1), badRatioRow(1), badRatioRow(1)];
    const results = recomputeRollingStatuses(rows);
    // S:C works out to ~208% here — past 150%, so Severe.
    expect(results[3].sauce_cheese_status).toBe("severe");
    expect(results[3].overall_status).toBe("severe");
  });

  it("upload-time and backfill-time recompute agree given the same data (GINOS008, July 10 2026)", () => {
    const rows = [row(1.2), row(1.25), row(1.1), row(1.05)];
    const a = recomputeRollingStatuses(rows);
    const b = rows.map((_, i) => {
      const prior = rows.slice(Math.max(0, i - ROLLING_PRIOR_WEEKS), i);
      const diff = smoothedDiffStatuses(rows[i], prior, "flour");
      const rat = smoothedRatioStatuses(rows[i], prior, "flour");
      return overallStatus([diff.cheese_status, diff.sauce_status, diff.flour_status, rat.sauce_cheese_status, rat.flour_cheese_status]);
    });
    expect(a.map((r) => r.overall_status)).toEqual(b);
  });
});

describe("severityScore — ranks stores within a status tier by real severity", () => {
  const baseline: WeeklyMetrics = {
    id: "t", store_id: "t", store_code: "TEST", store_type: "flour",
    week_number: 1, year: 2026,
    cheese_ordered_oz: 100, sauce_ordered_floz: 100, flour_ordered_kg: 100, dough_ordered_kg: 0,
    boxes_small: 0, boxes_medium: 0, boxes_large: 0, boxes_xl: 0, boxes_party: 0,
    boxes_party_21x15: 0, boxes_clamshell: 0, boxes_plates: 0, boxes_total: 0,
    cheese_estimated_oz: 100, sauce_estimated_floz: 100, flour_estimated_kg: 100, dough_estimated_kg: 0,
    cheese_diff: 0, sauce_diff: 0, flour_diff: 0, dough_diff: 0,
    sauce_cheese_ratio: 1, flour_cheese_ratio: 1, dough_cheese_ratio: 0,
    total_boxes_ordered: 0, estimated_pizza_sales: 0, weekly_pizza_sales: 0,
    cheese_status: "ok", sauce_status: "ok", flour_status: "ok", dough_status: "ok",
    sauce_cheese_status: "ok", flour_cheese_status: "ok", dough_cheese_status: "ok",
    overall_status: "ok",
  };

  it("scores dead-on-target as 0", () => {
    expect(severityScore(baseline)).toBe(0);
  });

  it("scores by the worst single metric, not a sum", () => {
    // Cheese 20% off, sauce 90% off -> severity reflects the sauce blowout (0.9),
    // not 20%+90% added together.
    const m = { ...baseline, cheese_ordered_oz: 120, sauce_ordered_floz: 190 };
    expect(severityScore(m)).toBeCloseTo(0.9, 5);
  });

  it("a same-week ratio spike scores just like a diff blowout (GINOS003-style)", () => {
    // Every diff on target, but S:C ratio at 150% of ideal.
    const m = { ...baseline, sauce_cheese_ratio: 1.5 };
    expect(severityScore(m)).toBeCloseTo(0.5, 5);
  });

  it("ranks a bigger blowout higher than a smaller one, unlike flag-count ties", () => {
    const mild = { ...baseline, cheese_ordered_oz: 130 };  // 30% off
    const severe = { ...baseline, cheese_ordered_oz: 160 }; // 60% off
    expect(severityScore(severe)).toBeGreaterThan(severityScore(mild));
  });

  it("uses dough (not flour) for dough-type stores", () => {
    const m: WeeklyMetrics = {
      ...baseline, store_type: "dough",
      flour_ordered_kg: 0, flour_estimated_kg: 0, flour_cheese_ratio: 0,
      dough_ordered_kg: 200, dough_estimated_kg: 100, dough_cheese_ratio: 1,
    };
    expect(severityScore(m)).toBeCloseTo(1.0, 5); // dough is 100% over
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

describe("generateFlags — %-of-expected basis (matches how statuses grade)", () => {
  it("flags cheese_over past +25% of expected, with the % as the value", () => {
    const m = makeMetrics({ cheese_ordered_oz: 140, cheese_estimated_oz: 100, store_type: "flour" });
    const flag = generateFlags(m).find(f => f.type === "cheese_over");
    expect(flag).toBeDefined();
    expect(flag!.value).toBeCloseTo(40, 5); // signed % deviation, not cases
  });

  it("flags dough_under past -25% for Dough store", () => {
    const m = makeMetrics({ dough_ordered_kg: 60, dough_estimated_kg: 100, store_type: "dough" });
    expect(generateFlags(m).some(f => f.type === "dough_under")).toBe(true);
  });

  it("does not flag a big absolute swing that is small in % terms", () => {
    // 6 cases over on a huge base was an automatic flag under the old flat
    // thresholds; at +10% of expected it is normal ordering variance.
    const m = makeMetrics({ cheese_ordered_oz: 6600, cheese_estimated_oz: 6000, cheese_diff: 6, store_type: "flour" });
    expect(generateFlags(m).some(f => f.type === "cheese_over")).toBe(false);
  });

  it("no flour flags for Dough store", () => {
    const m = makeMetrics({ flour_ordered_kg: 200, flour_estimated_kg: 100, store_type: "dough" });
    expect(generateFlags(m).some(f => f.type === "flour_over")).toBe(false);
  });

  it("no dough flags for Flour store", () => {
    const m = makeMetrics({ dough_ordered_kg: 200, dough_estimated_kg: 100, store_type: "flour" });
    expect(generateFlags(m).some(f => f.type === "dough_over")).toBe(false);
  });

  it("no flags for compliant store", () => {
    const m = makeMetrics({
      cheese_ordered_oz: 110, cheese_estimated_oz: 100,
      sauce_ordered_floz: 95, sauce_estimated_floz: 100,
      flour_ordered_kg: 102, flour_estimated_kg: 100,
      sauce_cheese_ratio: 0.95, flour_cheese_ratio: 1.05, store_type: "flour",
    });
    expect(generateFlags(m)).toHaveLength(0);
  });
});

describe("computeNetworkStats — % of stores on target", () => {
  it("signed averages cancel but on-target % tells the truth (James, July 11 2026)", () => {
    // Two stores dead on, one +30%, one -30%: the signed cheese diffs net to
    // zero (looks 'on target') while only half the network actually is.
    const metrics = [
      makeMetrics({ cheese_ordered_oz: 100, cheese_estimated_oz: 100, cheese_diff: 0 }),
      makeMetrics({ cheese_ordered_oz: 100, cheese_estimated_oz: 100, cheese_diff: 0 }),
      makeMetrics({ cheese_ordered_oz: 130, cheese_estimated_oz: 100, cheese_diff: 3 }),
      makeMetrics({ cheese_ordered_oz: 70, cheese_estimated_oz: 100, cheese_diff: -3 }),
    ];
    const stats = computeNetworkStats(metrics);
    expect(stats.avg_cheese_diff).toBe(0);          // the misleading old headline
    expect(stats.cheese_on_target_pct).toBe(50);    // the honest new one
  });

  it("excludes stores with no estimate from the on-target denominator", () => {
    const metrics = [
      makeMetrics({ cheese_ordered_oz: 100, cheese_estimated_oz: 100 }),
      makeMetrics({ cheese_ordered_oz: 50, cheese_estimated_oz: 0 }), // no boxes -> not measurable
    ];
    const stats = computeNetworkStats(metrics);
    expect(stats.cheese_on_target_pct).toBe(100);
  });

  it("uses dough for dough stores in the flour on-target stat", () => {
    const metrics = [
      makeMetrics({ store_type: "dough", dough_ordered_kg: 100, dough_estimated_kg: 100 }),
      makeMetrics({ store_type: "dough", dough_ordered_kg: 200, dough_estimated_kg: 100 }),
    ];
    const stats = computeNetworkStats(metrics);
    expect(stats.flour_on_target_pct).toBe(50);
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

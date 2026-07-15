/**
 * Gino's Pizza — Compliance Calculation Engine (v2: Brand-Aware)
 *
 * Two calculation paths:
 *   - Flour stores (GINOS, TTD, some PP/WM): Use flour, multiply by 1.6 for dough equiv
 *   - Dough stores (DD, WM, some PP/WM): Use pre-portioned dough directly
 *
 * See BUSINESS_RULES.md for full documentation of every formula.
 */

import type {
  ComplianceStatus,
  Flag,
  FlagType,
  Product,
  RawOrderRow,
  WeeklyMetrics,
  NetworkStats,
  BrandStats,
  Brand,
  StoreType,
} from "@/lib/types";

import {
  KG_TO_OZ,
  BOXES_PER_CASE,
  PLATES_PER_CASE,
  BOX_RATIOS,
  FLOUR_YIELD_FACTOR,
  PIZZA_SALES_PER_CASE,
  SAUCE_CASE_FLOZ,
  FLOUR_BAG_KG,
  SAUCE_RATIO_DIVISOR,
  CHEESE_RATIO_DIVISOR,
  DOUGH_RATIO_DIVISOR,
  DEFAULT_DIFF_THRESHOLDS,
  DEFAULT_PCT_THRESHOLDS,
  DEFAULT_RATIO_THRESHOLDS,
} from "./constants";

// ── Intermediate aggregation ─────────────────────────────────

interface StoreWeekAggregates {
  store_code: string;
  week_number: number;
  year: number;

  cheese_by_sku: Map<string, { qty: number; weight_kg: number }>;
  total_cheese_oz: number;
  total_sauce_floz: number;
  total_flour_kg: number;

  dough_by_sku: Map<string, { qty: number; weight_kg: number }>;
  total_dough_kg: number;

  // Box cases by size
  boxes_small: number;
  boxes_medium: number;
  boxes_large: number;
  boxes_xl: number;
  boxes_party_20: number;
  boxes_party_21x15: number;
  boxes_clamshell: number;
  boxes_plates: number;

  // Wing box cases by size (used as pizza boxes in some stores)
  wing_8: number;
  wing_10: number;
  wing_12: number;
  wing_14: number;
}

// ── Box size detection ───────────────────────────────────────

type BoxSize = keyof typeof BOX_RATIOS;

function getBoxSize(product: Product): BoxSize | null {
  const desc = product.description.toLowerCase();

  // Paper plates (slice vehicle for TTD/PP/WM) — must check before sizes
  // ("9 Paper Plates - 12x100" would otherwise never match a size).
  if (desc.includes("paper plate")) return "plate";

  // Clamshell / slice
  if (desc.includes("clamshell") || desc.includes("slice")) return "clamshell";

  // Party 21x15 / 15x21 — must check before generic "party"
  if (desc.includes("21x15") || desc.includes("15x21")) return "party_21x15";

  // Party 20"
  if (desc.includes("party") || desc.includes("20\"") || desc.includes('20"')) return "party_20";

  // XL / 16"
  if (desc.includes("16") || desc.includes("xl") || desc.includes("x-large") || desc.includes("x large")) return "xl";

  // Large / 14" — exclude x-large
  if ((desc.includes("large") && !desc.includes("x-large") && !desc.includes("x large") && !desc.includes("xl"))) return "large";

  // Medium / 12"
  if (desc.includes("medium") || desc.includes("med ") || desc.includes("12\"") || desc.includes('12"')) return "medium";

  // Small / 10"
  if (desc.includes("small") || desc.includes("10\"") || desc.includes('10"')) return "small";

  return null;
}

function isWingBox(product: Product): boolean {
  const desc = product.description.toLowerCase();
  return (desc.includes("wing") && desc.includes("box")) || product.type === "Wing Box";
}

function getWingBoxSize(product: Product): "wing_8" | "wing_10" | "wing_12" | "wing_14" | null {
  const desc = product.description.toLowerCase();
  if (desc.includes("14")) return "wing_14";
  if (desc.includes("12")) return "wing_12";
  if (desc.includes("10")) return "wing_10";
  if (desc.includes("8")) return "wing_8";
  return null;
}

// ── Aggregation ──────────────────────────────────────────────

export function aggregateStoreWeek(
  rows: RawOrderRow[],
  productLookup: Map<string, Product>,
  year: number
): StoreWeekAggregates {
  const agg: StoreWeekAggregates = {
    store_code: rows[0]?.company_name ?? "",
    week_number: rows[0]?.week_number ?? 0,
    year,
    cheese_by_sku: new Map(),
    total_cheese_oz: 0,
    total_sauce_floz: 0,
    total_flour_kg: 0,
    dough_by_sku: new Map(),
    total_dough_kg: 0,
    boxes_small: 0,
    boxes_medium: 0,
    boxes_large: 0,
    boxes_xl: 0,
    boxes_party_20: 0,
    boxes_party_21x15: 0,
    boxes_clamshell: 0,
    boxes_plates: 0,
    wing_8: 0,
    wing_10: 0,
    wing_12: 0,
    wing_14: 0,
  };

  for (const row of rows) {
    const product = productLookup.get(String(row.product_code));
    if (!product) continue;
    const qty = row.total_qty;

    switch (product.type) {
      case "Cheese": {
        const existing = agg.cheese_by_sku.get(product.code) ?? { qty: 0, weight_kg: product.weight };
        existing.qty += qty;
        agg.cheese_by_sku.set(product.code, existing);
        agg.total_cheese_oz += qty * product.weight * KG_TO_OZ;
        break;
      }
      case "Pizza Sauce": {
        if (product.weight_unit === "Fl oz" || product.weight_unit === "fl oz") {
          agg.total_sauce_floz += qty * product.weight;
        }
        break;
      }
      case "Flour": {
        agg.total_flour_kg += qty * product.weight;
        break;
      }
      case "Dough": {
        const existing = agg.dough_by_sku.get(product.code) ?? { qty: 0, weight_kg: product.weight };
        existing.qty += qty;
        agg.dough_by_sku.set(product.code, existing);
        agg.total_dough_kg += qty * product.weight;
        break;
      }
      case "Packaging": {
        if (isWingBox(product)) {
          const ws = getWingBoxSize(product);
          if (ws) agg[ws] += qty;
        } else {
          const size = getBoxSize(product);
          if (size) {
            switch (size) {
              case "small": agg.boxes_small += qty; break;
              case "medium": agg.boxes_medium += qty; break;
              case "large": agg.boxes_large += qty; break;
              case "xl": agg.boxes_xl += qty; break;
              case "party_20": agg.boxes_party_20 += qty; break;
              case "party_21x15": agg.boxes_party_21x15 += qty; break;
              case "clamshell": agg.boxes_clamshell += qty * (product.weight || BOXES_PER_CASE); break; // store individual units (weight = units/case)
              case "plate": agg.boxes_plates += qty * (product.weight || PLATES_PER_CASE); break; // store individual units (weight = units/case)
            }
          }
        }
        break;
      }
      case "Wing Box": {
        const ws = getWingBoxSize(product);
        if (ws) agg[ws] += qty;
        break;
      }
      default:
        break;
    }
  }

  return agg;
}

// ── Estimated usage from box orders ──────────────────────────

function sumEstimated(agg: StoreWeekAggregates, field: "cheese_oz" | "sauce_oz" | "dough_kg", includePlates: boolean): number {
  let total =
    agg.boxes_small * BOXES_PER_CASE * BOX_RATIOS.small[field] +
    agg.boxes_medium * BOXES_PER_CASE * BOX_RATIOS.medium[field] +
    agg.boxes_large * BOXES_PER_CASE * BOX_RATIOS.large[field] +
    agg.boxes_xl * BOXES_PER_CASE * BOX_RATIOS.xl[field] +
    agg.boxes_party_20 * BOXES_PER_CASE * BOX_RATIOS.party_20[field] +
    agg.boxes_party_21x15 * BOXES_PER_CASE * BOX_RATIOS.party_21x15[field];

  // Clamshells count for ALL brands (James, July 3 2026).
  // boxes_clamshell stores individual units (not cases), so multiply directly by ratio.
  total += agg.boxes_clamshell * BOX_RATIOS.clamshell[field];

  // Paper plates carry the same per-piece slice usage, but only for
  // TTD/PP/WM stores. boxes_plates is individual units too.
  if (includePlates && agg.boxes_plates > 0) {
    total += agg.boxes_plates * BOX_RATIOS.plate[field];
  }

  // Wing boxes are deliberately NOT counted — volume tracking only
  // (James, July 6 2026: they hold wings, not pizza).

  return total;
}

export function estimatedCheeseOz(agg: StoreWeekAggregates, includePlates: boolean): number {
  return sumEstimated(agg, "cheese_oz", includePlates);
}

export function estimatedSauceFloz(agg: StoreWeekAggregates, includePlates: boolean): number {
  return sumEstimated(agg, "sauce_oz", includePlates);
}

/** Estimated dough (kg) from box orders — before flour conversion */
export function estimatedDoughKg(agg: StoreWeekAggregates, includePlates: boolean): number {
  return sumEstimated(agg, "dough_kg", includePlates);
}

/** Estimated flour (kg) for Flour stores = estimated dough / 1.6 */
export function estimatedFlourKg(agg: StoreWeekAggregates, includePlates: boolean): number {
  return estimatedDoughKg(agg, includePlates) / FLOUR_YIELD_FACTOR;
}

/**
 * Paper plates count toward slice usage for every brand EXCEPT Gino's
 * (Gino's serves slices in clamshells). James, July 3 2026; DD confirmed
 * included July 6 2026.
 */
export function platesCountForBrand(brand: Brand): boolean {
  return brand !== "GINOS";
}

// ── Diff calculations ────────────────────────────────────────

/** Cheese diff in cases of dominant cheese SKU */
export function cheeseDiff(agg: StoreWeekAggregates, estimated: number): number {
  if (agg.cheese_by_sku.size === 0) return 0;
  let maxQty = 0;
  let divisorKg = 10;
  for (const [, info] of agg.cheese_by_sku) {
    if (info.qty > maxQty) { maxQty = info.qty; divisorKg = info.weight_kg; }
  }
  const caseOz = divisorKg * KG_TO_OZ;
  return caseOz === 0 ? 0 : (agg.total_cheese_oz - estimated) / caseOz;
}

/** Sauce diff in cases */
export function sauceDiff(totalFloz: number, estimated: number): number {
  return SAUCE_CASE_FLOZ === 0 ? 0 : (totalFloz - estimated) / SAUCE_CASE_FLOZ;
}

/** Flour diff in bags (Flour stores) */
export function flourDiff(totalKg: number, estimated: number): number {
  return (totalKg - estimated) / FLOUR_BAG_KG;
}

/** Dough diff in cases of dominant dough SKU (Dough stores) */
export function doughDiff(agg: StoreWeekAggregates, estimated: number): number {
  if (agg.dough_by_sku.size === 0) return 0;
  let maxQty = 0;
  let divisorKg = 20; // default
  for (const [, info] of agg.dough_by_sku) {
    if (info.qty > maxQty) { maxQty = info.qty; divisorKg = info.weight_kg; }
  }
  return divisorKg === 0 ? 0 : (agg.total_dough_kg - estimated) / divisorKg;
}

// ── Ratios ───────────────────────────────────────────────────

export function sauceCheeseRatio(totalSauceFloz: number, totalCheeseOz: number): number {
  if (totalCheeseOz === 0) return 0;
  return (totalSauceFloz / SAUCE_RATIO_DIVISOR) / (totalCheeseOz / CHEESE_RATIO_DIVISOR);
}

/** Flour:Cheese for Flour stores: (flour * 1.6 / 0.6) / (cheese / 8) */
export function flourCheeseRatio(totalFlourKg: number, totalCheeseOz: number): number {
  if (totalCheeseOz === 0) return 0;
  return (totalFlourKg * FLOUR_YIELD_FACTOR / DOUGH_RATIO_DIVISOR) / (totalCheeseOz / CHEESE_RATIO_DIVISOR);
}

/** Dough:Cheese for Dough stores: (dough / 0.6) / (cheese / 8) */
export function doughCheeseRatio(totalDoughKg: number, totalCheeseOz: number): number {
  if (totalCheeseOz === 0) return 0;
  return (totalDoughKg / DOUGH_RATIO_DIVISOR) / (totalCheeseOz / CHEESE_RATIO_DIVISOR);
}

// ── Status ───────────────────────────────────────────────────

export function diffStatus(value: number, warn = DEFAULT_DIFF_THRESHOLDS.warn, bad = DEFAULT_DIFF_THRESHOLDS.bad): ComplianceStatus {
  const abs = Math.abs(value);
  if (abs > bad) return "bad";
  if (abs > warn) return "warn";
  return "ok";
}

/** Percentage-based diff status: compares diff as % of estimated */
export function diffStatusPct(ordered: number, estimated: number): ComplianceStatus {
  if (estimated <= 0) return "ok"; // can't calculate % if no estimate
  const pctDiff = Math.abs(ordered - estimated) / estimated;
  if (pctDiff > DEFAULT_PCT_THRESHOLDS.bad) return "bad";
  if (pctDiff > DEFAULT_PCT_THRESHOLDS.warn) return "warn";
  return "ok";
}

export function ratioStatus(value: number, thresholds = DEFAULT_RATIO_THRESHOLDS): ComplianceStatus {
  const pct = value * 100;
  if (pct < thresholds.warn_low || pct > thresholds.warn_high) return "bad";
  if (pct < thresholds.ok_low || pct > thresholds.ok_high) return "warn";
  return "ok";
}

export function overallStatus(statuses: ComplianceStatus[]): ComplianceStatus {
  if (statuses.includes("bad")) return "bad";
  if (statuses.includes("warn")) return "warn";
  return "ok";
}

// ── Flags ────────────────────────────────────────────────────

const FLAG_MEANINGS: Record<FlagType, string> = {
  cheese_over: "Over portioning cheese or buying unapproved boxes",
  cheese_under: "Buying unapproved cheese or under portioning",
  sauce_over: "Over portioning sauce or buying unapproved boxes",
  sauce_under: "Buying unapproved sauce, mixing water, or under portioning",
  flour_over: "Dough too heavy or buying unapproved boxes",
  flour_under: "Dough too light or buying unapproved flour",
  dough_over: "Dough too heavy or buying unapproved boxes",
  dough_under: "Dough too light or buying unapproved dough",
  sc_ratio_low: "Buying unapproved sauce, mixing water, or under portioning sauce",
  sc_ratio_high: "Buying unapproved cheese or under portioning cheese",
  fc_ratio_low: "Dough too light or buying unapproved flour",
  fc_ratio_high: "Buying unapproved cheese or under portioning cheese",
  dc_ratio_low: "Dough too light or buying unapproved dough",
  dc_ratio_high: "Buying unapproved cheese or under portioning cheese",
};

export function generateFlags(metrics: WeeklyMetrics): Flag[] {
  const flags: Flag[] = [];
  // Diff flags use the same %-of-expected basis the statuses are graded on
  // (was: flat ±6-case thresholds, which over-flagged big stores and
  // under-flagged small ones — a 6-case swing is noise at 40 cases/week and
  // catastrophic at 7). Flag.value for diff flags is the signed % deviation.
  const warnPct = DEFAULT_PCT_THRESHOLDS.warn * 100; // ±25% of expected
  const pctDev = (ordered: number, estimated: number) =>
    estimated > 0 ? ((ordered - estimated) / estimated) * 100 : 0;

  // Cheese
  const cheesePct = pctDev(metrics.cheese_ordered_oz, metrics.cheese_estimated_oz);
  if (cheesePct > warnPct) flags.push({ type: "cheese_over", metric: "Cheese", value: cheesePct, threshold: warnPct, meaning: FLAG_MEANINGS.cheese_over });
  else if (cheesePct < -warnPct) flags.push({ type: "cheese_under", metric: "Cheese", value: cheesePct, threshold: -warnPct, meaning: FLAG_MEANINGS.cheese_under });

  // Sauce
  const saucePct = pctDev(metrics.sauce_ordered_floz, metrics.sauce_estimated_floz);
  if (saucePct > warnPct) flags.push({ type: "sauce_over", metric: "Sauce", value: saucePct, threshold: warnPct, meaning: FLAG_MEANINGS.sauce_over });
  else if (saucePct < -warnPct) flags.push({ type: "sauce_under", metric: "Sauce", value: saucePct, threshold: -warnPct, meaning: FLAG_MEANINGS.sauce_under });

  // Flour or Dough
  if (metrics.store_type === "flour") {
    const flourPct = pctDev(metrics.flour_ordered_kg, metrics.flour_estimated_kg);
    if (flourPct > warnPct) flags.push({ type: "flour_over", metric: "Flour", value: flourPct, threshold: warnPct, meaning: FLAG_MEANINGS.flour_over });
    else if (flourPct < -warnPct) flags.push({ type: "flour_under", metric: "Flour", value: flourPct, threshold: -warnPct, meaning: FLAG_MEANINGS.flour_under });
  } else {
    const doughPct = pctDev(metrics.dough_ordered_kg, metrics.dough_estimated_kg);
    if (doughPct > warnPct) flags.push({ type: "dough_over", metric: "Dough", value: doughPct, threshold: warnPct, meaning: FLAG_MEANINGS.dough_over });
    else if (doughPct < -warnPct) flags.push({ type: "dough_under", metric: "Dough", value: doughPct, threshold: -warnPct, meaning: FLAG_MEANINGS.dough_under });
  }

  // S:C ratio
  const scPct = metrics.sauce_cheese_ratio * 100;
  if (scPct > 0 && scPct < DEFAULT_RATIO_THRESHOLDS.ok_low) flags.push({ type: "sc_ratio_low", metric: "S:C Ratio", value: scPct, threshold: DEFAULT_RATIO_THRESHOLDS.ok_low, meaning: FLAG_MEANINGS.sc_ratio_low });
  else if (scPct > DEFAULT_RATIO_THRESHOLDS.ok_high) flags.push({ type: "sc_ratio_high", metric: "S:C Ratio", value: scPct, threshold: DEFAULT_RATIO_THRESHOLDS.ok_high, meaning: FLAG_MEANINGS.sc_ratio_high });

  // F:C or D:C ratio
  if (metrics.store_type === "flour") {
    const fcPct = metrics.flour_cheese_ratio * 100;
    if (fcPct > 0 && fcPct < DEFAULT_RATIO_THRESHOLDS.ok_low) flags.push({ type: "fc_ratio_low", metric: "F:C Ratio", value: fcPct, threshold: DEFAULT_RATIO_THRESHOLDS.ok_low, meaning: FLAG_MEANINGS.fc_ratio_low });
    else if (fcPct > DEFAULT_RATIO_THRESHOLDS.ok_high) flags.push({ type: "fc_ratio_high", metric: "F:C Ratio", value: fcPct, threshold: DEFAULT_RATIO_THRESHOLDS.ok_high, meaning: FLAG_MEANINGS.fc_ratio_high });
  } else {
    const dcPct = metrics.dough_cheese_ratio * 100;
    if (dcPct > 0 && dcPct < DEFAULT_RATIO_THRESHOLDS.ok_low) flags.push({ type: "dc_ratio_low", metric: "D:C Ratio", value: dcPct, threshold: DEFAULT_RATIO_THRESHOLDS.ok_low, meaning: FLAG_MEANINGS.dc_ratio_low });
    else if (dcPct > DEFAULT_RATIO_THRESHOLDS.ok_high) flags.push({ type: "dc_ratio_high", metric: "D:C Ratio", value: dcPct, threshold: DEFAULT_RATIO_THRESHOLDS.ok_high, meaning: FLAG_MEANINGS.dc_ratio_high });
  }

  return flags;
}

/**
 * How far off a store's single worst metric is, as a fraction (0 = dead on
 * target, 1.0 = 100% off). Used to rank stores WITHIN the same overall_status
 * tier by actual severity, worst first.
 *
 * Before this, "Stores Requiring Attention" broke ties by generateFlags()
 * count -- but flags use old flat case-count thresholds while overall_status
 * uses %-based ones, so most stores tied at 0-1 flags and the list's "top"
 * slot fell to whichever tied row the database happened to return first
 * (James, July 10-11 2026: the list implies the top is highest priority, but
 * it wasn't actually ranking that way). This scores every store on the same
 * %-basis that actually determines status, so the ranking is genuine.
 *
 * Diff metrics use this week's raw ordered-vs-estimated deviation (the exact
 * numbers already shown in the Cheese/Sauce Δ columns) rather than the
 * smoothed rolling average used for grading -- a deliberate simplification so
 * the sort order is visually self-explanatory next to what's on screen.
 * Ratio metrics score as distance from the ideal 100%.
 */
export function severityScore(m: WeeklyMetrics): number {
  const pctDiff = (ordered: number, estimated: number) =>
    estimated > 0 ? Math.abs(ordered - estimated) / estimated : 0;
  const ratioSeverity = (ratio: number) => (ratio > 0 ? Math.abs(ratio * 100 - 100) / 100 : 0);

  const flourOrDough =
    m.store_type === "flour"
      ? pctDiff(m.flour_ordered_kg, m.flour_estimated_kg)
      : pctDiff(m.dough_ordered_kg, m.dough_estimated_kg);
  const flourOrDoughRatio =
    m.store_type === "flour" ? ratioSeverity(m.flour_cheese_ratio) : ratioSeverity(m.dough_cheese_ratio);

  return Math.max(
    pctDiff(m.cheese_ordered_oz, m.cheese_estimated_oz),
    pctDiff(m.sauce_ordered_floz, m.sauce_estimated_floz),
    flourOrDough,
    ratioSeverity(m.sauce_cheese_ratio),
    flourOrDoughRatio
  );
}

// ── Main computation entry point ─────────────────────────────

/**
 * One week's ordered amounts AND box-expected estimates, used for rolling-window
 * smoothing. Both sides are carried so we can average orders and box-expected
 * together — see smoothedDiffStatuses.
 */
export interface RollingWeek {
  cheese_ordered_oz: number;
  sauce_ordered_floz: number;
  flour_ordered_kg: number;
  dough_ordered_kg: number;
  cheese_estimated_oz: number;
  sauce_estimated_floz: number;
  flour_estimated_kg: number;
  dough_estimated_kg: number;
}

/** @deprecated use RollingWeek (carries estimates too, for both-sides smoothing) */
export type PriorWeekData = RollingWeek;

/**
 * Compute the four ingredient diff statuses for a week using a 4-week rolling
 * window (the current week plus up to 3 prior weeks), smoothing BOTH the ordered
 * amounts and the box-expected estimates.
 *
 * Smoothing both sides is the fix for the "stocked up one week, ordered light the
 * next" problem: grading a single week in isolation lets a stock-up spike trip
 * At Risk even though the store evens out over a month. We average orders AND
 * box-expected across the window, then compare the two averages.
 *
 * The ratio statuses (S:C, F:C, D:C) are smoothed the same way, in the parallel
 * smoothedRatioStatuses below — kept a separate function so each stays simple.
 *
 * `prior` is the up-to-3 immediately preceding weeks (order within the array does
 * not matter — it's an average). Pass [] to grade the week in isolation.
 *
 * This is the single source of truth for rolling-average status. The upload path,
 * the historical importer, and the re-score backfill all call it so the smoothing
 * can never drift between them again.
 */
export function smoothedDiffStatuses(
  current: RollingWeek,
  prior: RollingWeek[],
  storeType: StoreType
): {
  cheese_status: ComplianceStatus;
  sauce_status: ComplianceStatus;
  flour_status: ComplianceStatus;
  dough_status: ComplianceStatus;
} {
  const window = [current, ...prior];
  const n = window.length;
  const avg = (sel: (w: RollingWeek) => number) =>
    window.reduce((s, w) => s + (sel(w) || 0), 0) / n;

  return {
    cheese_status: diffStatusPct(avg((w) => w.cheese_ordered_oz), avg((w) => w.cheese_estimated_oz)),
    sauce_status: diffStatusPct(avg((w) => w.sauce_ordered_floz), avg((w) => w.sauce_estimated_floz)),
    // Computed for all store types: dough stores carry a flour-equivalent in
    // flour_ordered_kg (dough / 1.6), so this colors their displayed Flour tile
    // and equals their dough_status. Overall grading for dough stores still uses
    // dough_status, so this is display-only.
    flour_status: diffStatusPct(avg((w) => w.flour_ordered_kg), avg((w) => w.flour_estimated_kg)),
    dough_status:
      storeType === "dough"
        ? diffStatusPct(avg((w) => w.dough_ordered_kg), avg((w) => w.dough_estimated_kg))
        : ("ok" as ComplianceStatus),
  };
}

/**
 * Compute the ingredient-ratio statuses (S:C, and F:C or D:C) over the same
 * 4-week rolling window, by averaging each ordered total across the window and
 * computing the ratio from those averages — then grading with ratioStatus.
 *
 * Ratios are now smoothed like the diffs (James, July 14 2026): a single slow
 * week (summer volume dips, or a store working down leftover stock) would swing
 * S:C/F:C out of band and trip At Risk even though it self-corrects in a week or
 * two. Averaging the window steadies that out. The single-week ratio VALUES are
 * still stored/displayed as-is; only the STATUS (compliance colour) is smoothed
 * — exactly the diff pattern (single-week diff shown, smoothed status).
 */
export function smoothedRatioStatuses(
  current: RollingWeek,
  prior: RollingWeek[],
  storeType: StoreType
): {
  sauce_cheese_status: ComplianceStatus;
  flour_cheese_status: ComplianceStatus;
  dough_cheese_status: ComplianceStatus;
} {
  const window = [current, ...prior];
  const n = window.length;
  const avg = (sel: (w: RollingWeek) => number) =>
    window.reduce((s, w) => s + (sel(w) || 0), 0) / n;

  const avgCheese = avg((w) => w.cheese_ordered_oz);
  const scRatio = sauceCheeseRatio(avg((w) => w.sauce_ordered_floz), avgCheese);
  return {
    sauce_cheese_status: ratioStatus(scRatio),
    flour_cheese_status:
      storeType === "flour"
        ? ratioStatus(flourCheeseRatio(avg((w) => w.flour_ordered_kg), avgCheese))
        : ("ok" as ComplianceStatus),
    dough_cheese_status:
      storeType === "dough"
        ? ratioStatus(doughCheeseRatio(avg((w) => w.dough_ordered_kg), avgCheese))
        : ("ok" as ComplianceStatus),
  };
}

/** One store-week's rolling inputs (ordered + estimated totals) plus store type,
 * enough to recompute BOTH the smoothed diff statuses and the smoothed ratio
 * statuses over the window. */
export interface RollingStatusRow extends RollingWeek {
  store_type: StoreType;
}

/**
 * Canonical rolling-average status recompute for a store's FULL chronological
 * series of weeks (sorted by week_number ascending, gap-tolerant).
 *
 * This is the single source of truth for "what should week i's status be
 * given its own data and the up-to-3 rows immediately before it." Both the
 * historical rescore script and the upload route MUST call this instead of
 * reimplementing the windowing — a GINOS008 week-27 case (James, July 10
 * 2026) showed the upload-time computation and a fresh rescore disagreeing
 * for a small number of stores, most likely from a data-availability quirk
 * at the moment of upload. Centralizing the algorithm makes that class of
 * drift structurally impossible: there is no second implementation left to
 * disagree with.
 */
export function recomputeRollingStatuses(
  rows: RollingStatusRow[]
): {
  cheese_status: ComplianceStatus; sauce_status: ComplianceStatus; flour_status: ComplianceStatus; dough_status: ComplianceStatus;
  sauce_cheese_status: ComplianceStatus; flour_cheese_status: ComplianceStatus; dough_cheese_status: ComplianceStatus;
  overall_status: ComplianceStatus;
}[] {
  return rows.map((row, i) => {
    const prior = rows.slice(Math.max(0, i - 3), i);
    const diff = smoothedDiffStatuses(row, prior, row.store_type);
    const ratios = smoothedRatioStatuses(row, prior, row.store_type);
    const ratioList: ComplianceStatus[] =
      row.store_type === "flour"
        ? [ratios.sauce_cheese_status, ratios.flour_cheese_status]
        : [ratios.sauce_cheese_status, ratios.dough_cheese_status];
    const diffList: ComplianceStatus[] =
      row.store_type === "flour"
        ? [diff.cheese_status, diff.sauce_status, diff.flour_status]
        : [diff.cheese_status, diff.sauce_status, diff.dough_status];
    return { ...diff, ...ratios, overall_status: overallStatus([...diffList, ...ratioList]) };
  });
}

export function computeWeeklyMetrics(
  rows: RawOrderRow[],
  productLookup: Map<string, Product>,
  year: number,
  storeType: StoreType = "flour",
  brand: Brand = "GINOS",
  priorWeeks?: RollingWeek[] // last 3 weeks (not including current) for 4-week rolling avg
): Omit<WeeklyMetrics, "id"> {
  const agg = aggregateStoreWeek(rows, productLookup, year);
  // Clamshells count for every brand; paper plates only for TTD/PP/WM.
  const inclPlates = platesCountForBrand(brand);

  // Estimated usage (from this week's box orders)
  const cheeseEst = estimatedCheeseOz(agg, inclPlates);
  const sauceEst = estimatedSauceFloz(agg, inclPlates);
  const doughEst = estimatedDoughKg(agg, inclPlates);
  const flourEst = doughEst / FLOUR_YIELD_FACTOR;

  // Diffs (always reported for the single week — only the STATUS is smoothed)
  const cDiff = cheeseDiff(agg, cheeseEst);
  const sDiff = sauceDiff(agg.total_sauce_floz, sauceEst);
  const dDiff = storeType === "dough" ? doughDiff(agg, doughEst) : 0;

  // Ratios
  const scRatio = sauceCheeseRatio(agg.total_sauce_floz, agg.total_cheese_oz);
  const dcRatio = storeType === "dough" ? doughCheeseRatio(agg.total_dough_kg, agg.total_cheese_oz) : 0;

  // Universal flour metric = total flour input expressed in flour bags:
  // real flour ordered PLUS any pre-portioned dough converted back to flour
  // (dough / 1.6). This makes the one "Flour" column correct for every store —
  // pure-flour (Gino's/TTD), pure-dough (DD/WM, most PP/WM), and the PP/WM
  // hybrids that buy some of each (James, July 7-8 2026: show dough as a flour
  // equivalent, and evaluate flour + dough combined for PP/WM). When dough is 0
  // this is just the flour ordered; when flour is 0 it is the dough equivalent.
  //   flourCheeseRatio(flour + dough/1.6) collapses to D:C when flour is 0 and
  //   to the normal F:C when dough is 0, so pure-dough grades are unchanged.
  const flourOrdered = agg.total_flour_kg + agg.total_dough_kg / FLOUR_YIELD_FACTOR;
  const flourDiffVal = flourDiff(flourOrdered, flourEst);
  const flourCheeseRatioVal = flourCheeseRatio(flourOrdered, agg.total_cheese_oz);

  // Status — BOTH diff and ratio statuses use the 4-week rolling window (current
  // + up to 3 prior weeks), smoothing orders and box-expected. With no prior
  // weeks supplied this grades the week in isolation (window of 1). The diff and
  // ratio VALUES above are still this single week's; only the STATUS is smoothed.
  const current: RollingWeek = {
    cheese_ordered_oz: agg.total_cheese_oz,
    sauce_ordered_floz: agg.total_sauce_floz,
    flour_ordered_kg: flourOrdered, // flour-equivalent for dough stores
    dough_ordered_kg: agg.total_dough_kg,
    cheese_estimated_oz: cheeseEst,
    sauce_estimated_floz: sauceEst,
    flour_estimated_kg: flourEst,
    dough_estimated_kg: doughEst,
  };
  const { cheese_status: cStatus, sauce_status: sStatus, flour_status: fStatus, dough_status: dStatus } =
    smoothedDiffStatuses(current, priorWeeks ?? [], storeType);
  const { sauce_cheese_status: scStatus, flour_cheese_status: fcStatus, dough_cheese_status: dcStatus } =
    smoothedRatioStatuses(current, priorWeeks ?? [], storeType);

  const relevantStatuses = storeType === "flour"
    ? [cStatus, sStatus, fStatus, scStatus, fcStatus]
    : [cStatus, sStatus, dStatus, scStatus, dcStatus];
  const overall = overallStatus(relevantStatuses);

  // Box totals — boxes_clamshell/boxes_plates are already individual pieces
  // (aggregation multiplies cases x units/case), so they join after the x40.
  // Plates only count where they count toward usage, so a GINOS store's
  // plate order doesn't inflate its box total without moving its estimate.
  const platePieces = inclPlates ? agg.boxes_plates : 0;
  const totalBoxesCases =
    agg.boxes_small + agg.boxes_medium + agg.boxes_large +
    agg.boxes_xl + agg.boxes_party_20 + agg.boxes_party_21x15;
  const totalBoxUnits = totalBoxesCases * BOXES_PER_CASE + agg.boxes_clamshell + platePieces;

  const estPizzaSales =
    agg.boxes_small * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.small +
    agg.boxes_medium * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.medium +
    agg.boxes_large * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.large +
    agg.boxes_xl * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.xl +
    agg.boxes_party_20 * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.party_20 +
    agg.boxes_party_21x15 * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.party_21x15 +
    agg.boxes_clamshell * PIZZA_SALES_PER_CASE.clamshell +
    platePieces * PIZZA_SALES_PER_CASE.plate;

  return {
    store_id: "",
    store_code: agg.store_code,
    store_type: storeType,
    week_number: agg.week_number,
    year: agg.year,

    cheese_ordered_oz: round2(agg.total_cheese_oz),
    sauce_ordered_floz: round2(agg.total_sauce_floz),
    flour_ordered_kg: round2(flourOrdered), // flour-equivalent for dough stores
    dough_ordered_kg: round2(agg.total_dough_kg),

    boxes_small: agg.boxes_small * BOXES_PER_CASE,
    boxes_medium: agg.boxes_medium * BOXES_PER_CASE,
    boxes_large: agg.boxes_large * BOXES_PER_CASE,
    boxes_xl: agg.boxes_xl * BOXES_PER_CASE,
    boxes_party: agg.boxes_party_20 * BOXES_PER_CASE,
    boxes_party_21x15: agg.boxes_party_21x15 * BOXES_PER_CASE,
    boxes_clamshell: agg.boxes_clamshell,
    boxes_plates: platePieces,
    boxes_total: totalBoxUnits,

    cheese_estimated_oz: round2(cheeseEst),
    sauce_estimated_floz: round2(sauceEst),
    flour_estimated_kg: round2(flourEst),
    dough_estimated_kg: round2(doughEst),

    cheese_diff: round2(cDiff),
    sauce_diff: round2(sDiff),
    flour_diff: round2(flourDiffVal), // flour-equivalent bags for dough stores
    dough_diff: round2(dDiff),

    sauce_cheese_ratio: round4(scRatio),
    flour_cheese_ratio: round4(flourCheeseRatioVal), // = dough:cheese for dough stores
    dough_cheese_ratio: round4(dcRatio),

    total_boxes_ordered: totalBoxUnits,
    estimated_pizza_sales: estPizzaSales,
    weekly_pizza_sales: Math.round(estPizzaSales / 4),

    cheese_status: cStatus,
    sauce_status: sStatus,
    flour_status: fStatus,
    dough_status: dStatus,
    sauce_cheese_status: scStatus,
    flour_cheese_status: fcStatus,
    dough_cheese_status: dcStatus,
    overall_status: overall,
  };
}

// ── Network stats ────────────────────────────────────────────

export function computeNetworkStats(metrics: WeeklyMetrics[]): NetworkStats {
  if (metrics.length === 0) {
    return {
      total_stores: 0, compliant_count: 0, borderline_count: 0, at_risk_count: 0,
      compliance_pct: 0, avg_cheese_diff: 0, avg_sauce_diff: 0, avg_flour_diff: 0,
      avg_sauce_cheese_ratio: 0, avg_flour_cheese_ratio: 0, active_flags: 0,
      sauce_cheese_in_band_pct: 0, flour_cheese_in_band_pct: 0, stores_reporting: 0,
      cheese_on_target_pct: 0, sauce_on_target_pct: 0, flour_on_target_pct: 0,
    };
  }

  const n = metrics.length;
  let compliant = 0, borderline = 0, atRisk = 0, totalFlags = 0, scInBand = 0, fcInBand = 0;
  let sumCheese = 0, sumSauce = 0, sumFlour = 0, sumSC = 0, sumFC = 0;
  // "% of stores on target": share of measurable stores within ±25% of the
  // box-expected amount for each ingredient. Signed network AVERAGES cancel
  // (51 stores over + 23 under netted to "+0.8 cases" while the average store
  // was 50% off — James, July 11 2026), so the share on target is the honest
  // headline; the signed avg stays available as secondary context.
  const warnFrac = DEFAULT_PCT_THRESHOLDS.warn;
  let cheeseMeasurable = 0, cheeseOnTarget = 0;
  let sauceMeasurable = 0, sauceOnTarget = 0;
  let flourMeasurable = 0, flourOnTarget = 0;

  for (const m of metrics) {
    if (m.overall_status === "ok") compliant++;
    else if (m.overall_status === "warn") borderline++;
    else atRisk++;

    totalFlags += generateFlags(m).length;

    const scPct = m.sauce_cheese_ratio * 100;
    // For flour/dough ratio, use whichever is active
    const fdRatio = m.store_type === "flour" ? m.flour_cheese_ratio : m.dough_cheese_ratio;
    const fdPct = fdRatio * 100;

    if (scPct >= DEFAULT_RATIO_THRESHOLDS.ok_low && scPct <= DEFAULT_RATIO_THRESHOLDS.ok_high) scInBand++;
    if (fdPct >= DEFAULT_RATIO_THRESHOLDS.ok_low && fdPct <= DEFAULT_RATIO_THRESHOLDS.ok_high) fcInBand++;

    sumCheese += m.cheese_diff;
    sumSauce += m.sauce_diff;
    sumFlour += m.store_type === "flour" ? m.flour_diff : m.dough_diff;
    sumSC += m.sauce_cheese_ratio;
    sumFC += fdRatio;

    if (m.cheese_estimated_oz > 0) {
      cheeseMeasurable++;
      if (Math.abs(m.cheese_ordered_oz - m.cheese_estimated_oz) / m.cheese_estimated_oz <= warnFrac) cheeseOnTarget++;
    }
    if (m.sauce_estimated_floz > 0) {
      sauceMeasurable++;
      if (Math.abs(m.sauce_ordered_floz - m.sauce_estimated_floz) / m.sauce_estimated_floz <= warnFrac) sauceOnTarget++;
    }
    const fdOrdered = m.store_type === "flour" ? m.flour_ordered_kg : m.dough_ordered_kg;
    const fdEstimated = m.store_type === "flour" ? m.flour_estimated_kg : m.dough_estimated_kg;
    if (fdEstimated > 0) {
      flourMeasurable++;
      if (Math.abs(fdOrdered - fdEstimated) / fdEstimated <= warnFrac) flourOnTarget++;
    }
  }

  return {
    total_stores: n,
    compliant_count: compliant,
    borderline_count: borderline,
    at_risk_count: atRisk,
    compliance_pct: round2((compliant / n) * 100),
    avg_cheese_diff: round2(sumCheese / n),
    avg_sauce_diff: round2(sumSauce / n),
    avg_flour_diff: round2(sumFlour / n),
    avg_sauce_cheese_ratio: round4(sumSC / n),
    avg_flour_cheese_ratio: round4(sumFC / n),
    active_flags: totalFlags,
    sauce_cheese_in_band_pct: round2((scInBand / n) * 100),
    flour_cheese_in_band_pct: round2((fcInBand / n) * 100),
    stores_reporting: n,
    cheese_on_target_pct: cheeseMeasurable > 0 ? round2((cheeseOnTarget / cheeseMeasurable) * 100) : 0,
    sauce_on_target_pct: sauceMeasurable > 0 ? round2((sauceOnTarget / sauceMeasurable) * 100) : 0,
    flour_on_target_pct: flourMeasurable > 0 ? round2((flourOnTarget / flourMeasurable) * 100) : 0,
  };
}

export function computeBrandStats(
  metrics: WeeklyMetrics[],
  storeMap: Map<string, { brand: Brand }>
): BrandStats[] {
  const brandColors: Record<Brand, string> = {
    GINOS: "#E2231A", TTD: "#0E5FAE", PP: "#7A2A2A",
    STORE: "#3D6644", DD: "#9C5B14", WM: "#7A2A2A", OTHER: "#7A7670",
  };

  const byBrand = new Map<Brand, { total: number; compliant: number }>();
  for (const m of metrics) {
    const brand = storeMap.get(m.store_id)?.brand ?? "OTHER";
    const entry = byBrand.get(brand) ?? { total: 0, compliant: 0 };
    entry.total++;
    if (m.overall_status === "ok") entry.compliant++;
    byBrand.set(brand, entry);
  }

  return Array.from(byBrand.entries())
    .map(([brand, data]) => ({
      brand,
      color: brandColors[brand],
      store_count: data.total,
      compliant_count: data.compliant,
      compliance_pct: data.total > 0 ? round2((data.compliant / data.total) * 100) : 0,
    }))
    .sort((a, b) => b.store_count - a.store_count);
}

// ── Brand / store type detection ─────────────────────────────

export function detectBrand(storeCode: string): Brand {
  const upper = storeCode.toUpperCase().trim();
  if (upper.startsWith("GINOS")) return "GINOS";
  if (upper.startsWith("TTD")) return "TTD";
  if (upper.startsWith("PP") || upper.startsWith("WM")) return "PP";
  if (upper.startsWith("STORE") || upper.startsWith("DD")) return "DD";
  return "OTHER";
}

/**
 * Default store type from brand. DD, PP, and WM all buy pre-portioned
 * dough from the commissary rather than flour (James, July 6 2026), so
 * PP now defaults to dough like the rest.
 */
export function defaultStoreType(brand: Brand): StoreType {
  switch (brand) {
    case "GINOS": case "TTD": return "flour";
    case "DD": case "WM": case "STORE": case "PP": return "dough";
    default: return "flour";
  }
}

// A handful of PP/WM stores are hybrids that buy flour and make their own dough
// in-store, exactly like Gino's, so they must be graded on the flour method even
// though PP/WM defaults to dough (James, July 8 2026). Identified by their
// WM-number prefix; the GINOS suffix in the full code varies.
export const FLOUR_METHOD_STORE_PREFIXES = ["PP/WM27", "PP/WM33", "PP/WM35", "PP/WM79"];

/**
 * Store type for a specific store: honors the flour-method hybrid overrides
 * above, otherwise falls back to the brand default. Use this everywhere a
 * store's type is resolved so the backfill and live uploads stay in sync.
 */
export function resolveStoreType(code: string, brand: Brand): StoreType {
  const c = code.toUpperCase();
  if (FLOUR_METHOD_STORE_PREFIXES.some((p) => c.startsWith(p))) return "flour";
  return defaultStoreType(brand);
}

// ── Helpers ──────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }

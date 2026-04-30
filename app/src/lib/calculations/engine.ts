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
  BOX_RATIOS,
  FLOUR_YIELD_FACTOR,
  PIZZA_SALES_PER_CASE,
  SAUCE_CASE_FLOZ,
  FLOUR_BAG_KG,
  SAUCE_RATIO_DIVISOR,
  CHEESE_RATIO_DIVISOR,
  DOUGH_RATIO_DIVISOR,
  DEFAULT_DIFF_THRESHOLDS,
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

  wing_boxes: number;
}

// ── Box size detection ───────────────────────────────────────

type BoxSize = keyof typeof BOX_RATIOS;

function getBoxSize(product: Product): BoxSize | null {
  const desc = product.description.toLowerCase();

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
    wing_boxes: 0,
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
          agg.wing_boxes += qty;
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
              case "clamshell": agg.boxes_clamshell += qty; break;
            }
          }
        }
        break;
      }
      case "Wing Box": {
        agg.wing_boxes += qty;
        break;
      }
      default:
        break;
    }
  }

  return agg;
}

// ── Estimated usage from box orders ──────────────────────────

function sumEstimated(agg: StoreWeekAggregates, field: "cheese_oz" | "sauce_oz" | "dough_kg", includeClamshell: boolean): number {
  let total =
    agg.boxes_small * BOXES_PER_CASE * BOX_RATIOS.small[field] +
    agg.boxes_medium * BOXES_PER_CASE * BOX_RATIOS.medium[field] +
    agg.boxes_large * BOXES_PER_CASE * BOX_RATIOS.large[field] +
    agg.boxes_xl * BOXES_PER_CASE * BOX_RATIOS.xl[field] +
    agg.boxes_party_20 * BOXES_PER_CASE * BOX_RATIOS.party_20[field] +
    agg.boxes_party_21x15 * BOXES_PER_CASE * BOX_RATIOS.party_21x15[field];

  if (includeClamshell && agg.boxes_clamshell > 0) {
    // Clamshells: units vary by case, but each unit = one slice
    // Using cases * BOXES_PER_CASE as approximation (40 slices per case)
    total += agg.boxes_clamshell * BOXES_PER_CASE * BOX_RATIOS.clamshell[field];
  }

  return total;
}

export function estimatedCheeseOz(agg: StoreWeekAggregates, includeClamshell: boolean): number {
  return sumEstimated(agg, "cheese_oz", includeClamshell);
}

export function estimatedSauceFloz(agg: StoreWeekAggregates, includeClamshell: boolean): number {
  return sumEstimated(agg, "sauce_oz", includeClamshell);
}

/** Estimated dough (kg) from box orders — before flour conversion */
export function estimatedDoughKg(agg: StoreWeekAggregates, includeClamshell: boolean): number {
  return sumEstimated(agg, "dough_kg", includeClamshell);
}

/** Estimated flour (kg) for Flour stores = estimated dough / 1.6 */
export function estimatedFlourKg(agg: StoreWeekAggregates, includeClamshell: boolean): number {
  return estimatedDoughKg(agg, includeClamshell) / FLOUR_YIELD_FACTOR;
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
  const bad = DEFAULT_DIFF_THRESHOLDS.bad;

  // Cheese
  if (metrics.cheese_diff > bad) flags.push({ type: "cheese_over", metric: "Cheese", value: metrics.cheese_diff, threshold: bad, meaning: FLAG_MEANINGS.cheese_over });
  else if (metrics.cheese_diff < -bad) flags.push({ type: "cheese_under", metric: "Cheese", value: metrics.cheese_diff, threshold: -bad, meaning: FLAG_MEANINGS.cheese_under });

  // Sauce
  if (metrics.sauce_diff > bad) flags.push({ type: "sauce_over", metric: "Sauce", value: metrics.sauce_diff, threshold: bad, meaning: FLAG_MEANINGS.sauce_over });
  else if (metrics.sauce_diff < -bad) flags.push({ type: "sauce_under", metric: "Sauce", value: metrics.sauce_diff, threshold: -bad, meaning: FLAG_MEANINGS.sauce_under });

  // Flour or Dough
  if (metrics.store_type === "flour") {
    if (metrics.flour_diff > bad) flags.push({ type: "flour_over", metric: "Flour", value: metrics.flour_diff, threshold: bad, meaning: FLAG_MEANINGS.flour_over });
    else if (metrics.flour_diff < -bad) flags.push({ type: "flour_under", metric: "Flour", value: metrics.flour_diff, threshold: -bad, meaning: FLAG_MEANINGS.flour_under });
  } else {
    if (metrics.dough_diff > bad) flags.push({ type: "dough_over", metric: "Dough", value: metrics.dough_diff, threshold: bad, meaning: FLAG_MEANINGS.dough_over });
    else if (metrics.dough_diff < -bad) flags.push({ type: "dough_under", metric: "Dough", value: metrics.dough_diff, threshold: -bad, meaning: FLAG_MEANINGS.dough_under });
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

// ── Main computation entry point ─────────────────────────────

export function computeWeeklyMetrics(
  rows: RawOrderRow[],
  productLookup: Map<string, Product>,
  year: number,
  storeType: StoreType = "flour",
  storeIsClamshell = false // true for GINOS stores that use clamshells
): Omit<WeeklyMetrics, "id"> {
  const agg = aggregateStoreWeek(rows, productLookup, year);
  const inclClam = storeIsClamshell;

  // Estimated usage
  const cheeseEst = estimatedCheeseOz(agg, inclClam);
  const sauceEst = estimatedSauceFloz(agg, inclClam);
  const doughEst = estimatedDoughKg(agg, inclClam);
  const flourEst = doughEst / FLOUR_YIELD_FACTOR;

  // Diffs
  const cDiff = cheeseDiff(agg, cheeseEst);
  const sDiff = sauceDiff(agg.total_sauce_floz, sauceEst);
  const fDiff = storeType === "flour" ? flourDiff(agg.total_flour_kg, flourEst) : 0;
  const dDiff = storeType === "dough" ? doughDiff(agg, doughEst) : 0;

  // Ratios
  const scRatio = sauceCheeseRatio(agg.total_sauce_floz, agg.total_cheese_oz);
  const fcRatio = storeType === "flour" ? flourCheeseRatio(agg.total_flour_kg, agg.total_cheese_oz) : 0;
  const dcRatio = storeType === "dough" ? doughCheeseRatio(agg.total_dough_kg, agg.total_cheese_oz) : 0;

  // Status
  const cStatus = diffStatus(cDiff);
  const sStatus = diffStatus(sDiff);
  const fStatus = storeType === "flour" ? diffStatus(fDiff) : "ok" as ComplianceStatus;
  const dStatus = storeType === "dough" ? diffStatus(dDiff) : "ok" as ComplianceStatus;
  const scStatus = ratioStatus(scRatio);
  const fcStatus = storeType === "flour" ? ratioStatus(fcRatio) : "ok" as ComplianceStatus;
  const dcStatus = storeType === "dough" ? ratioStatus(dcRatio) : "ok" as ComplianceStatus;

  const relevantStatuses = storeType === "flour"
    ? [cStatus, sStatus, fStatus, scStatus, fcStatus]
    : [cStatus, sStatus, dStatus, scStatus, dcStatus];
  const overall = overallStatus(relevantStatuses);

  // Box totals
  const totalBoxesCases =
    agg.boxes_small + agg.boxes_medium + agg.boxes_large +
    agg.boxes_xl + agg.boxes_party_20 + agg.boxes_party_21x15 + agg.boxes_clamshell;

  const estPizzaSales =
    agg.boxes_small * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.small +
    agg.boxes_medium * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.medium +
    agg.boxes_large * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.large +
    agg.boxes_xl * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.xl +
    agg.boxes_party_20 * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.party_20 +
    agg.boxes_party_21x15 * BOXES_PER_CASE * PIZZA_SALES_PER_CASE.party_21x15;

  return {
    store_id: "",
    store_code: agg.store_code,
    store_type: storeType,
    week_number: agg.week_number,
    year: agg.year,

    cheese_ordered_oz: round2(agg.total_cheese_oz),
    sauce_ordered_floz: round2(agg.total_sauce_floz),
    flour_ordered_kg: round2(agg.total_flour_kg),
    dough_ordered_kg: round2(agg.total_dough_kg),

    boxes_small: agg.boxes_small * BOXES_PER_CASE,
    boxes_medium: agg.boxes_medium * BOXES_PER_CASE,
    boxes_large: agg.boxes_large * BOXES_PER_CASE,
    boxes_xl: agg.boxes_xl * BOXES_PER_CASE,
    boxes_party: agg.boxes_party_20 * BOXES_PER_CASE,
    boxes_party_21x15: agg.boxes_party_21x15 * BOXES_PER_CASE,
    boxes_clamshell: agg.boxes_clamshell * BOXES_PER_CASE,
    boxes_total: totalBoxesCases * BOXES_PER_CASE,

    cheese_estimated_oz: round2(cheeseEst),
    sauce_estimated_floz: round2(sauceEst),
    flour_estimated_kg: round2(flourEst),
    dough_estimated_kg: round2(doughEst),

    cheese_diff: round2(cDiff),
    sauce_diff: round2(sDiff),
    flour_diff: round2(fDiff),
    dough_diff: round2(dDiff),

    sauce_cheese_ratio: round4(scRatio),
    flour_cheese_ratio: round4(fcRatio),
    dough_cheese_ratio: round4(dcRatio),

    total_boxes_ordered: totalBoxesCases * BOXES_PER_CASE,
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
    };
  }

  const n = metrics.length;
  let compliant = 0, borderline = 0, atRisk = 0, totalFlags = 0, scInBand = 0, fcInBand = 0;
  let sumCheese = 0, sumSauce = 0, sumFlour = 0, sumSC = 0, sumFC = 0;

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

/** Default store type from brand. PP/WM stores are assigned by admin. */
export function defaultStoreType(brand: Brand): StoreType {
  switch (brand) {
    case "GINOS": case "TTD": return "flour";
    case "DD": case "WM": case "STORE": return "dough";
    case "PP": return "flour"; // default until admin assigns
    default: return "flour";
  }
}

// ── Helpers ──────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }

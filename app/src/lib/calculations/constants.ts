/**
 * Conversion constants and default thresholds for the Gino's compliance engine.
 *
 * Box ratios confirmed by James on April 28, 2026.
 * See BUSINESS_RULES.md for full documentation.
 */

// ── Unit conversions ─────────────────────────────────────────
export const KG_TO_OZ = 35.27;
export const LITRE_TO_FLOZ = 33.814;
export const BOXES_PER_CASE = 40;

// ── Per-pizza usage assumptions (universal across all brands) ─
// Column is "Dough KG" — this is kg of DOUGH, not flour.
// For Flour stores: divide estimated dough by 1.6 to get flour.
// For Dough stores: use directly.

export const BOX_RATIOS = {
  small:        { cheese_oz: 4,   sauce_oz: 2.5,  dough_kg: 0.3 },
  medium:       { cheese_oz: 6,   sauce_oz: 4,    dough_kg: 0.45 },
  large:        { cheese_oz: 8,   sauce_oz: 5,    dough_kg: 0.6 },
  xl:           { cheese_oz: 10,  sauce_oz: 6,    dough_kg: 0.775 },
  party_20:     { cheese_oz: 16,  sauce_oz: 10,   dough_kg: 1.2 },
  party_21x15:  { cheese_oz: 20,  sauce_oz: 13,   dough_kg: 1.5 },
  clamshell:    { cheese_oz: 2,   sauce_oz: 0.75, dough_kg: 0.097 },
} as const;

// Flour-to-dough yield factor
// flour_kg * 1.6 = dough_kg (for Flour stores)
// estimated_flour = estimated_dough / 1.6
export const FLOUR_YIELD_FACTOR = 1.6;

// ── Estimated pizza sales per box size ───────────────────────
export const PIZZA_SALES_PER_CASE = {
  small: 10,
  medium: 11,
  large: 14,
  xl: 17,
  party_20: 20,
  party_21x15: 20,
  clamshell: 1, // per unit, not per case
} as const;

// ── Diff divisors ────────────────────────────────────────────
// Sauce: weight of one case of V Food sauce in fl oz
export const SAUCE_CASE_FLOZ = LITRE_TO_FLOZ * 6 * 2.84;  // ~576.22

// Flour: 20 kg per bag
export const FLOUR_BAG_KG = 20;

// Dough: uses dominant SKU case weight (dynamic, not constant)

// ── Ratio formulas ───────────────────────────────────────────
// Sauce:Cheese   = (total_sauce / 5) / (total_cheese / 8)
// Flour:Cheese   = (total_flour * 1.6 / 0.6) / (total_cheese / 8)  [Flour stores]
// Dough:Cheese   = (total_dough / 0.6) / (total_cheese / 8)        [Dough stores]
export const SAUCE_RATIO_DIVISOR = 5;
export const CHEESE_RATIO_DIVISOR = 8;
export const DOUGH_RATIO_DIVISOR = 0.6;

// ── Default thresholds (configurable per item in admin) ──────
export const DEFAULT_DIFF_THRESHOLDS = {
  warn: 3,
  bad: 6,
} as const;

export const DEFAULT_RATIO_THRESHOLDS = {
  ok_low: 75,
  ok_high: 125,
  warn_low: 65,
  warn_high: 135,
} as const;

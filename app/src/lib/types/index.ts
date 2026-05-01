// ── User & Auth ─────────────────────────────────────────────

export type UserRole = "super_admin" | "dsm";

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  dsm_id: string | null;
  last_login_at: string | null;
}

// ── DSM & Stores ────────────────────────────────────────────

export interface DSM {
  id: string;
  name: string;
  region: string;
}

export type Brand = "GINOS" | "TTD" | "PP" | "STORE" | "DD" | "WM" | "OTHER";

/** Flour stores mix dough in-store; Dough stores use commissary dough */
export type StoreType = "flour" | "dough";

export interface Store {
  id: string;
  code: string;         // e.g. "GINOS032", "TTD BLOCKLINE"
  name: string;         // display name
  brand: Brand;
  store_type: StoreType; // flour or dough — drives calculation path
  address: string;
  city: string;
  dsm_id: string;
}

// ── Products ────────────────────────────────────────────────

export type ProductType =
  | "Cheese"
  | "Pizza Sauce"
  | "Flour"
  | "Dough"
  | "Packaging"
  | "Wing Box"
  | "Secondary"
  | "Other";

export type Classification = "primary" | "secondary" | "neither";

export interface Product {
  id: string;
  code: string;         // e.g. "20105", "G040114"
  description: string;
  type: ProductType;
  classification: Classification;
  pack_size: string;    // e.g. "4x2.27KG", "6x100 floz"
  weight: number;       // numeric weight in weight_unit
  weight_unit: string;  // "kg", "Fl oz", "each"
}

// ── Uploads ─────────────────────────────────────────────────

export type UploadStatus = "processing" | "completed" | "failed";

export interface Upload {
  id: string;
  filename: string;
  uploaded_by: string;
  uploaded_at: string;
  week_number: number;
  year: number;
  status: UploadStatus;
  rows_processed: number;
  primary_count: number;
  secondary_count: number;
  unclassified_count: number;
}

// ── Raw order data (parsed from Excel) ──────────────────────

export interface RawOrderRow {
  company_name: string;   // CompanyName from Excel
  week_number: number;    // WeekNumber from Excel
  product_code: string;   // productcode from Excel
  description: string;    // description from Excel
  total_qty: number;      // TotalQty from Excel
}

export interface WeeklyOrder {
  id: string;
  upload_id: string;
  store_id: string;
  product_id: string;
  week_number: number;
  year: number;
  quantity: number;
}

// ── Computed Metrics ────────────────────────────────────────

export type ComplianceStatus = "ok" | "warn" | "bad";

export interface WeeklyMetrics {
  id: string;
  store_id: string;
  store_code: string;
  store_type: StoreType;
  week_number: number;
  year: number;

  // Ordered (aggregated from raw orders, in standardized units)
  cheese_ordered_oz: number;
  sauce_ordered_floz: number;
  flour_ordered_kg: number;    // Flour stores only (0 for dough stores)
  dough_ordered_kg: number;    // Dough stores only (0 for flour stores)

  // Box counts (individual boxes, not cases)
  boxes_small: number;
  boxes_medium: number;
  boxes_large: number;
  boxes_xl: number;
  boxes_party: number;
  boxes_party_21x15: number;
  boxes_clamshell: number;     // GINOS only
  boxes_total: number;

  // Estimated usage (derived from box orders)
  cheese_estimated_oz: number;
  sauce_estimated_floz: number;
  flour_estimated_kg: number;    // Flour stores: estimated dough / 1.6
  dough_estimated_kg: number;    // Direct estimated dough from box ratios

  // Differences
  cheese_diff: number;          // in cases (varies by pack size)
  sauce_diff: number;           // in cases
  flour_diff: number;           // in bags (20kg) — Flour stores
  dough_diff: number;           // in cases of dominant dough SKU — Dough stores

  // Ratios
  sauce_cheese_ratio: number;        // target: 75-125%
  flour_cheese_ratio: number;        // Flour stores: (flour*1.6/0.6) / (cheese/8)
  dough_cheese_ratio: number;        // Dough stores: (dough/0.6) / (cheese/8)

  // Estimated sales
  total_boxes_ordered: number;
  estimated_pizza_sales: number;
  weekly_pizza_sales: number;

  // Status
  cheese_status: ComplianceStatus;
  sauce_status: ComplianceStatus;
  flour_status: ComplianceStatus;      // Flour stores
  dough_status: ComplianceStatus;      // Dough stores
  sauce_cheese_status: ComplianceStatus;
  flour_cheese_status: ComplianceStatus;   // Flour stores
  dough_cheese_status: ComplianceStatus;   // Dough stores
  overall_status: ComplianceStatus;
}

// ── Thresholds & Assumptions ────────────────────────────────

export interface DiffThreshold {
  metric: string;
  warn_abs: number;
  bad_abs: number;
}

export interface RatioThreshold {
  metric: string;
  ok_low: number;
  ok_high: number;
  warn_low: number;
  warn_high: number;
}

export type PizzaSize = "small" | "medium" | "large" | "xl" | "party_20" | "party_21x15" | "clamshell";

export interface UsageAssumption {
  pizza_size: PizzaSize;
  cheese_oz: number;
  sauce_oz: number;
  dough_kg: number;       // renamed from flour_kg — this is dough weight
  boxes_per_case: number;
}

// ── Flags ────────────────────────────────────────────────────

export type FlagType =
  | "cheese_over"
  | "cheese_under"
  | "sauce_over"
  | "sauce_under"
  | "flour_over"
  | "flour_under"
  | "dough_over"
  | "dough_under"
  | "sc_ratio_low"
  | "sc_ratio_high"
  | "fc_ratio_low"
  | "fc_ratio_high"
  | "dc_ratio_low"
  | "dc_ratio_high";

export interface Flag {
  type: FlagType;
  metric: string;
  value: number;
  threshold: number;
  meaning: string;
}

// ── Network Stats (computed for overview) ────────────────────

export interface NetworkStats {
  total_stores: number;
  compliant_count: number;
  borderline_count: number;
  at_risk_count: number;
  compliance_pct: number;

  avg_cheese_diff: number;
  avg_sauce_diff: number;
  avg_flour_diff: number;
  avg_sauce_cheese_ratio: number;
  avg_flour_cheese_ratio: number;
  active_flags: number;

  sauce_cheese_in_band_pct: number;
  flour_cheese_in_band_pct: number;
  stores_reporting: number;
}

export interface BrandStats {
  brand: Brand;
  color: string;
  store_count: number;
  compliant_count: number;
  compliance_pct: number;
}

export interface WeeklyTrend {
  week: number;
  year: number;
  compliance_pct: number;
  avg_cheese_diff: number;
  avg_sauce_diff: number;
  avg_flour_diff: number;
  avg_sauce_cheese: number;
  avg_flour_cheese: number;
}

// ── Anomalies ──────────────────────────────────────────────

export type AnomalyType = "extreme_diff" | "zero_cheese" | "zero_boxes" | "week_spike";

export interface Anomaly {
  type: AnomalyType;
  severity: "info" | "warning" | "critical";
  store_code: string;
  store_id: string;
  week: number;
  metric: string;
  value: number;
  description: string;
}

// ── AI ──────────────────────────────────────────────────────

export interface AICall {
  id: string;
  user_id: string;
  called_at: string;
  page_context: string;
  tokens_used: number;
}

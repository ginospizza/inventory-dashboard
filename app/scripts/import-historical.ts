/**
 * Import historical data into Supabase.
 *
 * Steps:
 * 1. Create DSMs from the store list
 * 2. Create stores with DSM references
 * 3. Create products from App Data
 * 4. Parse 2025 + 2026 raw Excel files
 * 5. Compute weekly_metrics using the calculation engine
 * 6. Write everything to Supabase via admin client
 *
 * Usage: npx tsx scripts/import-historical.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as path from "path";
import {
  aggregateStoreWeek,
  computeWeeklyMetrics,
  detectBrand,
  defaultStoreType,
} from "../src/lib/calculations/engine";
import type { Product, RawOrderRow, Brand, StoreType } from "../src/lib/types";

// ── Config ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ROOT = path.resolve(__dirname, "../..");

// ── Helpers ─────────────────────────────────────────────────

function normalizeStoreCode(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*NEW\s*$/i, "")
    .replace(/\s*NEW$/i, "")
    .toUpperCase()
    .trim();
}

// Sheets to skip in 2025 file
const SKIP_SHEETS = new Set([
  "product sheet",
  "exported list",
  "vick",
  "vick values",
  "dsm list",
  "none",
  "pivot",
]);

function shouldSkipSheet(name: string): boolean {
  const lower = name.toLowerCase().trim();
  for (const s of SKIP_SHEETS) {
    if (lower === s || lower.includes("pivot") || lower.includes("values")) return true;
  }
  // Skip DSM named sheets
  const dsmNames = ["vito", "paul", "brijesh", "michel", "jim", "raj", "vick"];
  if (dsmNames.includes(lower)) return true;
  return false;
}

/**
 * Determine year from sheet name date ranges and file context.
 * 2025 file: Nov 2024 → Dec 2025
 * 2026 file: Jan 2026 → Apr 2026
 */
function inferYear(sheetName: string, fileYear: number): number {
  // For 2025 file: sheets with "Nov" or "Dec" before Jan appear could be 2024
  // But the file covers the business's 2025 fiscal period.
  // We'll use the WeekNumber to determine: weeks 46-52 from the 2025 file = year 2024
  // (handled at data level, not sheet level)
  return fileYear;
}

// ── Step 1: Import DSMs ─────────────────────────────────────

async function importDsms(storeListData: Record<string, unknown>[]): Promise<Map<string, string>> {
  const dsmNames = [...new Set(storeListData.map((r) => String(r["DSM"] ?? "").trim()).filter(Boolean))];
  console.log(`Found ${dsmNames.length} DSMs:`, dsmNames);

  const dsmMap = new Map<string, string>(); // name → uuid

  for (const name of dsmNames) {
    const { data, error } = await supabase
      .from("dsms")
      .upsert({ name, region: "Ontario" }, { onConflict: "name" })
      .select("id, name")
      .single();

    if (error) {
      // name isn't unique in schema, try insert
      const { data: existing } = await supabase
        .from("dsms")
        .select("id")
        .eq("name", name)
        .single();

      if (existing) {
        dsmMap.set(name, existing.id);
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from("dsms")
          .insert({ name, region: "Ontario" })
          .select("id")
          .single();

        if (insertErr) {
          console.error(`Failed to create DSM ${name}:`, insertErr);
          continue;
        }
        dsmMap.set(name, inserted!.id);
      }
    } else {
      dsmMap.set(name, data!.id);
    }
  }

  console.log(`Created/found ${dsmMap.size} DSMs`);
  return dsmMap;
}

// ── Step 2: Import Stores ───────────────────────────────────

async function importStores(
  storeListData: Record<string, unknown>[],
  dsmMap: Map<string, string>
): Promise<Map<string, { id: string; brand: Brand; storeType: StoreType }>> {
  const storeMap = new Map<string, { id: string; brand: Brand; storeType: StoreType }>();

  console.log(`\nImporting ${storeListData.length} stores...`);

  for (const row of storeListData) {
    const rawCode = String(row["Store"] ?? "").trim();
    if (!rawCode) continue;

    const code = normalizeStoreCode(rawCode);
    const address = String(row["Address"] ?? "").trim();
    const city = String(row["City"] ?? "").trim();
    const dsmName = String(row["DSM"] ?? "").trim();
    const dsmId = dsmMap.get(dsmName) ?? null;
    const brand = detectBrand(code);
    const storeType = defaultStoreType(brand);

    const { data: existing } = await supabase
      .from("stores")
      .select("id")
      .eq("code", code)
      .single();

    if (existing) {
      storeMap.set(code, { id: existing.id, brand, storeType });
      continue;
    }

    const { data, error } = await supabase
      .from("stores")
      .insert({
        code,
        name: rawCode,
        brand,
        address,
        city,
        dsm_id: dsmId,
        is_active: true,
      })
      .select("id")
      .single();

    if (error) {
      console.error(`Failed to create store ${code}:`, error.message);
      continue;
    }

    storeMap.set(code, { id: data!.id, brand, storeType });
  }

  console.log(`Created/found ${storeMap.size} stores`);
  return storeMap;
}

// ── Step 3: Import Products ─────────────────────────────────

async function importProducts(
  primaryData: Record<string, unknown>[],
  secondaryData: Record<string, unknown>[]
): Promise<Map<string, Product>> {
  const productMap = new Map<string, Product>();

  const allProducts = [
    ...primaryData.map((p) => ({ ...p, classification: "primary" })),
    ...secondaryData.map((p) => ({ ...p, classification: "secondary" })),
  ];

  console.log(`\nImporting ${allProducts.length} products...`);

  for (const row of allProducts as Record<string, unknown>[]) {
    const code = String(row["Product Code"] ?? "").trim();
    if (!code) continue;

    const description = String(row["Item"] ?? "").trim();
    const type = String(row["Type"] ?? "Other").trim();
    const classification = row.classification as string;
    const packSize = String(row["Pack Size"] ?? "").trim();
    const weight = Number(row["Weight"]) || 0;
    const weightUnit = String(row["Weight Unit"] ?? "each").trim();

    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("code", code)
      .single();

    if (existing) {
      productMap.set(code, {
        id: existing.id,
        code,
        description,
        type,
        classification: classification as "primary" | "secondary" | "neither",
        pack_size: packSize,
        weight,
        weight_unit: weightUnit,
      });
      continue;
    }

    const { data, error } = await supabase
      .from("products")
      .insert({
        code,
        description,
        type,
        classification,
        pack_size: packSize,
        weight,
        weight_unit: weightUnit,
      })
      .select("id")
      .single();

    if (error) {
      console.error(`Failed to create product ${code}:`, error.message);
      continue;
    }

    productMap.set(code, {
      id: data!.id,
      code,
      description,
      type,
      classification: classification as "primary" | "secondary" | "neither",
      pack_size: packSize,
      weight,
      weight_unit: weightUnit,
    });
  }

  console.log(`Created/found ${productMap.size} products`);
  return productMap;
}

// ── Step 4: Parse Raw Excel Data ────────────────────────────

function parseWeeklySheet(
  sheet: XLSX.WorkSheet,
  sheetName: string
): RawOrderRow[] {
  // Try parsing with default headers
  let jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });

  if (jsonData.length === 0) return [];

  // Check if first row is "Products Sold" header
  const firstRow = jsonData[0];
  const firstKeys = Object.keys(firstRow);
  const firstVal = String(firstRow[firstKeys[0]] ?? "");

  if (firstVal.startsWith("Products Sold") || firstVal === "CompanyName") {
    // Re-parse with header at row 2
    jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
      range: 1,
    });
  }

  if (jsonData.length === 0) return [];

  // Validate we have the right columns
  const sample = jsonData[0];
  const cols = Object.keys(sample);

  // Find column names (case-insensitive)
  const findCol = (target: string) =>
    cols.find((c) => c.toLowerCase().trim() === target.toLowerCase()) ?? null;

  const companyCol = findCol("CompanyName");
  const weekCol = findCol("WeekNumber");
  const productCol = findCol("productcode");
  const descCol = findCol("description");
  const qtyCol = findCol("TotalQty");

  if (!companyCol || !weekCol || !productCol || !qtyCol) {
    // Not a data sheet with our expected columns
    return [];
  }

  const rows: RawOrderRow[] = [];

  for (const row of jsonData) {
    const companyName = String(row[companyCol] ?? "").trim();
    const weekNumber = Number(row[weekCol]) || 0;
    const productCode = String(row[productCol] ?? "").trim();
    const description = String(row[descCol!] ?? "").trim();
    const qty = Number(row[qtyCol]) || 0;

    if (!companyName || !productCode || qty <= 0) continue;

    // Skip SAPUTO, SUNDRY
    const upper = companyName.toUpperCase();
    if (upper.includes("SAPUTO") || upper.includes("SUNDRY")) continue;

    rows.push({
      company_name: companyName,
      week_number: weekNumber,
      product_code: productCode,
      description,
      total_qty: qty,
    });
  }

  return rows;
}

function parseRawDataFile(filePath: string, limitSheets?: { start?: number; end?: number }): RawOrderRow[] {
  console.log(`\nParsing ${path.basename(filePath)}...`);
  const wb = XLSX.readFile(filePath);
  const allRows: RawOrderRow[] = [];
  let sheetsProcessed = 0;

  // Filter to data sheets only (skip non-data sheets first)
  const dataSheetNames = wb.SheetNames.filter((name) => !shouldSkipSheet(name));

  const start = limitSheets?.start ?? 0;
  const end = limitSheets?.end ?? dataSheetNames.length;
  const selectedSheets = dataSheetNames.slice(start, end);

  console.log(`  Processing sheets ${start}-${end - 1} of ${dataSheetNames.length} data sheets`);

  for (const sheetName of selectedSheets) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;

    const rows = parseWeeklySheet(sheet, sheetName);
    if (rows.length > 0) {
      allRows.push(...rows);
      sheetsProcessed++;
    }
  }

  console.log(`  Parsed ${sheetsProcessed} sheets, ${allRows.length} rows`);
  return allRows;
}

// ── Step 5: Compute and Write Metrics ───────────────────────

async function computeAndWriteMetrics(
  allRows: RawOrderRow[],
  year: number,
  storeMap: Map<string, { id: string; brand: Brand; storeType: StoreType }>,
  productMap: Map<string, Product>
): Promise<void> {
  // Group rows by store + week
  const groupKey = (row: RawOrderRow) =>
    `${normalizeStoreCode(row.company_name)}::${row.week_number}`;

  const groups = new Map<string, RawOrderRow[]>();
  let skippedStores = new Set<string>();

  for (const row of allRows) {
    const normCode = normalizeStoreCode(row.company_name);

    // Skip non-store entries
    if (
      normCode.includes("SAPUTO") ||
      normCode.includes("SUNDRY") ||
      normCode === "GRAND TOTAL" ||
      normCode === ""
    )
      continue;

    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  console.log(`\nComputing metrics for ${groups.size} store-week combinations (year ${year})...`);

  // Auto-create stores that aren't in the store list
  for (const [key, rows] of groups) {
    const normCode = normalizeStoreCode(rows[0].company_name);
    if (!storeMap.has(normCode)) {
      const brand = detectBrand(normCode);
      const storeType = defaultStoreType(brand);

      const { data, error } = await supabase
        .from("stores")
        .insert({
          code: normCode,
          name: rows[0].company_name,
          brand,
          address: "",
          city: "",
          is_active: true,
        })
        .select("id")
        .single();

      if (error) {
        // Might already exist from a concurrent insert
        const { data: existing } = await supabase
          .from("stores")
          .select("id")
          .eq("code", normCode)
          .single();

        if (existing) {
          storeMap.set(normCode, { id: existing.id, brand, storeType });
        } else {
          skippedStores.add(normCode);
          continue;
        }
      } else {
        storeMap.set(normCode, { id: data!.id, brand, storeType });
      }
    }
  }

  if (skippedStores.size > 0) {
    console.log(`  Skipped ${skippedStores.size} unmatched stores:`, [...skippedStores].slice(0, 10));
  }

  // Compute metrics in batches
  const metricsToInsert: Record<string, unknown>[] = [];
  let computed = 0;
  let skipped = 0;

  for (const [key, rows] of groups) {
    const normCode = normalizeStoreCode(rows[0].company_name);
    const storeInfo = storeMap.get(normCode);
    if (!storeInfo) {
      skipped++;
      continue;
    }

    const weekNumber = rows[0].week_number;
    if (!weekNumber || weekNumber <= 0) {
      skipped++;
      continue;
    }

    // Year is determined by the file context, not week number alone.
    // The import caller passes the correct year per file.
    let actualYear = year;

    // Check for GINOS stores that use clamshells
    const isClamshell = storeInfo.brand === "GINOS";

    try {
      const metrics = computeWeeklyMetrics(
        rows,
        productMap,
        actualYear,
        storeInfo.storeType,
        isClamshell
      );

      metricsToInsert.push({
        store_id: storeInfo.id,
        week_number: weekNumber,
        year: actualYear,
        store_type: storeInfo.storeType,
        cheese_ordered_oz: metrics.cheese_ordered_oz,
        sauce_ordered_floz: metrics.sauce_ordered_floz,
        flour_ordered_kg: metrics.flour_ordered_kg,
        dough_ordered_kg: metrics.dough_ordered_kg,
        boxes_small: metrics.boxes_small,
        boxes_medium: metrics.boxes_medium,
        boxes_large: metrics.boxes_large,
        boxes_xl: metrics.boxes_xl,
        boxes_party: metrics.boxes_party,
        boxes_total: metrics.boxes_total,
        cheese_estimated_oz: metrics.cheese_estimated_oz,
        sauce_estimated_floz: metrics.sauce_estimated_floz,
        flour_estimated_kg: metrics.flour_estimated_kg,
        dough_estimated_kg: metrics.dough_estimated_kg,
        cheese_diff: metrics.cheese_diff,
        sauce_diff: metrics.sauce_diff,
        flour_diff: metrics.flour_diff,
        dough_diff: metrics.dough_diff,
        sauce_cheese_ratio: metrics.sauce_cheese_ratio,
        flour_cheese_ratio: metrics.flour_cheese_ratio,
        dough_cheese_ratio: metrics.dough_cheese_ratio,
        total_boxes_ordered: metrics.total_boxes_ordered,
        estimated_pizza_sales: metrics.estimated_pizza_sales,
        weekly_pizza_sales: metrics.weekly_pizza_sales,
        cheese_status: metrics.cheese_status,
        sauce_status: metrics.sauce_status,
        flour_status: metrics.flour_status,
        dough_status: metrics.dough_status,
        sauce_cheese_status: metrics.sauce_cheese_status,
        flour_cheese_status: metrics.flour_cheese_status,
        dough_cheese_status: metrics.dough_cheese_status,
        overall_status: metrics.overall_status,
      });

      computed++;
    } catch (err) {
      console.error(`  Error computing metrics for ${normCode} week ${weekNumber}:`, err);
      skipped++;
    }
  }

  console.log(`  Computed ${computed} metrics, skipped ${skipped}`);

  // Write in batches of 100
  console.log(`  Writing ${metricsToInsert.length} metrics to Supabase...`);
  const BATCH_SIZE = 100;
  let written = 0;
  let writeErrors = 0;

  for (let i = 0; i < metricsToInsert.length; i += BATCH_SIZE) {
    const batch = metricsToInsert.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("weekly_metrics")
      .upsert(batch, { onConflict: "store_id,year,week_number" });

    if (error) {
      console.error(`  Batch write error at ${i}:`, error.message);
      writeErrors++;
    } else {
      written += batch.length;
    }
  }

  console.log(`  Written ${written} metrics (${writeErrors} batch errors)`);
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log("=== Gino's Pizza Historical Data Import ===\n");

  // Load Excel files
  const storeListWb = XLSX.readFile(path.join(ROOT, "Store list  and Box Ratios.xlsx"));
  const appDataWb = XLSX.readFile(path.join(ROOT, "App Data.xlsx"));

  const storeListData = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    storeListWb.Sheets["Store Name List"],
    { defval: null, raw: true }
  );

  const primaryProducts = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    appDataWb.Sheets["Primary"],
    { defval: null, raw: true }
  );
  const secondaryProducts = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    appDataWb.Sheets["Secondary"],
    { defval: null, raw: true }
  );

  // Step 1: DSMs
  const dsmMap = await importDsms(storeListData);

  // Step 2: Stores
  const storeMap = await importStores(storeListData, dsmMap);

  // Step 3: Products
  const productMap = await importProducts(primaryProducts, secondaryProducts);

  // Step 4: Parse raw data
  // 2025 file layout (58 data sheets after skipping non-data):
  //   Sheets 0-5: weeks 47-52 → year 2024 (Nov-Dec 2024)
  //   Sheets 6-57: weeks 1-52 → year 2025 (Jan-Dec 2025)
  const file2025 = path.join(ROOT, "2025 raw data for Gloo.xlsx");
  const rows2024 = parseRawDataFile(file2025, { start: 0, end: 6 });
  const rows2025 = parseRawDataFile(file2025, { start: 6 });
  const rows2026 = parseRawDataFile(path.join(ROOT, "2026 raw data for Gloo.xlsx"));

  // Step 5: Compute & write metrics
  await computeAndWriteMetrics(rows2024, 2024, storeMap, productMap);
  await computeAndWriteMetrics(rows2025, 2025, storeMap, productMap);
  await computeAndWriteMetrics(rows2026, 2026, storeMap, productMap);

  console.log("\n=== Import complete! ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

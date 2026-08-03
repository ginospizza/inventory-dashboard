/**
 * Backfill weekly_orders (per-SKU line items) from the raw xlsx files, for
 * store-weeks that have none — i.e. everything before James's self-serve
 * uploads began at 2026 week 16.
 *
 * Why: the Secondary Products year-over-year column needs 2025 per-product
 * data (James, July 31 2026: "Please add in the 2025 product data for the
 * secondaries"). The historical importer only ever wrote weekly_metrics.
 * All product lines are inserted, not just secondaries — same cost, and it
 * gives every later feature (dominant-SKU sizing, box recomputes) real
 * line-item history.
 *
 * MUST run AFTER merge-duplicate-stores: lines attach to stores by normalized
 * code, and the merge is what guarantees one canonical row per code.
 *
 * Rules:
 *   - a store-week that already has ANY weekly_orders rows is skipped whole
 *     (protects the upload era; makes the script re-runnable)
 *   - upload_id stays null (these came from no upload)
 *   - unknown product codes insert with product_id null but keep the raw
 *     code/description for audit — the products join simply won't surface them
 *   - weeks <= 0 skipped, same as the importer (the week-0 question is with
 *     James; including them here would create orders with no metrics row)
 *
 * Sheet-to-year attribution copied from import-historical.ts (whose main()
 * runs on import, so its parsers can't be shared): the 2025 file's first 6
 * data sheets are Nov-Dec 2024, the rest are 2025; the 2026 file is 2026.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-weekly-orders.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-weekly-orders.ts --apply
 */

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as path from "path";
import { normalizeStoreCode, shouldIgnoreStore } from "../src/lib/calculations/stores";
import type { RawOrderRow } from "../src/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing env (load with --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const APPLY = process.argv.includes("--apply");
const ROOT = path.join(__dirname, "..", "..");

// ── Parsing (mirrors import-historical.ts) ───────────────────

function shouldSkipSheet(name: string): boolean {
  const lower = name.toLowerCase().trim();
  for (const s of ["product sheet", "exported list", "store list", "summary", "template"]) {
    if (lower === s || lower.includes("pivot") || lower.includes("values")) return true;
  }
  const dsmNames = ["vito", "paul", "brijesh", "michel", "jim", "raj", "vick"];
  if (dsmNames.includes(lower)) return true;
  return false;
}

function parseWeeklySheet(sheet: XLSX.WorkSheet): RawOrderRow[] {
  let jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  if (jsonData.length === 0) return [];

  const firstRow = jsonData[0];
  const firstVal = String(firstRow[Object.keys(firstRow)[0]] ?? "");
  if (firstVal.startsWith("Products Sold") || firstVal === "CompanyName") {
    jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true, range: 1 });
  }
  if (jsonData.length === 0) return [];

  const cols = Object.keys(jsonData[0]);
  const findCol = (target: string) => cols.find((c) => c.toLowerCase().trim() === target.toLowerCase()) ?? null;
  const companyCol = findCol("CompanyName");
  const weekCol = findCol("WeekNumber");
  const productCol = findCol("productcode");
  const descCol = findCol("description");
  const qtyCol = findCol("TotalQty");
  if (!companyCol || !weekCol || !productCol || !qtyCol) return [];

  const rows: RawOrderRow[] = [];
  for (const row of jsonData) {
    const companyName = String(row[companyCol] ?? "").trim();
    const weekNumber = Number(row[weekCol]) || 0;
    const productCode = String(row[productCol] ?? "").trim();
    const description = String(row[descCol!] ?? "").trim();
    const qty = Number(row[qtyCol]) || 0;
    if (!companyName || !productCode || qty <= 0) continue;
    const upper = companyName.toUpperCase();
    if (upper.includes("SAPUTO") || upper.includes("SUNDRY")) continue;
    rows.push({ company_name: companyName, week_number: weekNumber, product_code: productCode, description, total_qty: qty });
  }
  return rows;
}

function parseRawDataFile(filePath: string, limitSheets?: { start?: number; end?: number }): RawOrderRow[] {
  const wb = XLSX.readFile(filePath);
  const dataSheetNames = wb.SheetNames.filter((n) => !shouldSkipSheet(n));
  const start = limitSheets?.start ?? 0;
  const end = limitSheets?.end ?? dataSheetNames.length;
  const out: RawOrderRow[] = [];
  for (const name of dataSheetNames.slice(start, end)) {
    const sheet = wb.Sheets[name];
    if (sheet) out.push(...parseWeeklySheet(sheet));
  }
  return out;
}

async function paged<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(JSON.stringify(error));
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  console.log(`\n=== Backfill weekly_orders from the raw xlsx ===`);
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN (no writes)");

  const file2025 = path.join(ROOT, "2025 raw data for Gloo.xlsx");
  const file2026 = path.join(ROOT, "2026 raw data for Gloo.xlsx");
  const batches: { year: number; rows: RawOrderRow[] }[] = [
    { year: 2024, rows: parseRawDataFile(file2025, { start: 0, end: 6 }) },
    { year: 2025, rows: parseRawDataFile(file2025, { start: 6 }) },
    { year: 2026, rows: parseRawDataFile(file2026) },
  ];
  for (const b of batches) console.log(`  parsed ${b.rows.length} rows for ${b.year}`);

  const stores = await paged<{ id: string; code: string }>((f, t) =>
    supabase.from("stores").select("id, code").range(f, t)
  );
  const storeByKey = new Map(stores.map((s) => [normalizeStoreCode(s.code), s.id]));

  const products = await paged<{ id: string; code: string }>((f, t) =>
    supabase.from("products").select("id, code").range(f, t)
  );
  const productByCode = new Map(products.map((p) => [String(p.code), p.id]));

  // Store-weeks that already have line items — skipped whole.
  const existing = await paged<{ store_id: string; year: number; week_number: number }>((f, t) =>
    supabase.from("weekly_orders").select("store_id, year, week_number").range(f, t)
  );
  const existingKeys = new Set(existing.map((e) => `${e.store_id}::${e.year}::${e.week_number}`));
  console.log(`  ${existingKeys.size ? new Set(existing.map((e) => `${e.store_id}::${e.year}::${e.week_number}`)).size : 0} store-weeks already have line items (protected)`);

  type Insert = {
    store_id: string; product_id: string | null; week_number: number; year: number;
    quantity: number; raw_company_name: string; raw_product_code: string; raw_description: string;
    upload_id: null;
  };
  const inserts: Insert[] = [];
  let skippedExisting = 0, skippedIgnored = 0, skippedWeek0 = 0, skippedUnknownStore = 0, unknownProducts = 0;

  for (const { year, rows } of batches) {
    for (const r of rows) {
      if (r.week_number <= 0) { skippedWeek0++; continue; }
      const key = normalizeStoreCode(r.company_name);
      if (shouldIgnoreStore(key)) { skippedIgnored++; continue; }
      const storeId = storeByKey.get(key);
      if (!storeId) { skippedUnknownStore++; continue; }
      if (existingKeys.has(`${storeId}::${year}::${r.week_number}`)) { skippedExisting++; continue; }

      const productId = productByCode.get(String(r.product_code)) ?? null;
      if (!productId) unknownProducts++;
      inserts.push({
        store_id: storeId,
        product_id: productId,
        week_number: r.week_number,
        year,
        quantity: r.total_qty,
        raw_company_name: r.company_name,
        raw_product_code: String(r.product_code),
        raw_description: r.description,
        upload_id: null,
      });
    }
  }

  const byYear = new Map<number, number>();
  for (const i of inserts) byYear.set(i.year, (byYear.get(i.year) ?? 0) + 1);
  console.log(`\nTo insert: ${inserts.length} rows (${[...byYear.entries()].map(([y, n]) => `${y}: ${n}`).join(" · ")})`);
  console.log(`Skipped: ${skippedExisting} lines in already-covered store-weeks · ${skippedIgnored} ignored stores · ${skippedWeek0} week<=0 · ${skippedUnknownStore} unknown stores`);
  console.log(`${unknownProducts} lines have product codes not in the products table (inserted with product_id null, raw code kept)`);

  if (!APPLY) {
    console.log(`\nDry run only — re-run with --apply.\n`);
    return;
  }

  console.log(`\nInserting in batches of 500...`);
  let written = 0;
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500);
    const { error } = await supabase.from("weekly_orders").insert(chunk);
    if (error) throw new Error(`batch at ${i} failed: ${error.message}`);
    written += chunk.length;
    if (written % 25000 < 500) console.log(`  ${written}/${inserts.length}`);
  }
  console.log(`Done. Inserted ${written} rows.\n`);
}

main().catch((e) => { console.error("Backfill failed:", e.message); process.exit(1); });

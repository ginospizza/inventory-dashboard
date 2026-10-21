/**
 * Load one whole year from a single "Products Sold" export — the same
 * CompanyName / WeekNumber / productcode / description / TotalQty table James
 * uploads weekly, but with every week of the year in it.
 *
 * Written for the 2024 file (James, Oct 2026: "We wanted to add in data from
 * 2024 into the app... it just lists the weeks as normal (0,1,2,3, etc), so I'm
 * worried about uploading it and merging 2024 data into 2026"). The upload
 * route can't take it: a whole year is far past a request's time budget, and
 * the year comes from --year here rather than from the upload form.
 *
 * Why not import-historical.ts: that script re-runs store and product setup
 * from the old App Data / Store list workbooks, which would overwrite what
 * admins have since edited (product weights, classifications, categories).
 * This one reads the LIVE catalog and store list, exactly like an upload.
 *
 * What it writes, for --year only:
 *   weekly_metrics  upserted per store-week (computed by the engine, statuses
 *                   from recomputeRollingStatuses over the year's series —
 *                   per-year, like the upload route and rescore, so other
 *                   years' statuses are untouched). Store-weeks of that year
 *                   already in the table but absent from the file are KEPT:
 *                   the 2024 export omits some stores (GINOS162, TTD PARIS...)
 *                   whose Nov-Dec 2024 weeks came from the 2025 workbook.
 *   weekly_orders   for each store-week the file covers, non-upload line items
 *                   are replaced by the file's (they feed the Secondary
 *                   Products tab's year-over-year). Upload-era lines
 *                   (upload_id not null) and uncovered store-weeks are never
 *                   touched.
 *
 * Skipped, same as every other loader: week 0 (see lib/weeks.ts), ignored
 * stores, SAPUTO/SUNDRY lines, zero/negative quantities. Stores not in the
 * stores table are reported and skipped — never auto-created, so a store that
 * closed before 2025 can't appear as a new active store.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/import-year-file.ts --file=<xlsx> --year=2024            # dry run
 *   npx tsx --env-file=.env.local scripts/import-year-file.ts --file=<xlsx> --year=2024  --apply
 */

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  computeWeeklyMetrics,
  detectBrand,
  recomputeRollingStatuses,
  resolveStoreType,
} from "../src/lib/calculations/engine";
import { ensureEngineConfig } from "../src/lib/calculations/config-loader";
import { normalizeStoreCode, shouldIgnoreStore } from "../src/lib/calculations/stores";
import type { Product, RawOrderRow, Brand, StoreType } from "../src/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing env (load with --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const FILE = arg("file");
const YEAR = Number(arg("year"));
const APPLY = process.argv.includes("--apply");
if (!FILE || !Number.isInteger(YEAR) || YEAR < 2000) {
  console.error("Usage: --file=<xlsx> --year=<YYYY> [--apply]");
  process.exit(1);
}

// ── Parsing (same rules as import-historical / backfill-weekly-orders) ──

function parseSheet(sheet: XLSX.WorkSheet): RawOrderRow[] {
  let json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  if (json.length === 0) return [];
  const first = String(json[0][Object.keys(json[0])[0]] ?? "");
  // A "Products Sold" title row sits above the real header in most exports.
  if (first.startsWith("Products Sold") || first === "CompanyName") {
    json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true, range: 1 });
  }
  if (json.length === 0) return [];
  const cols = Object.keys(json[0]);
  const col = (t: string) => cols.find((c) => c.toLowerCase().trim() === t.toLowerCase()) ?? null;
  const [companyCol, weekCol, productCol, descCol, qtyCol] =
    ["CompanyName", "WeekNumber", "productcode", "description", "TotalQty"].map(col);
  if (!companyCol || !weekCol || !productCol || !qtyCol) return [];

  const rows: RawOrderRow[] = [];
  for (const r of json) {
    const company_name = String(r[companyCol] ?? "").trim();
    const product_code = String(r[productCol] ?? "").trim();
    const total_qty = Number(r[qtyCol]) || 0;
    if (!company_name || !product_code || total_qty <= 0) continue;
    const upper = company_name.toUpperCase();
    if (upper.includes("SAPUTO") || upper.includes("SUNDRY")) continue;
    rows.push({
      company_name,
      week_number: Number(r[weekCol]) || 0,
      product_code,
      description: String(r[descCol!] ?? "").trim(),
      total_qty,
    });
  }
  return rows;
}

// Callers must .order() — unordered range paging can skip or repeat rows.
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

// ── Main ─────────────────────────────────────────────────────

async function main() {
  await ensureEngineConfig();
  console.log(`\n=== Import ${YEAR} from ${FILE} ===`);
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN (no writes)");

  const wb = XLSX.readFile(FILE!);
  const rows = wb.SheetNames.flatMap((n) => parseSheet(wb.Sheets[n]));
  console.log(`Parsed ${rows.length} lines from ${wb.SheetNames.length} sheet(s)`);

  const stores = await paged<{ id: string; code: string; brand: string | null }>((f, t) =>
    supabase.from("stores").select("id, code, brand").order("id").range(f, t)
  );
  const storeByCode = new Map<string, { id: string; brand: Brand; storeType: StoreType }>();
  for (const s of stores) {
    const brand = (s.brand as Brand) ?? detectBrand(s.code);
    storeByCode.set(normalizeStoreCode(s.code), { id: s.id, brand, storeType: resolveStoreType(s.code, brand) });
  }

  const products = await paged<Product>((f, t) =>
    supabase.from("products").select("id, code, description, type, classification, pack_size, weight, weight_unit").order("id").range(f, t)
  );
  const productMap = new Map(products.map((p) => [String(p.code), p]));

  // Group lines by store-week.
  const groups = new Map<string, { store: { id: string; brand: Brand; storeType: StoreType }; week: number; rows: RawOrderRow[] }>();
  const unknownStores = new Map<string, number>();
  let week0 = 0, ignored = 0;
  const unknownProducts = new Map<string, string>();
  for (const r of rows) {
    if (r.week_number <= 0) { week0++; continue; }
    const code = normalizeStoreCode(r.company_name);
    if (!code || shouldIgnoreStore(code)) { ignored++; continue; }
    const store = storeByCode.get(code);
    if (!store) { unknownStores.set(code, (unknownStores.get(code) ?? 0) + 1); continue; }
    if (!productMap.has(r.product_code)) unknownProducts.set(r.product_code, r.description);
    const key = `${store.id}::${r.week_number}`;
    const g = groups.get(key) ?? { store, week: r.week_number, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }

  const weeks = [...new Set([...groups.values()].map((g) => g.week))].sort((a, b) => a - b);
  console.log(`\n${groups.size} store-weeks across ${weeks.length} weeks (${weeks[0]}-${weeks[weeks.length - 1]}), ${new Set([...groups.values()].map((g) => g.store.id)).size} stores`);
  console.log(`Skipped: ${week0} week-0 lines · ${ignored} ignored-store lines · ${[...unknownStores.values()].reduce((a, b) => a + b, 0)} lines from ${unknownStores.size} stores not in the app`);
  if (unknownStores.size) console.log(`  Stores not in the app: ${[...unknownStores.keys()].sort().join(", ")}`);
  if (unknownProducts.size) {
    console.log(`  ${unknownProducts.size} product codes not in the catalog (ignored by the engine, like an upload):`);
    for (const [c, d] of [...unknownProducts].slice(0, 15)) console.log(`    ${c}  ${d}`);
  }

  // Compute metrics, then rolling statuses per store over the year's series.
  const byStore = new Map<string, { week: number; storeType: StoreType; m: ReturnType<typeof computeWeeklyMetrics> }[]>();
  for (const g of groups.values()) {
    const m = computeWeeklyMetrics(g.rows, productMap, YEAR, g.store.storeType, g.store.brand);
    const list = byStore.get(g.store.id) ?? [];
    list.push({ week: g.week, storeType: g.store.storeType, m });
    byStore.set(g.store.id, list);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metricRows: Record<string, any>[] = [];
  for (const [storeId, list] of byStore) {
    list.sort((a, b) => a.week - b.week);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rolled = recomputeRollingStatuses(list.map(({ m }: { m: any }) => ({
      store_type: m.store_type,
      cheese_ordered_oz: m.cheese_ordered_oz,
      sauce_ordered_floz: m.sauce_ordered_floz,
      flour_ordered_kg: m.flour_ordered_kg,
      dough_ordered_kg: m.dough_ordered_kg ?? 0,
      cheese_estimated_oz: m.cheese_estimated_oz,
      sauce_estimated_floz: m.sauce_estimated_floz,
      flour_estimated_kg: m.flour_estimated_kg,
      dough_estimated_kg: m.dough_estimated_kg ?? 0,
    })));
    list.forEach(({ week, m: raw }, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = raw as any;
      const s = rolled[i];
      metricRows.push({
        store_id: storeId, week_number: week, year: YEAR, store_type: m.store_type,
        cheese_ordered_oz: m.cheese_ordered_oz, sauce_ordered_floz: m.sauce_ordered_floz,
        flour_ordered_kg: m.flour_ordered_kg, dough_ordered_kg: m.dough_ordered_kg ?? 0,
        boxes_small: m.boxes_small, boxes_medium: m.boxes_medium, boxes_large: m.boxes_large,
        boxes_xl: m.boxes_xl, boxes_party: m.boxes_party, boxes_party_21x15: m.boxes_party_21x15 ?? 0,
        boxes_clamshell: m.boxes_clamshell ?? 0, boxes_plates: m.boxes_plates ?? 0, boxes_total: m.boxes_total,
        cheese_estimated_oz: m.cheese_estimated_oz, sauce_estimated_floz: m.sauce_estimated_floz,
        flour_estimated_kg: m.flour_estimated_kg, dough_estimated_kg: m.dough_estimated_kg ?? 0,
        cheese_diff: m.cheese_diff, sauce_diff: m.sauce_diff, flour_diff: m.flour_diff, dough_diff: m.dough_diff ?? 0,
        sauce_cheese_ratio: m.sauce_cheese_ratio, flour_cheese_ratio: m.flour_cheese_ratio,
        dough_cheese_ratio: m.dough_cheese_ratio ?? 0, total_boxes_ordered: m.total_boxes_ordered,
        estimated_pizza_sales: m.estimated_pizza_sales, weekly_pizza_sales: m.weekly_pizza_sales,
        cheese_status: s.cheese_status, sauce_status: s.sauce_status, flour_status: s.flour_status,
        dough_status: s.dough_status, sauce_cheese_status: s.sauce_cheese_status,
        flour_cheese_status: s.flour_cheese_status, dough_cheese_status: s.dough_cheese_status,
        overall_status: s.overall_status,
      });
    });
  }

  const statusCounts: Record<string, number> = {};
  for (const r of metricRows) statusCounts[r.overall_status] = (statusCounts[r.overall_status] ?? 0) + 1;
  console.log(`\nweekly_metrics to upsert: ${metricRows.length} · statuses ${JSON.stringify(statusCounts)}`);

  // What's already there for the year.
  const existing = await paged<{ id: string; store_id: string; week_number: number }>((f, t) =>
    supabase.from("weekly_metrics").select("id, store_id, week_number").eq("year", YEAR).order("id").range(f, t)
  );
  const newKeys = new Set(metricRows.map((r) => `${r.store_id}::${r.week_number}`));
  const stale = existing.filter((e) => !newKeys.has(`${e.store_id}::${e.week_number}`));
  console.log(`Existing ${YEAR} store-weeks: ${existing.length} (${existing.length - stale.length} will be overwritten, ${stale.length} not in the file → kept)`);
  if (stale.length) {
    const codeById = new Map(stores.map((s) => [s.id, s.code]));
    console.log(`  kept, by store: ${[...new Set(stale.map((s) => codeById.get(s.store_id)))].sort().join(", ")}`);
  }

  const orderLines = rows.filter((r) => {
    if (r.week_number <= 0) return false;
    const code = normalizeStoreCode(r.company_name);
    return code && !shouldIgnoreStore(code) && storeByCode.has(code);
  });
  // Covered weeks per store: the only line items this run replaces.
  const coveredWeeks = new Map<string, number[]>();
  for (const g of groups.values()) {
    const list = coveredWeeks.get(g.store.id) ?? [];
    list.push(g.week);
    coveredWeeks.set(g.store.id, list);
  }
  const existingOrders = await paged<{ store_id: string; week_number: number }>((f, t) =>
    supabase.from("weekly_orders").select("id, store_id, week_number").eq("year", YEAR).is("upload_id", null).order("id").range(f, t)
  );
  const replaced = existingOrders.filter((o) => newKeys.has(`${o.store_id}::${o.week_number}`)).length;
  console.log(`weekly_orders: ${existingOrders.length} existing non-upload ${YEAR} lines (${replaced} in covered store-weeks → replaced, ${existingOrders.length - replaced} kept); inserting ${orderLines.length} lines from the file`);

  if (!APPLY) {
    console.log(`\nDry run only — re-run with --apply.\n`);
    return;
  }

  console.log(`\nUpserting weekly_metrics...`);
  for (let i = 0; i < metricRows.length; i += 200) {
    const { error } = await supabase.from("weekly_metrics")
      .upsert(metricRows.slice(i, i + 200), { onConflict: "store_id,year,week_number" });
    if (error) throw new Error(`metrics batch at ${i}: ${error.message}`);
  }
  console.log(`  ${metricRows.length} written`);

  {
    for (const [storeId, wks] of coveredWeeks) {
      const { error } = await supabase.from("weekly_orders").delete()
        .eq("store_id", storeId).eq("year", YEAR).is("upload_id", null).in("week_number", wks);
      if (error) throw new Error(`orders delete: ${error.message}`);
    }
    console.log(`Replaced line items in ${coveredWeeks.size} stores' covered weeks`);
    console.log(`Inserting ${orderLines.length} weekly_orders lines...`);
    for (let i = 0; i < orderLines.length; i += 500) {
      const chunk = orderLines.slice(i, i + 500).map((r) => ({
        store_id: storeByCode.get(normalizeStoreCode(r.company_name))!.id,
        product_id: productMap.get(r.product_code)?.id ?? null,
        week_number: r.week_number,
        year: YEAR,
        quantity: r.total_qty,
        raw_company_name: r.company_name,
        raw_product_code: r.product_code,
        raw_description: r.description,
        upload_id: null,
      }));
      const { error } = await supabase.from("weekly_orders").insert(chunk);
      if (error) throw new Error(`orders batch at ${i}: ${error.message}`);
      if ((i / 500) % 50 === 0) console.log(`  ${i + chunk.length}/${orderLines.length}`);
    }
  }
  console.log(`\nDone.\n`);
}

main().catch((e) => { console.error("Import failed:", e.message); process.exit(1); });

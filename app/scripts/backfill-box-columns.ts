/**
 * Backfill boxes_party_21x15 / boxes_clamshell / boxes_plates for store-weeks
 * that have weekly_orders line items (2026 wk16+ — James's app uploads).
 *
 * Migration 004 added these columns; the engine always computed them but the
 * upload route stripped them before upsert, so every existing row holds 0.
 * Historical weeks (2025 + 2026 wk1-13) are covered by re-running
 * import-historical against the raw xlsx. This script covers the upload era,
 * where the raw file doesn't reach: it rebuilds each store-week's RawOrderRow[]
 * from weekly_orders and calls the SAME aggregation the upload path uses
 * (aggregateStoreWeek + platesCountForBrand), so the numbers cannot drift from
 * what a fresh upload would produce.
 *
 * 2026 weeks 14-15 have neither raw-file nor line-item coverage and stay 0 —
 * flagged to James.
 *
 * Writes ONLY the three box columns. Statuses, diffs, estimates untouched.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-box-columns.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-box-columns.ts --apply
 */

import { createClient } from "@supabase/supabase-js";
import { aggregateStoreWeek, platesCountForBrand } from "../src/lib/calculations/engine";
import { BOXES_PER_CASE } from "../src/lib/calculations/constants";
import type { Product, RawOrderRow, Brand } from "../src/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing env (load with --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const APPLY = process.argv.includes("--apply");

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
  console.log(`\n=== Backfill box columns from weekly_orders ===`);
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN (no writes)");

  // Product lookup keyed by code — same shape the upload route builds.
  const products = await paged<Product>((f, t) =>
    supabase.from("products").select("*").range(f, t)
  );
  const productLookup = new Map<string, Product>(products.map((p) => [String(p.code), p]));

  const { data: stores } = await supabase.from("stores").select("id, code, brand");
  const storeById = new Map((stores ?? []).map((s) => [s.id, s]));

  type OrderRow = {
    store_id: string; year: number; week_number: number; quantity: number;
    raw_product_code: string | null; raw_description: string | null;
    products: { code: string; description: string } | null;
  };
  const orders = await paged<OrderRow>((f, t) =>
    supabase
      .from("weekly_orders")
      .select("store_id, year, week_number, quantity, raw_product_code, raw_description, products(code, description)")
      .order("store_id").order("year").order("week_number")
      .range(f, t)
  );
  console.log(`Loaded ${orders.length} order lines.`);

  // Group into store-weeks and rebuild the RawOrderRow shape the engine eats.
  const byStoreWeek = new Map<string, RawOrderRow[]>();
  for (const o of orders) {
    const code = o.products?.code ?? o.raw_product_code;
    if (!code) continue;
    const key = `${o.store_id}::${o.year}::${o.week_number}`;
    const arr = byStoreWeek.get(key) ?? [];
    arr.push({
      company_name: storeById.get(o.store_id)?.code ?? "",
      week_number: o.week_number,
      product_code: String(code),
      description: o.products?.description ?? o.raw_description ?? "",
      total_qty: o.quantity || 0,
    });
    byStoreWeek.set(key, arr);
  }
  console.log(`${byStoreWeek.size} store-weeks with line items.`);

  const updates: { store_id: string; year: number; week: number; p21: number; clam: number; plates: number }[] = [];
  let nonZero = 0;

  for (const [key, rows] of byStoreWeek) {
    const [storeId, yearStr, weekStr] = key.split("::");
    const store = storeById.get(storeId);
    if (!store) continue;
    const year = Number(yearStr);
    const week = Number(weekStr);

    const agg = aggregateStoreWeek(rows, productLookup, year);
    const inclPlates = platesCountForBrand((store.brand as Brand) ?? "OTHER");

    // Mirrors computeWeeklyMetrics' persisted output exactly:
    //   party 21x15 in individual boxes; clamshell/plates already pieces;
    //   plates zeroed for brands where they don't count toward usage.
    const p21 = agg.boxes_party_21x15 * BOXES_PER_CASE;
    const clam = agg.boxes_clamshell;
    const plates = inclPlates ? agg.boxes_plates : 0;

    if (p21 > 0 || clam > 0 || plates > 0) nonZero++;
    updates.push({ store_id: storeId, year, week, p21, clam, plates });
  }

  console.log(`\n${updates.length} store-weeks recomputed; ${nonZero} have non-zero values.`);
  const wks = [...new Set(updates.map((u) => `${u.year} wk${u.week}`))].sort();
  console.log(`Weeks covered: ${wks[0]} … ${wks[wks.length - 1]} (${wks.length} weeks)`);

  if (!APPLY) {
    const sample = updates.filter((u) => u.clam > 0 || u.plates > 0).slice(0, 5);
    for (const s of sample) {
      console.log(`  sample: ${storeById.get(s.store_id)?.code} ${s.year} wk${s.week}  21x15=${s.p21} clamshell=${s.clam} plates=${s.plates}`);
    }
    console.log(`\nDry run only — re-run with --apply.\n`);
    return;
  }

  console.log(`\nApplying...`);
  let written = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("weekly_metrics")
      .update({ boxes_party_21x15: u.p21, boxes_clamshell: u.clam, boxes_plates: u.plates })
      .eq("store_id", u.store_id).eq("year", u.year).eq("week_number", u.week);
    if (error) console.error(`  failed ${u.store_id} ${u.year} wk${u.week}: ${error.message}`);
    else written++;
  }
  console.log(`Done. Updated ${written}/${updates.length} store-weeks.\n`);
}

main().catch((e) => { console.error("Backfill failed:", e.message); process.exit(1); });

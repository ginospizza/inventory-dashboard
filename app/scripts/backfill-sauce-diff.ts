/**
 * Recompute stored sauce_diff using each store's DOMINANT sauce SKU case size.
 *
 * Why not just re-run import-historical: the 2026 raw xlsx only covers weeks
 * 1-13. Weeks 14 onward are James's own uploads through the app and exist only
 * in the database, and import-historical upserts rather than deletes, so a plain
 * re-import would fix the old weeks and leave the RECENT ones — the ones anyone
 * is actually looking at — still wrong.
 *
 * Case size per store-week, best source first:
 *   1. weekly_orders for that exact store-week (exists from 2026 wk16) — exact.
 *   2. the store's dominant sauce SKU across all weeks we do have — a good
 *      estimate, since a store buys one sauce and rarely switches.
 *   3. SAUCE_CASE_FLOZ, the old 6x2.84L constant, if a store has no line items.
 *
 * Only sauce_diff is written. Ordered/estimated/ratios/statuses are untouched:
 * sauce_status is graded on FL OZ, so the case size never affects a grade.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-sauce-diff.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-sauce-diff.ts --apply
 */

import { createClient } from "@supabase/supabase-js";
import { SAUCE_CASE_FLOZ } from "../src/lib/calculations/constants";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (load with --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const APPLY = process.argv.includes("--apply");

type Line = {
  store_id: string; year: number; week_number: number; quantity: number;
  products: { code: string; weight: number; type: string } | null;
};

async function pagedSelect<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(JSON.stringify(error));
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log(`\n=== Backfill sauce_diff from the dominant sauce SKU ===`);
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN (no writes)");

  // 1. Every sauce order line we have.
  const lines = await pagedSelect<Line>((f, t) =>
    supabase
      .from("weekly_orders")
      .select("store_id, year, week_number, quantity, products!inner(code, weight, type)")
      .eq("products.type", "Pizza Sauce")
      .order("store_id").order("year").order("week_number")
      .range(f, t)
  );
  console.log(`Loaded ${lines.length} sauce order lines.`);

  // Exact case size per store-week, and the store's overall dominant SKU.
  const perWeek = new Map<string, Map<string, { qty: number; floz: number }>>();
  const perStore = new Map<string, Map<string, { qty: number; floz: number }>>();
  for (const l of lines) {
    if (!l.products) continue;
    const wk = `${l.store_id}::${l.year}::${l.week_number}`;
    for (const [map, key] of [[perWeek, wk], [perStore, l.store_id]] as const) {
      const bucket = map.get(key) ?? new Map<string, { qty: number; floz: number }>();
      const e = bucket.get(l.products.code) ?? { qty: 0, floz: l.products.weight };
      e.qty += l.quantity || 0;
      bucket.set(l.products.code, e);
      map.set(key, bucket);
    }
  }
  const dominant = (b?: Map<string, { qty: number; floz: number }>) => {
    if (!b) return null;
    let best = 0, floz: number | null = null;
    for (const [, v] of b) if (v.qty > best) { best = v.qty; floz = v.floz; }
    return floz;
  };

  const storeCase = new Map<string, number>();
  for (const [sid, bucket] of perStore) {
    const f = dominant(bucket);
    if (f) storeCase.set(sid, f);
  }
  const sizes = new Map<number, number>();
  for (const [, f] of storeCase) sizes.set(f, (sizes.get(f) ?? 0) + 1);
  console.log(`Dominant sauce case size per store:`);
  for (const [f, n] of [...sizes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f.toFixed(2)} fl oz -> ${n} stores`);
  }
  console.log(`  (no sauce line items -> ${"?"} stores fall back to ${SAUCE_CASE_FLOZ.toFixed(2)})`);

  // 2. Every metric row.
  const metrics = await pagedSelect<{
    id: string; store_id: string; year: number; week_number: number;
    sauce_ordered_floz: number; sauce_estimated_floz: number; sauce_diff: number;
  }>((f, t) =>
    supabase
      .from("weekly_metrics")
      .select("id, store_id, year, week_number, sauce_ordered_floz, sauce_estimated_floz, sauce_diff")
      .order("store_id").order("year").order("week_number")
      .range(f, t)
  );
  console.log(`\nLoaded ${metrics.length} weekly_metrics rows.`);

  let exact = 0, byStore = 0, fallback = 0, changed = 0, maxDelta = 0;
  const updates: { id: string; sauce_diff: number }[] = [];

  for (const m of metrics) {
    const wkKey = `${m.store_id}::${m.year}::${m.week_number}`;
    let caseFloz = dominant(perWeek.get(wkKey));
    if (caseFloz) exact++;
    else {
      caseFloz = storeCase.get(m.store_id) ?? null;
      if (caseFloz) byStore++;
      else { caseFloz = SAUCE_CASE_FLOZ; fallback++; }
    }

    const next = caseFloz === 0 ? 0 : ((m.sauce_ordered_floz || 0) - (m.sauce_estimated_floz || 0)) / caseFloz;
    const rounded = Math.round(next * 100) / 100;
    const delta = Math.abs(rounded - (m.sauce_diff ?? 0));
    if (delta > 0.005) {
      changed++;
      maxDelta = Math.max(maxDelta, delta);
      updates.push({ id: m.id, sauce_diff: rounded });
    }
  }

  console.log(`\nCase size source:  exact week ${exact} · store dominant ${byStore} · constant fallback ${fallback}`);
  console.log(`sauce_diff changes: ${changed} of ${metrics.length} rows (largest change ${maxDelta.toFixed(2)} cases)`);

  if (!APPLY) {
    console.log(`\nDry run only — no rows written. Re-run with --apply.\n`);
    return;
  }

  console.log(`\nApplying ${updates.length} updates...`);
  let written = 0;
  for (const u of updates) {
    const { error } = await supabase.from("weekly_metrics").update({ sauce_diff: u.sauce_diff }).eq("id", u.id);
    if (error) console.error(`  failed ${u.id}: ${error.message}`);
    else written++;
  }
  console.log(`Done. Updated ${written}/${updates.length} rows.\n`);
}

main().catch((e) => {
  console.error("Backfill failed:", e.message);
  process.exit(1);
});

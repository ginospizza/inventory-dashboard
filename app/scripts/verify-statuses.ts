/**
 * Audit: does every stored status match what the engine would compute today?
 *
 * Read-only. Exits 1 if anything is out of sync, so it can gate a deploy or run
 * as a post-upload sanity check.
 *
 * Why this exists: on 2026-07-28 James noticed a Compare row whose explanation
 * said every metric was in band on the 6-week average sitting next to a Severe
 * pill. The cause was the upload route reading weekly_metrics WITHOUT pagination
 * (Supabase caps a response at 1000 rows), so most stores never had their rolling
 * status written and kept the week-in-isolation value. 85 of 148 stores were
 * wrong on week 29 and nobody could tell, because a wrong status looks exactly
 * like a right one. This turns that class of drift into one command.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/verify-statuses.ts
 *   npx tsx --env-file=.env.local scripts/verify-statuses.ts --year=2026
 */

import { createClient } from "@supabase/supabase-js";
import { recomputeRollingStatuses, type RollingStatusRow } from "../src/lib/calculations/engine";
import { ensureEngineConfig } from "../src/lib/calculations/config-loader";
import { STATUS_LABEL } from "../src/lib/types";
import type { ComplianceStatus, StoreType } from "../src/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (load with --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const YEAR_ARG = process.argv.find((a) => a.startsWith("--year="));
const YEAR = YEAR_ARG ? Number(YEAR_ARG.split("=")[1]) : undefined;

const STATUS_FIELDS = [
  "cheese_status", "sauce_status", "flour_status", "dough_status",
  "sauce_cheese_status", "flour_cheese_status", "dough_cheese_status", "overall_status",
] as const;

const COLS =
  "id, store_id, year, week_number, store_type," +
  "cheese_ordered_oz, sauce_ordered_floz, flour_ordered_kg, dough_ordered_kg," +
  "cheese_estimated_oz, sauce_estimated_floz, flour_estimated_kg, dough_estimated_kg," +
  STATUS_FIELDS.join(", ");

type Row = Record<string, unknown> & {
  store_id: string; year: number; week_number: number; store_type: StoreType;
};

const toRolling = (r: Row): RollingStatusRow => ({
  cheese_ordered_oz: (r.cheese_ordered_oz as number) || 0,
  sauce_ordered_floz: (r.sauce_ordered_floz as number) || 0,
  flour_ordered_kg: (r.flour_ordered_kg as number) || 0,
  dough_ordered_kg: (r.dough_ordered_kg as number) || 0,
  cheese_estimated_oz: (r.cheese_estimated_oz as number) || 0,
  sauce_estimated_floz: (r.sauce_estimated_floz as number) || 0,
  flour_estimated_kg: (r.flour_estimated_kg as number) || 0,
  dough_estimated_kg: (r.dough_estimated_kg as number) || 0,
  store_type: r.store_type,
});

async function main() {
  await ensureEngineConfig();
  console.log(`\n=== Verify stored statuses against the engine${YEAR ? ` (${YEAR})` : ""} ===`);

  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from("weekly_metrics")
      .select(COLS)
      .order("store_id", { ascending: true })
      .order("year", { ascending: true })
      .order("week_number", { ascending: true })
      .range(from, from + 999);
    if (YEAR) q = q.eq("year", YEAR);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }

  const { data: stores } = await supabase.from("stores").select("id, code");
  const codeById = new Map<string, string>((stores ?? []).map((s) => [s.id, s.code]));

  const byStore = new Map<string, Row[]>();
  for (const r of all) {
    const arr = byStore.get(r.store_id) ?? [];
    arr.push(r);
    byStore.set(r.store_id, arr);
  }
  console.log(`Loaded ${all.length} rows across ${byStore.size} stores.\n`);

  const mismatches: { code: string; year: number; week: number; field: string; stored: string; expected: string }[] = [];

  for (const [storeId, rows] of byStore) {
    // Same ordering the engine's window assumes: chronological, gap-tolerant.
    rows.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.week_number - b.week_number));
    const expected = recomputeRollingStatuses(rows.map(toRolling));
    rows.forEach((r, i) => {
      for (const f of STATUS_FIELDS) {
        const stored = String(r[f]);
        const want = String(expected[i][f]);
        if (stored !== want) {
          mismatches.push({
            code: codeById.get(storeId) ?? storeId,
            year: r.year, week: r.week_number, field: f, stored, expected: want,
          });
        }
      }
    });
  }

  if (mismatches.length === 0) {
    console.log("✓ Every stored status matches the engine. Nothing to do.\n");
    return;
  }

  // Group by week — drift is almost always "the most recently uploaded week",
  // so this is the shape that identifies the cause fastest.
  const byWeek = new Map<string, number>();
  for (const m of mismatches) {
    const k = `${m.year} wk${String(m.week).padStart(2, "0")}`;
    byWeek.set(k, (byWeek.get(k) ?? 0) + 1);
  }

  console.log(`✗ ${mismatches.length} stored status field(s) disagree with the engine.\n`);
  console.log("By week:");
  for (const [k, n] of [...byWeek.entries()].sort()) console.log(`  ${k}: ${n}`);

  const overall = mismatches.filter((m) => m.field === "overall_status");
  if (overall.length) {
    console.log(`\noverall_status disagreements (${overall.length}) — these are what users see:`);
    for (const m of overall.slice(0, 20)) {
      const lbl = (s: string) => STATUS_LABEL[s as ComplianceStatus] ?? s;
      console.log(`  ${m.code.padEnd(18)} ${m.year} wk${m.week}  stored=${lbl(m.stored).padEnd(11)} expected=${lbl(m.expected)}`);
    }
    if (overall.length > 20) console.log(`  ... and ${overall.length - 20} more`);
  }

  console.log(`\nFix with:  npx tsx --env-file=.env.local scripts/rescore-metrics.ts --apply\n`);
  process.exit(1);
}

main().catch((e) => {
  console.error("Verify failed:", e.message);
  process.exit(1);
});

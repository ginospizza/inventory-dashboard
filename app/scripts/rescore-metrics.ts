/**
 * Re-score historical weekly_metrics with the 4-week rolling average.
 *
 * Why: status was being graded week-in-isolation on the live dashboard because
 * the rolling average was never applied to uploads (and the original load only
 * smoothed orders, not box-expected). This backfill recomputes every week's
 * ingredient + overall STATUS using smoothedDiffStatuses — the same single
 * source of truth the upload path now uses — smoothing BOTH orders and
 * box-expected across the current week + up to 3 prior weeks.
 *
 * It only rewrites status columns. Ordered / estimated / diffs / ratios are
 * untouched, so the change is fully reversible (re-run with the old logic) and
 * the raw data is never mutated.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/rescore-metrics.ts                 # dry run, summary only
 *   npx tsx --env-file=.env.local scripts/rescore-metrics.ts --store=GINOS014,GINOS076,GINOS103
 *   npx tsx --env-file=.env.local scripts/rescore-metrics.ts --apply         # actually write
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
 */

import { createClient } from "@supabase/supabase-js";
import { smoothedDiffStatuses, overallStatus, type RollingWeek } from "../src/lib/calculations/engine";
import type { ComplianceStatus, StoreType } from "../src/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (load with --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const APPLY = process.argv.includes("--apply");
const storeArg = process.argv.find((a) => a.startsWith("--store="));
const STORE_FILTER = storeArg
  ? new Set(storeArg.replace("--store=", "").split(",").map((s) => s.trim().toUpperCase()))
  : null;

const LABEL: Record<ComplianceStatus, string> = { ok: "Compliant", warn: "Borderline", bad: "At Risk" };

interface Row {
  id: string;
  store_id: string;
  year: number;
  week_number: number;
  store_type: StoreType;
  cheese_ordered_oz: number; sauce_ordered_floz: number; flour_ordered_kg: number; dough_ordered_kg: number;
  cheese_estimated_oz: number; sauce_estimated_floz: number; flour_estimated_kg: number; dough_estimated_kg: number;
  cheese_status: ComplianceStatus; sauce_status: ComplianceStatus; flour_status: ComplianceStatus; dough_status: ComplianceStatus;
  sauce_cheese_status: ComplianceStatus; flour_cheese_status: ComplianceStatus; dough_cheese_status: ComplianceStatus;
  overall_status: ComplianceStatus;
}

const toRolling = (r: Row): RollingWeek => ({
  cheese_ordered_oz: r.cheese_ordered_oz || 0,
  sauce_ordered_floz: r.sauce_ordered_floz || 0,
  flour_ordered_kg: r.flour_ordered_kg || 0,
  dough_ordered_kg: r.dough_ordered_kg || 0,
  cheese_estimated_oz: r.cheese_estimated_oz || 0,
  sauce_estimated_floz: r.sauce_estimated_floz || 0,
  flour_estimated_kg: r.flour_estimated_kg || 0,
  dough_estimated_kg: r.dough_estimated_kg || 0,
});

const pct = (ord: number, est: number) => (est > 0 ? Math.round(((ord - est) / est) * 100) : null);

async function main() {
  console.log(`\n=== Re-score weekly_metrics (4-week rolling avg, both sides) ===`);
  console.log(APPLY ? "MODE: APPLY (will write status changes)" : "MODE: DRY RUN (no writes)");
  if (STORE_FILTER) console.log(`Store filter (detail view): ${[...STORE_FILTER].join(", ")}`);

  // Store code lookup (for reporting + filtering)
  const { data: stores } = await supabase.from("stores").select("id, code");
  const codeById = new Map<string, string>((stores ?? []).map((s) => [s.id, s.code]));

  // Pull every metric row (paged — Supabase caps at 1000/req)
  const cols =
    "id, store_id, year, week_number, store_type," +
    "cheese_ordered_oz, sauce_ordered_floz, flour_ordered_kg, dough_ordered_kg," +
    "cheese_estimated_oz, sauce_estimated_floz, flour_estimated_kg, dough_estimated_kg," +
    "cheese_status, sauce_status, flour_status, dough_status," +
    "sauce_cheese_status, flour_cheese_status, dough_cheese_status, overall_status";
  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("weekly_metrics")
      .select(cols)
      .order("store_id", { ascending: true })
      .order("year", { ascending: true })
      .order("week_number", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  console.log(`Loaded ${all.length} weekly_metrics rows across ${new Set(all.map((r) => r.store_id)).size} stores.\n`);

  // Group by store, then sort chronologically
  const byStore = new Map<string, Row[]>();
  for (const r of all) {
    const arr = byStore.get(r.store_id) ?? [];
    arr.push(r);
    byStore.set(r.store_id, arr);
  }

  const transitions = new Map<string, number>(); // "bad->warn" -> count
  const changes: { row: Row; next: ComplianceStatus; code: string }[] = [];

  for (const [storeId, rows] of byStore) {
    rows.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.week_number - b.week_number));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const prior = rows.slice(Math.max(0, i - 3), i).map(toRolling); // up to 3 preceding
      const s = smoothedDiffStatuses(toRolling(r), prior, r.store_type);
      const ratio: ComplianceStatus[] =
        r.store_type === "flour"
          ? [r.sauce_cheese_status, r.flour_cheese_status]
          : [r.sauce_cheese_status, r.dough_cheese_status];
      const diff: ComplianceStatus[] =
        r.store_type === "flour"
          ? [s.cheese_status, s.sauce_status, s.flour_status]
          : [s.cheese_status, s.sauce_status, s.dough_status];
      const next = overallStatus([...diff, ...ratio]);

      if (next !== r.overall_status) {
        const key = `${r.overall_status}->${next}`;
        transitions.set(key, (transitions.get(key) ?? 0) + 1);
        changes.push({ row: r, next, code: codeById.get(storeId) ?? storeId });
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(`Status changes: ${changes.length} of ${all.length} store-weeks\n`);
  const order = ["bad->warn", "bad->ok", "warn->ok", "ok->warn", "ok->bad", "warn->bad"];
  const seen = [...transitions.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const k of seen) {
    const [from, to] = k.split("->") as ComplianceStatus[];
    const arrow = order.indexOf(k) < 3 ? "▼ relaxed " : "▲ escalated";
    console.log(`  ${arrow}  ${LABEL[from]} -> ${LABEL[to]}: ${transitions.get(k)}`);
  }

  // ── Per-store before/after detail (for the filtered stores) ─
  if (STORE_FILTER) {
    for (const [storeId, rows] of byStore) {
      const code = (codeById.get(storeId) ?? "").toUpperCase();
      if (![...STORE_FILTER].some((f) => code.includes(f))) continue;
      rows.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.week_number - b.week_number));
      console.log(`\n──────── ${code} (${rows[0]?.store_type}) ────────`);
      console.log("  wk   cheese%  sauce%  flour%   old        ->  new");
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const prior = rows.slice(Math.max(0, i - 3), i).map(toRolling);
        const s = smoothedDiffStatuses(toRolling(r), prior, r.store_type);
        const ratio: ComplianceStatus[] =
          r.store_type === "flour" ? [r.sauce_cheese_status, r.flour_cheese_status] : [r.sauce_cheese_status, r.dough_cheese_status];
        const diff: ComplianceStatus[] =
          r.store_type === "flour" ? [s.cheese_status, s.sauce_status, s.flour_status] : [s.cheese_status, s.sauce_status, s.dough_status];
        const next = overallStatus([...diff, ...ratio]);
        const c = pct(r.cheese_ordered_oz, r.cheese_estimated_oz);
        const sp = pct(r.sauce_ordered_floz, r.sauce_estimated_floz);
        const fp = r.store_type === "flour" ? pct(r.flour_ordered_kg, r.flour_estimated_kg) : pct(r.dough_ordered_kg, r.dough_estimated_kg);
        const flag = next !== r.overall_status ? "  <== changed" : "";
        const f = (n: number | null) => (n === null ? "   -" : `${n >= 0 ? "+" : ""}${n}%`).padStart(7);
        console.log(
          `  ${String(r.week_number).padStart(2)}  ${f(c)} ${f(sp)} ${f(fp)}   ${LABEL[r.overall_status].padEnd(10)} ->  ${LABEL[next]}${flag}`
        );
      }
    }
  }

  // ── Apply ─────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\nDry run only — no rows written. Re-run with --apply to persist.\n`);
    return;
  }

  console.log(`\nApplying ${changes.length} status changes...`);
  let written = 0;
  for (const { row, next } of changes) {
    // Recompute the per-ingredient statuses to persist alongside overall.
    const rows = byStore.get(row.store_id)!;
    const i = rows.findIndex((x) => x.id === row.id);
    const prior = rows.slice(Math.max(0, i - 3), i).map(toRolling);
    const s = smoothedDiffStatuses(toRolling(row), prior, row.store_type);
    const { error } = await supabase
      .from("weekly_metrics")
      .update({
        cheese_status: s.cheese_status,
        sauce_status: s.sauce_status,
        flour_status: s.flour_status,
        dough_status: s.dough_status,
        overall_status: next,
      })
      .eq("id", row.id);
    if (error) console.error(`  update failed for ${row.id}: ${error.message}`);
    else written++;
  }
  console.log(`Done. Updated ${written}/${changes.length} rows.\n`);
}

main().catch((e) => {
  console.error("Re-score failed:", e.message);
  process.exit(1);
});

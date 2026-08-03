/**
 * Merge duplicate store rows into their canonical store (James, July 31 2026:
 * "GINOS159 under Michel, and GINOS159 OLD under Unassigned... Is there a way
 * we can combine this data together, or clean up the old names on the list?").
 *
 * How the duplicates arose (three causes, all now fixed at the source):
 *   1. The first production import (2026-05-01) stripped " NEW" but not " OLD",
 *      so "GINOS159 OLD" etc became their own unassigned store rows with real
 *      metrics. The same-day fix re-imported onto canonical rows but never
 *      deleted the orphans.
 *   2. The upload route's storeMap collapsed canonical + orphan onto one key
 *      with last-row-wins, so fresh uploads attached to the ORPHAN
 *      ("GINOS176 OLD2 has the right data"). Fixed via preferCanonicalStore.
 *   3. The normalizer didn't collapse "GINOS 005" -> "GINOS005". Fixed.
 *
 * This script is the one-time cleanup for the rows those bugs left behind:
 *
 *   For each group of stores whose codes normalize to the same key:
 *     canonical = preferCanonicalStore across the group
 *     for each duplicate:
 *       - weekly_orders.store_id     -> canonical (straight re-point)
 *       - weekly_metrics: re-point where canonical lacks that (year, week);
 *         where BOTH rows hold the same store-week, keep the one with the
 *         newer created_at (the more recent computation — re-uploads and
 *         re-imports both bump it) and delete the loser
 *       - carry the duplicate's dsm_id over if the canonical has none
 *       - delete the duplicate store row (safe only AFTER re-pointing:
 *         weekly_metrics and weekly_orders are ON DELETE CASCADE)
 *
 * After applying, run rescore-metrics --apply (merged series change the
 * rolling windows) and verify-statuses.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/merge-duplicate-stores.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/merge-duplicate-stores.ts --apply
 */

import { createClient } from "@supabase/supabase-js";
import { normalizeStoreCode, preferCanonicalStore } from "../src/lib/calculations/stores";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing env (load with --env-file=.env.local)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const APPLY = process.argv.includes("--apply");

type StoreRow = { id: string; code: string; name: string; dsm_id: string | null; created_at: string };
type MetricRow = { id: string; store_id: string; year: number; week_number: number; created_at: string };

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
  console.log(`\n=== Merge duplicate stores ===`);
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY RUN (no writes)");

  const stores = await paged<StoreRow>((f, t) =>
    supabase.from("stores").select("id, code, name, dsm_id, created_at").range(f, t)
  );

  // Group by normalized code.
  const groups = new Map<string, StoreRow[]>();
  for (const s of stores) {
    const key = normalizeStoreCode(s.code);
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }
  const dupGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`${stores.length} stores; ${dupGroups.length} duplicate groups:\n`);

  let totalOrdersMoved = 0, totalMetricsMoved = 0, totalMetricsDropped = 0, storesDeleted = 0;

  for (const [key, rows] of dupGroups) {
    // Canonical: same preference rule the upload path now uses.
    let canonical = rows[0];
    for (const r of rows.slice(1)) canonical = preferCanonicalStore(canonical, r, key);
    const duplicates = rows.filter((r) => r.id !== canonical.id);

    console.log(`── ${key}`);
    console.log(`   canonical: "${canonical.code}" (dsm=${canonical.dsm_id ? "yes" : "none"})`);

    for (const dup of duplicates) {
      // Orders: straight re-point (no uniqueness constraint on weekly_orders).
      const { count: orderCount } = await supabase
        .from("weekly_orders")
        .select("id", { count: "exact", head: true })
        .eq("store_id", dup.id);

      // Metrics: split into movable vs colliding.
      const dupMetrics = await paged<MetricRow>((f, t) =>
        supabase.from("weekly_metrics").select("id, store_id, year, week_number, created_at")
          .eq("store_id", dup.id).range(f, t)
      );
      const canonMetrics = await paged<MetricRow>((f, t) =>
        supabase.from("weekly_metrics").select("id, store_id, year, week_number, created_at")
          .eq("store_id", canonical.id).range(f, t)
      );
      const canonByWeek = new Map(canonMetrics.map((m) => [`${m.year}-${m.week_number}`, m]));

      const movable = dupMetrics.filter((m) => !canonByWeek.has(`${m.year}-${m.week_number}`));
      const colliding = dupMetrics.filter((m) => canonByWeek.has(`${m.year}-${m.week_number}`));
      // On collision keep the newer computation.
      const dupWins = colliding.filter(
        (m) => new Date(m.created_at) > new Date(canonByWeek.get(`${m.year}-${m.week_number}`)!.created_at)
      );

      console.log(
        `   merge "${dup.code}": ${orderCount ?? 0} order lines, ` +
        `${movable.length} metrics move, ${colliding.length} collide ` +
        `(${dupWins.length} newer on the duplicate side)`
      );

      totalOrdersMoved += orderCount ?? 0;
      totalMetricsMoved += movable.length + dupWins.length;
      totalMetricsDropped += colliding.length;

      if (!APPLY) continue;

      // 1. Re-point order lines.
      {
        const { error } = await supabase.from("weekly_orders").update({ store_id: canonical.id }).eq("store_id", dup.id);
        if (error) throw new Error(`orders re-point failed for ${dup.code}: ${error.message}`);
      }

      // 2. Collisions where the duplicate is newer: delete the canonical's row
      //    FIRST (frees the unique key), then the duplicate row moves across.
      for (const m of dupWins) {
        const loser = canonByWeek.get(`${m.year}-${m.week_number}`)!;
        const { error: delErr } = await supabase.from("weekly_metrics").delete().eq("id", loser.id);
        if (delErr) throw new Error(`collision delete failed: ${delErr.message}`);
      }
      // Collisions where the canonical is newer: drop the duplicate's row.
      const dupLosses = colliding.filter((m) => !dupWins.includes(m));
      for (const m of dupLosses) {
        const { error: delErr } = await supabase.from("weekly_metrics").delete().eq("id", m.id);
        if (delErr) throw new Error(`dup metric delete failed: ${delErr.message}`);
      }

      // 3. Move the remaining duplicate metrics (movable + collision winners).
      {
        const { error } = await supabase.from("weekly_metrics").update({ store_id: canonical.id }).eq("store_id", dup.id);
        if (error) throw new Error(`metrics re-point failed for ${dup.code}: ${error.message}`);
      }

      // 4. Carry a DSM over if the canonical lacks one.
      if (!canonical.dsm_id && dup.dsm_id) {
        await supabase.from("stores").update({ dsm_id: dup.dsm_id }).eq("id", canonical.id);
        canonical.dsm_id = dup.dsm_id;
        console.log(`   carried DSM from "${dup.code}" to canonical`);
      }

      // 5. Delete the now-empty duplicate store row (cascades have nothing left).
      {
        const { error } = await supabase.from("stores").delete().eq("id", dup.id);
        if (error) throw new Error(`store delete failed for ${dup.code}: ${error.message}`);
        storesDeleted++;
      }
    }

    // The canonical row's own code may still be non-canonical (e.g. the only
    // survivor is "GINOS 005") — normalize it so the list reads clean.
    if (canonical.code !== key) {
      console.log(`   rename canonical "${canonical.code}" -> "${key}"`);
      if (APPLY) {
        const { error } = await supabase.from("stores").update({ code: key }).eq("id", canonical.id);
        if (error) throw new Error(`rename failed: ${error.message}`);
      }
    }
  }

  console.log(`\nTotals: ${totalOrdersMoved} order lines moved, ${totalMetricsMoved} metrics moved, ${totalMetricsDropped} collisions resolved, ${storesDeleted} store rows deleted.`);
  if (!APPLY) {
    console.log(`\nDry run only — re-run with --apply. Then run rescore-metrics --apply and verify-statuses.\n`);
  } else {
    console.log(`\nNow run: rescore-metrics --apply, then verify-statuses.\n`);
  }
}

main().catch((e) => { console.error("Merge failed:", e.message); process.exit(1); });

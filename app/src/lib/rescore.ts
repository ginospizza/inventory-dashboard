/**
 * Re-score every stored status against the ACTIVE engine config.
 *
 * This is the server-side core behind the admin "Re-score" button
 * (/api/rescore) — the same recompute scripts/rescore-metrics.ts performs from
 * the CLI. Both call recomputeRollingStatuses, the single source of truth for
 * the algorithm; this wrapper exists because editing thresholds in the admin
 * panel (James, July 31 2026) makes historical statuses stale, and James can't
 * run a CLI.
 *
 * Callers MUST ensure the engine config is loaded/reloaded first — grading
 * runs against whatever is active.
 *
 * Writes are BATCHED upserts (500/request) rather than per-row updates: a
 * threshold edit can change thousands of rows and Vercel functions have a
 * timeout a row-at-a-time loop would blow. The upsert path only ever touches
 * existing rows (they were just read), so the insert branch never fires.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { recomputeRollingStatuses, type RollingStatusRow } from "@/lib/calculations/engine";
import type { ComplianceStatus, StoreType } from "@/lib/types";

const STATUS_FIELDS = [
  "cheese_status", "sauce_status", "flour_status", "dough_status",
  "sauce_cheese_status", "flour_cheese_status", "dough_cheese_status", "overall_status",
] as const;

type Row = {
  id: string; store_id: string; year: number; week_number: number; store_type: StoreType;
  cheese_ordered_oz: number; sauce_ordered_floz: number; flour_ordered_kg: number; dough_ordered_kg: number;
  cheese_estimated_oz: number; sauce_estimated_floz: number; flour_estimated_kg: number; dough_estimated_kg: number;
} & Record<(typeof STATUS_FIELDS)[number], ComplianceStatus>;

export interface RescoreResult {
  total: number;
  changed: number;
  /** overall_status transitions, e.g. { "ok->warn": 12 } */
  transitions: Record<string, number>;
  /** rows written (0 on dry run) */
  updated: number;
}

export async function runRescore(apply: boolean): Promise<RescoreResult> {
  const admin = createAdminClient();

  const cols =
    "id, store_id, year, week_number, store_type," +
    "cheese_ordered_oz, sauce_ordered_floz, flour_ordered_kg, dough_ordered_kg," +
    "cheese_estimated_oz, sauce_estimated_floz, flour_estimated_kg, dough_estimated_kg," +
    STATUS_FIELDS.join(", ");

  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
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

  const byStore = new Map<string, Row[]>();
  for (const r of all) {
    const arr = byStore.get(r.store_id) ?? [];
    arr.push(r);
    byStore.set(r.store_id, arr);
  }

  const transitions: Record<string, number> = {};
  const updates: Record<string, unknown>[] = [];

  for (const [, rows] of byStore) {
    rows.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.week_number - b.week_number));
    const results = recomputeRollingStatuses(
      rows.map((r): RollingStatusRow => ({
        cheese_ordered_oz: r.cheese_ordered_oz || 0,
        sauce_ordered_floz: r.sauce_ordered_floz || 0,
        flour_ordered_kg: r.flour_ordered_kg || 0,
        dough_ordered_kg: r.dough_ordered_kg || 0,
        cheese_estimated_oz: r.cheese_estimated_oz || 0,
        sauce_estimated_floz: r.sauce_estimated_floz || 0,
        flour_estimated_kg: r.flour_estimated_kg || 0,
        dough_estimated_kg: r.dough_estimated_kg || 0,
        store_type: r.store_type,
      }))
    );

    rows.forEach((r, i) => {
      const next = results[i];
      const anyChanged = STATUS_FIELDS.some((f) => next[f] !== r[f]);
      if (!anyChanged) return;
      if (next.overall_status !== r.overall_status) {
        const key = `${r.overall_status}->${next.overall_status}`;
        transitions[key] = (transitions[key] ?? 0) + 1;
      }
      updates.push({
        store_id: r.store_id,
        year: r.year,
        week_number: r.week_number,
        cheese_status: next.cheese_status,
        sauce_status: next.sauce_status,
        flour_status: next.flour_status,
        dough_status: next.dough_status,
        sauce_cheese_status: next.sauce_cheese_status,
        flour_cheese_status: next.flour_cheese_status,
        dough_cheese_status: next.dough_cheese_status,
        overall_status: next.overall_status,
      });
    });
  }

  let updated = 0;
  if (apply) {
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500);
      const { error } = await admin
        .from("weekly_metrics")
        .upsert(chunk, { onConflict: "store_id,year,week_number" });
      if (error) throw new Error(`rescore batch at ${i} failed: ${error.message}`);
      updated += chunk.length;
    }
  }

  return { total: all.length, changed: updates.length, transitions, updated };
}

/**
 * Compare Periods — a period is either one week or a whole quarter.
 *
 * James (Sept 30 2026, relaying team feedback): "adding quarters as an
 * option here instead of just weeks". Consistent with the store page's range
 * filters (July 31 2026: longer periods show "the average for the whole period"),
 * a quarter covers EVERY store-week inside it, not just its last week:
 *
 *   - network cards: computed over all store-weeks in the quarter, so
 *     Compliance is the share of store-weeks compliant across the quarter and
 *     the averages are quarter averages
 *   - per store: diffs and S:C averaged over the store's weeks in the quarter;
 *     status is the one it held MOST weeks (ties go to the worse status)
 *
 * A single week degenerates to exactly the old behaviour (one row per store).
 */

import { statusRank } from "@/lib/types";

export const QUARTERS = ["q1", "q2", "q3", "q4"] as const;
export type Quarter = (typeof QUARTERS)[number];
export type ComparePeriod = number | Quarter;

const QUARTER_BOUNDS: Record<Quarter, [number, number]> = {
  q1: [1, 13],
  q2: [14, 26],
  q3: [27, 39],
  q4: [40, 52],
};

export function isQuarter(p: ComparePeriod): p is Quarter {
  return typeof p === "string";
}

/** URL param → period. Unknown or missing values fall back. */
export function parsePeriod(raw: string | undefined, fallback: number): ComparePeriod {
  if (!raw) return fallback;
  const q = raw.toLowerCase();
  if ((QUARTERS as readonly string[]).includes(q)) return q as Quarter;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Quarters that have data in a year, with the weeks actually present — so a
 * quarter in progress reads "Q3 · Wk 27–38" rather than claiming week 39.
 */
export function availableQuarters(weeks: number[]): { value: Quarter; label: string }[] {
  const out: { value: Quarter; label: string }[] = [];
  for (const q of QUARTERS) {
    const [lo, hi] = QUARTER_BOUNDS[q];
    const inQ = weeks.filter((w) => w >= lo && w <= hi);
    if (inQ.length === 0) continue;
    const first = Math.min(...inQ);
    const last = Math.max(...inQ);
    out.push({
      value: q,
      label: `${q.toUpperCase()} · Wk ${first}${last !== first ? `–${last}` : ""}`,
    });
  }
  return out;
}

export interface StoreWeekRow {
  store_id: string;
  cheese_diff: number;
  sauce_diff: number;
  sauce_cheese_ratio: number;
  overall_status: string;
}

export interface StorePeriodSummary {
  cheese_diff: number;
  sauce_diff: number;
  sc_ratio: number;
  status: string;
}

/** One summary per store over every row it has in the period. */
export function summariseStores(rows: StoreWeekRow[]): Map<string, StorePeriodSummary> {
  const byStore = new Map<string, StoreWeekRow[]>();
  for (const r of rows) {
    const list = byStore.get(r.store_id) ?? [];
    list.push(r);
    byStore.set(r.store_id, list);
  }

  const out = new Map<string, StorePeriodSummary>();
  for (const [storeId, list] of byStore) {
    const avg = (f: (r: StoreWeekRow) => number) =>
      list.reduce((s, r) => s + (f(r) || 0), 0) / list.length;

    const counts = new Map<string, number>();
    for (const r of list) counts.set(r.overall_status, (counts.get(r.overall_status) ?? 0) + 1);
    let status = list[0].overall_status;
    for (const [s, c] of counts) {
      const best = counts.get(status)!;
      if (c > best || (c === best && statusRank(s) > statusRank(status))) status = s;
    }

    out.set(storeId, {
      cheese_diff: avg((r) => r.cheese_diff),
      sauce_diff: avg((r) => r.sauce_diff),
      sc_ratio: avg((r) => r.sauce_cheese_ratio),
      status,
    });
  }
  return out;
}

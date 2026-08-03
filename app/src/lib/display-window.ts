/**
 * Resolve the Period filter to a display WINDOW over the newest-first series.
 *
 * James (July 31 2026): for individual weeks the filter should keep anchoring
 * a 6-week window ("this is how we want it for the individual weeks"), but for
 * the longer periods — Q1..Q4, YTD, All Weeks — the page should show the
 * average over the WHOLE period, not just the last 6 weeks of it.
 *
 * So: individual week / Latest → that week + the 5 before it (unchanged);
 * a range → every week inside the range. The label rides along so the UI can
 * say "Q2 avg · 13 wks" instead of "6-wk avg".
 *
 * The window is DISPLAY-ONLY. Compliance statuses are graded on the engine's
 * fixed 6-week window regardless of what the page displays, so the Compare tab
 * and explainStatus deliberately do not use this.
 */
export interface DisplayWindow {
  start: number;   // index of the newest row in the window
  count: number;   // number of rows
  label: string;   // e.g. "6-wk avg", "Q2 avg · 13 wks"
}

export function resolveWindow(
  sorted: { year: number; week_number: number }[],
  week: string | undefined,
  year: number,
  rollingWeeks: number
): DisplayWindow {
  const inYear = (m: { year: number }) => m.year === year;

  // A contiguous in-year block [lo, hi] of week numbers → window indices.
  const rangeWindow = (lo: number, hi: number, name: string): DisplayWindow | null => {
    const start = sorted.findIndex((m) => inYear(m) && m.week_number >= lo && m.week_number <= hi);
    if (start === -1) return null;
    let end = start;
    while (
      end + 1 < sorted.length &&
      inYear(sorted[end + 1]) &&
      sorted[end + 1].week_number >= lo &&
      sorted[end + 1].week_number <= hi
    ) {
      end++;
    }
    const count = end - start + 1;
    return { start, count, label: `${name} avg · ${count} wk${count === 1 ? "" : "s"}` };
  };

  const rolling = (start: number): DisplayWindow => {
    const count = Math.min(rollingWeeks, sorted.length - start);
    return { start, count, label: `${count}-wk avg` };
  };

  if (!week || week === "" || week === "latest") return rolling(0);

  if (week === "all" || week === "ytd") {
    const name = week === "ytd" ? "YTD" : String(year);
    return rangeWindow(0, 53, name) ?? rolling(0);
  }

  const QUARTERS: Record<string, [number, number]> = {
    q1: [1, 13], q2: [14, 26], q3: [27, 39], q4: [40, 52],
  };
  const quarter = QUARTERS[week];
  if (quarter) {
    return rangeWindow(quarter[0], quarter[1], week.toUpperCase()) ?? rolling(0);
  }

  const n = Number(week);
  if (Number.isFinite(n)) {
    const i = sorted.findIndex((m) => inYear(m) && m.week_number === n);
    if (i !== -1) return rolling(i);
  }
  return rolling(0);
}

/**
 * Week-number ↔ calendar-date mapping.
 *
 * James (July 22 2026): "Add dates to the week filter. We'd like the Monday of
 * the week to be listed as below to assist with determining which week is when.
 * We can add a date column to the upload file, so it will import with a date
 * for the week."
 *
 * The upload column turns out not to be necessary: the mapping is derivable, and
 * his own screenshot pins down which convention the data uses. He showed
 * "WK27 - 07/06", i.e. week 27 of 2026 starts Monday July 6 2026.
 *
 *   - ISO-8601 weeks would put week 27 of 2026 at Monday June 29 — off by one.
 *   - "Week 1 starts on the first Monday of the year" puts it at Monday July 6.
 *     2026-01-01 is a Thursday, so the first Monday is Jan 5; Jan 5 + 26 weeks
 *     = July 6. That matches.
 *
 * CONFIRMED by James (July 31 2026): "Our system goes Monday to Sunday and lists
 * the last week of the year as 52, and the remainder of that week as 0, and
 * begins week 1 from the first Monday of the year." The raw workbooks agree —
 * the 2025 file has a sheet "Export Data Jan 6 - 10" tagged week 1 (Jan 6 2025
 * being that year's first Monday), "Dec 29 - Jan 4" tagged week 52, and
 * "Export Data Dec 30 - Jan 5" tagged week 0.
 *
 * WEEK 0 is therefore the Monday-week sitting between week 52 of one year and
 * week 1 of the next — the leftover that 52 weeks from the first Monday doesn't
 * reach. `firstMonday - 7 days` produces it for free, so week 0 needs no special
 * case here; mondayOfWeek(2025, 0) = Dec 30 2024, matching that sheet exactly.
 *
 * Note that import-historical SKIPS week 0 rows (`weekNumber <= 0`), so week 0
 * orders are not currently loaded into weekly_metrics at all. That is a data
 * completeness question rather than a dating one, and is flagged to James.
 */

/** Monday of `week` in `year`, under the first-Monday-of-January convention. */
export function mondayOfWeek(year: number, week: number): Date {
  // Jan 1 in UTC, so the result can't be shifted by a local timezone offset.
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const dow = jan1.getUTCDay(); // 0 = Sunday, 1 = Monday
  // Days from Jan 1 forward to the first Monday (0 if Jan 1 IS a Monday).
  const offsetToFirstMonday = (8 - dow) % 7;
  const firstMonday = new Date(Date.UTC(year, 0, 1 + offsetToFirstMonday));
  return new Date(
    Date.UTC(
      firstMonday.getUTCFullYear(),
      firstMonday.getUTCMonth(),
      firstMonday.getUTCDate() + (week - 1) * 7
    )
  );
}

/**
 * Short label for a week's Monday, e.g. "07/06" — the format in James's
 * screenshot (MM/DD). Kept separate from the Date so callers can format
 * differently without recomputing.
 */
export function weekMondayLabel(year: number, week: number): string {
  const d = mondayOfWeek(year, week);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

/** "Wk 27 · 07/06" — for anomaly and flag lines that need week plus date. */
export function weekWithDate(year: number, week: number): string {
  return `Wk ${week} · ${weekMondayLabel(year, week)}`;
}

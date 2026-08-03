/**
 * Store-code normalization and ignore rules.
 *
 * The raw weekly export writes store names inconsistently ("TTD HESPELER NEW",
 * "STORE 015OLD2") and includes non-store entries (head offices, wholesalers,
 * SAPUTO/SUNDRY summary rows). The historical importer always normalized these;
 * the upload path must apply the SAME rules or a self-serve upload would create
 * duplicate stores ("GINOS002 NEW" next to "GINOS002") and phantom stores for
 * head offices. Single source of truth for both paths.
 */

/** Canonical store code: collapse whitespace, uppercase, strip OLD/NEW suffixes. */
export function normalizeStoreCode(raw: string): string {
  return (
    raw
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase()
      .replace(/\s*OLD\s*\d*\s*$/i, "") // strip OLD, OLD2, etc.
      .replace(/\s*NEW\s*\d*\s*$/i, "") // strip NEW, NEW2, etc.
      // "GINOS 005" and "GINOS005" are the same store — the commissary export
      // sometimes puts a space between the brand and the number, which made a
      // second store row (James, July 31 2026: "GINOS 005 under Unassigned").
      // ONLY GINOS is collapsed: GINOS codes are always brand+digits, whereas
      // "STORE 015", "TTD BARRIE", "PP/WM14 WM081" legitimately contain spaces.
      .replace(/^GINOS\s+(?=\d)/, "GINOS")
      .trim()
  );
}

/**
 * Of two store rows whose codes normalize to the same key, which should
 * uploads attach data to?
 *
 * Preference: the row whose stored code IS the canonical form ("GINOS176"
 * beats "GINOS176 OLD2"), then the row with a DSM assignment, then the
 * incumbent. Before this rule the upload route's storeMap was built with an
 * unconditional set() over an UNORDERED select, so whichever row the database
 * returned last silently won — reliably the unassigned "OLD" orphan, because
 * those rows were created later. That is exactly James's "the data is right,
 * but this should be under Raj's GINOS176, not the unassigned GINOS176 OLD2"
 * (July 31 2026).
 */
export function preferCanonicalStore<T extends { code: string; dsm_id?: string | null }>(
  incumbent: T | undefined,
  candidate: T,
  normalizedCode: string
): T {
  if (!incumbent) return candidate;
  const canonical = (s: T) => normalizeStoreCode(s.code) === s.code.trim().toUpperCase();
  const exact = (s: T) => s.code.trim().toUpperCase() === normalizedCode;
  if (exact(incumbent) !== exact(candidate)) return exact(incumbent) ? incumbent : candidate;
  if (canonical(incumbent) !== canonical(candidate)) return canonical(incumbent) ? incumbent : candidate;
  if (!!incumbent.dsm_id !== !!candidate.dsm_id) return incumbent.dsm_id ? incumbent : candidate;
  return incumbent;
}

// Non-store entries per James: head offices, wholesalers, anything without a
// brand prefix.
//
// TTD WOOLWICH HEAD OFFICE is deliberately NOT here: it went back to being a
// functioning corporate-operated store in 2026 (James, July 9 2026) — real
// order data starting week 12/2026 (0 rows in all of 2025, when it really was
// just a head office). It's a distinct store from "TTD WOOLWICH".
export const IGNORE_STORES = new Set([
  "SAPUTO", "SUNDRY", "GRAND TOTAL",
  "GINOS HEAD OFFICE", "DOUBLE DOUBLE PIZZA CHICKEN HEAD OFFICE",
  "TWICE THE DEAL HEAD OFFICE",
  "WING MACHINE INC", "IGG INTERNATIONAL INC", "PANZEROTTO PIZZA INC",
  "SKYBLUE WHOLESALE", "MURRAY WHOLESALE", "NR FUELS CONVENIENCE INC",
  "DOUBLE TASTE PIZZA AND SHAWARMA", "DOUBLE TASTE PIZZA AND SHAWARMA 2",
  "CRISPY SLICE PIZZA",
]);

const BRAND_PREFIXES = ["GINOS", "TTD", "PP", "WM", "STORE", "DD", "C "];

/** True for head offices, wholesalers, summary rows, and unbranded entries. */
export function shouldIgnoreStore(normalizedCode: string): boolean {
  if (IGNORE_STORES.has(normalizedCode)) return true;
  if (normalizedCode.includes("SAPUTO") || normalizedCode.includes("SUNDRY")) return true;
  return !BRAND_PREFIXES.some((p) => normalizedCode.startsWith(p));
}

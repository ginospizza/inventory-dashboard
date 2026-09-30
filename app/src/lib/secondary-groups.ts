/**
 * Group the Secondary Products tab by product category.
 *
 * James (Sept 30 2026): "Sometimes we change a SKU for a new product, new
 * supplier, etc, but it would useful if the old and new SKUs are grouped" —
 * e.g. V Food Pepperoni replaced Sugardale Pepperoni, so each SKU alone shows
 * a meaningless -100% / new-product YoY while the combined pepperoni number is
 * the real comparison.
 *
 * Products sharing a category (trimmed, case-insensitive) form one group with a
 * combined subtotal; uncategorised products are groups of one, shown exactly as
 * before. Groups sort by combined quantity (desc) then name, members likewise.
 */

export interface SecondaryProduct {
  code: string;
  description: string;
  pack_size: string;
  category: string | null;
  quantity: number;
}

export interface SecondaryRow extends SecondaryProduct {
  /** Same range a year earlier; undefined when there is no prior-year line. */
  prior?: number;
}

export interface SecondaryGroup {
  /** Display label, or null for an uncategorised single product. */
  category: string | null;
  quantity: number;
  prior?: number;
  rows: SecondaryRow[];
}

export function groupSecondaries(
  current: SecondaryProduct[],
  priorYear: { code: string; quantity: number }[]
): SecondaryGroup[] {
  const priorByCode = new Map(priorYear.map((p) => [p.code, p.quantity]));
  const groups = new Map<string, SecondaryGroup>();

  for (const p of current) {
    const label = p.category?.trim() || null;
    const key = label ? `cat:${label.toLowerCase()}` : `sku:${p.code}`;
    const group = groups.get(key) ?? { category: label, quantity: 0, rows: [] };
    const prior = priorByCode.get(p.code);
    group.rows.push({ ...p, prior });
    group.quantity += p.quantity;
    if (prior !== undefined) group.prior = (group.prior ?? 0) + prior;
    groups.set(key, group);
  }

  const name = (g: SecondaryGroup) => g.category ?? g.rows[0].description;
  const byQtyThenName = <T,>(qty: (t: T) => number, label: (t: T) => string) =>
    (a: T, b: T) => qty(b) - qty(a) || label(a).localeCompare(label(b));

  const out = [...groups.values()];
  for (const g of out) g.rows.sort(byQtyThenName<SecondaryRow>((r) => r.quantity, (r) => r.description));
  return out.sort(byQtyThenName<SecondaryGroup>((g) => g.quantity, name));
}

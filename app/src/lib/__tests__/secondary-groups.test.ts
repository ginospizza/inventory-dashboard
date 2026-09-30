import { describe, it, expect } from "vitest";
import { groupSecondaries } from "../secondary-groups";

const p = (code: string, description: string, quantity: number, category: string | null = null) =>
  ({ code, description, pack_size: "", category, quantity });

/**
 * James's screenshot (Sept 30 2026), WK 27-39: V Food Pepperoni 25 (new SKU,
 * no prior) and Sugardale Pepperoni 0 (prior 17) sat at opposite ends of the
 * list, each with a meaningless YoY. Grouped, pepperoni reads 25 vs 17.
 */
describe("groupSecondaries", () => {
  const current = [
    p("20214", "V Food Pepperoni (6.8Kg)", 25, "Pepperoni"),
    p("20203", "Bacon (9.07 Kg)", 11),
    p("40107", "Green Olives 6x2.84 Lt", 2, "Green Olives"),
    p("T020214", "Sugardale Pepperoni (9.07 Kg)", 0, "pepperoni "), // case/space variant
    p("040107C", "Gree Olives Pouches 10/1.7kg", 0, "Green Olives"),
    p("30104", "Chicken Wings 40lbs", 0),
  ];
  const prior = [
    { code: "T020214", quantity: 17 },
    { code: "20203", quantity: 9 },
    { code: "040107C", quantity: 1 },
  ];
  const groups = groupSecondaries(current, prior);

  it("keeps old and new SKUs of a category together with combined totals", () => {
    const pep = groups.find((g) => g.category === "Pepperoni")!;
    expect(pep.rows.map((r) => r.code)).toEqual(["20214", "T020214"]);
    expect(pep.quantity).toBe(25);
    expect(pep.prior).toBe(17);
  });

  it("matches categories case- and whitespace-insensitively", () => {
    expect(groups.filter((g) => g.category?.toLowerCase() === "pepperoni")).toHaveLength(1);
  });

  it("leaves uncategorised products as groups of one with their own prior", () => {
    const bacon = groups.find((g) => g.rows[0].code === "20203")!;
    expect(bacon.category).toBeNull();
    expect(bacon.rows).toHaveLength(1);
    expect(bacon.prior).toBe(9);
  });

  it("has no group prior when no member has a prior-year line", () => {
    expect(groups.find((g) => g.rows[0].code === "30104")!.prior).toBeUndefined();
  });

  it("sorts groups by combined quantity, then name", () => {
    expect(groups.map((g) => g.category ?? g.rows[0].description)).toEqual([
      "Pepperoni", "Bacon (9.07 Kg)", "Green Olives", "Chicken Wings 40lbs",
    ]);
  });
});

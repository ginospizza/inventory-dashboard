/**
 * Direction of a change for a TARGET-SEEKING metric (James, Aug 6 2026).
 *
 * Diffs aim at 0 and ratios aim at 100%, so the sign of a change says nothing
 * by itself: a cheese diff moving −1.9 → −1.4 is a "+0.5" change that is an
 * IMPROVEMENT, and an S:C moving 90.7% → 155.5% is a "+64.8%" change that is a
 * deterioration. The Compare page used to colour by the change's sign
 * ("It's a bit difficult to parse at the moment") — the rule James asked for:
 * "green if it's moving towards 0.0 or 100%, and red if it's getting further
 * away."
 *
 * Improvement = the distance from the target shrank.
 */
export type TargetDirection = "improved" | "worsened" | "same";

export function towardTarget(before: number, after: number, target: number): TargetDirection {
  const distBefore = Math.abs(before - target);
  const distAfter = Math.abs(after - target);
  // Float guard: treat sub-0.05 distance movement as unchanged rather than
  // letting rounding noise paint a row green or red.
  if (Math.abs(distAfter - distBefore) < 0.05) return "same";
  return distAfter < distBefore ? "improved" : "worsened";
}

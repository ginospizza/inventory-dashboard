import { describe, it, expect } from "vitest";
import { towardTarget } from "../toward-target";

/**
 * James's exact report (Aug 6 2026) — each of these rendered the WRONG colour
 * when the Compare page coloured by the change's sign:
 *
 *   "TTD Dundas is showing Cheese Diff down 0.5cs in red font. On the store
 *    page, the Cheese Diff changed from -1.9cs to -1.4cs. It is down 0.5cs,
 *    which is an improvement."
 *   "Claire Road is showing cheese -0.9 in green... Cheese diff went from
 *    -2.3cs to -3.2cs (worse) and S:C from 90.7% to 155.5% (worse)."
 */
describe("towardTarget — colour by movement toward the target, not by sign", () => {
  it("TTD Dundas: -1.9 -> -1.4 cheese diff is an improvement (was red)", () => {
    expect(towardTarget(-1.9, -1.4, 0)).toBe("improved");
  });

  it("Claire Road: -2.3 -> -3.2 cheese diff is worse (was green)", () => {
    expect(towardTarget(-2.3, -3.2, 0)).toBe("worsened");
  });

  it("Claire Road: S:C 90.7% -> 155.5% is worse (was green)", () => {
    expect(towardTarget(90.7, 155.5, 100)).toBe("worsened");
  });

  it("moving toward 100% from above is an improvement even though the change is negative", () => {
    expect(towardTarget(126.1, 100.0, 100)).toBe("improved"); // TTD Woodstock's S:C direction
  });

  it("crossing the target counts by distance, not by which side", () => {
    // -0.5 -> +0.3: distance 0.5 -> 0.3, closer to zero despite changing sign.
    expect(towardTarget(-0.5, 0.3, 0)).toBe("improved");
    // -0.3 -> +0.5: overshoots to a worse distance.
    expect(towardTarget(-0.3, 0.5, 0)).toBe("worsened");
  });

  it("no meaningful movement is 'same', including rounding noise", () => {
    expect(towardTarget(2.0, 2.0, 0)).toBe("same");
    expect(towardTarget(2.0, -2.0, 0)).toBe("same"); // equal distance, opposite side
    expect(towardTarget(1.501, 1.52, 0)).toBe("same"); // sub-0.05 noise
  });
});

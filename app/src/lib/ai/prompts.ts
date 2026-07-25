// Shared AI prompts for the compliance analyst.
// Single source of truth: used by the /api/ai route in production AND by
// the offline accuracy eval (scripts/eval-ai.mjs). Keep this file free of
// Next.js / server imports so it can be imported from a plain Node script.

/**
 * Status -> user-facing verdict word.
 *
 * Deliberately duplicated from STATUS_LABEL in @/lib/types rather than imported:
 * scripts/eval-ai.mjs loads this file by relative path under plain `node`, where
 * the `@/` path alias does not resolve. Keep the two in sync — if you add a
 * compliance tier, it needs an entry here AND in the Compliance Status section
 * of SYSTEM_PROMPT below.
 */
const VERDICT_LABEL: Record<string, string> = {
  ok: "Compliant",
  warn: "Borderline",
  bad: "At Risk",
  severe: "Severe",
};

export const SYSTEM_PROMPT = `You are the AI compliance analyst for Gino's Pizza, a franchise network of ~150+ pizza stores across Ontario, Canada. You work inside their internal inventory dashboard.

## Your Role
You help franchise managers (DSMs) and the finance team quickly understand compliance patterns, catch issues early, and decide where to focus their attention each week.

## Domain Knowledge

### Brands & Store Types
- **GINOS** (~100 stores): Gino's Pizza. Flour stores — they mix dough in-store from flour bags.
- **TTD** (~30 stores): Twice the Deal Pizza. Also flour stores.
- **DD / STORE** (~15 stores): Double Double Pizza and Chicken. Dough stores — they use pre-portioned dough.
- **PP/WM** (~15 stores): Multi-branded (Pizza + Wing Machine). Can be flour or dough type.

### Where the data comes from (critical — get the possible causes right)
The weekly order data is exported directly from the COMMISSARY system — the supplier's own sales records of what each store actually purchased through approved channels. Stores do not enter, upload, or self-report any of this data, and no store-side system feeds it.

Therefore NEVER suggest store-side data problems as a cause or a check. Do not say an order might be "double-entered," "double-counted," a "receiving error," a "logging error," or recommend "verifying what the system shows ordered against actual" — none of these are possible. If the data says a store bought 9 cases of sauce, the store bought 9 cases of sauce. Every explanation must be about real store BEHAVIOR: portioning, wastage, overstocking/bulk events, outside buying (only ever for UNDER-ordered ingredients), or boxes sourced outside approved channels (which makes the box-based expected usage understate true sales). Recommendations should audit the store's practices — portion sizes, standing order quantities, box sourcing — never the data entry.

### How Compliance Works
Every week, each store orders ingredients (cheese, sauce, flour/dough) and pizza boxes. The system compares:
- **What they ordered** (cheese in oz, sauce in fl oz, flour in kg or dough in kg)
- **What they should have used** (estimated from the pizza box sizes they ordered × per-pizza ingredient ratios)

The pizza BOXES are the anchor for all reasoning. Box counts are the ground truth for how many pizzas a store actually sold, so the expected cheese/sauce/flour usage is derived from boxes. Always reason from boxes first, then ask whether the ingredient diffs are consistent with each other.

A single ingredient's diff in isolation tells you very little. What matters is the PATTERN across cheese, sauce, and flour together, and whether they stay in ratio with one another. See "Diagnostic Reasoning" below.

### Key Metrics
- **Cheese/Sauce/Flour Diff**: measured in cases or bags, but flagged by PERCENTAGE of expected, not a flat amount. Borderline: beyond ±25% of expected. At Risk: beyond ±50%. Severe: beyond ±75%. (A store 6 cases over on 24 total is ~37% = Borderline; a store 5.9 cases over on 10 total is ~91% = Severe. The percentage is what matters, not the raw case count.)
- The data gives you a PRECOMPUTED signed percentage vs box-expected for each ingredient (cheese_pct, sauce_pct, flour_pct / dough_pct), calculated exactly the way the dashboard calculates it. USE THESE PERCENTAGES DIRECTLY when stating how far off an ingredient is. Do NOT convert cases or bags into a percentage yourself — a "case" is not a fixed size (it depends on the product the store buys), so any percentage you derive from case counts will be wrong. Never recompute, second-guess, or contradict the provided percentage. State the conclusion only; do not show the arithmetic.
- Diffs are computed against a 6-WEEK ROLLING AVERAGE baseline, not a single week, to smooth out stocking spikes and prior-week carryover.
- **Sauce-to-Cheese (S:C) Ratio**: (sauce/5)/(cheese/8). Target: 75%-125%. Below 75% suggests sauce issues. Above 125% suggests cheese issues.
- **Flour-to-Cheese (F:C) Ratio**: (flour×1.6/0.6)/(cheese/8). Same target range.
- **Dough-to-Cheese (D:C) Ratio**: (dough/0.6)/(cheese/8). Same target range. Used for DD/WM stores.

### Compliance Status
A store's status is its single WORST metric.
- **Compliant (ok)**: every ingredient within ±25% of box-expected AND every ratio 75-125%
- **Borderline (warn)**: at least one ingredient 25-50% off, or a ratio 65-135%
- **At Risk (bad)**: at least one ingredient 50-75% off, or a ratio 50-150%
- **Severe (severe)**: at least one ingredient more than 75% off, or a ratio outside 50-150%

Severe is the worst tier and is meant to be rare — it marks the handful of
stores needing action now, not merely a bad week. When the verdict is Severe,
say plainly how far off the driving metric is; do not soften it.

### Diagnostic Reasoning (confirmed with the franchise's domain expert)
Do NOT diagnose each ingredient independently. Read the whole picture — the three ingredient diffs together, plus whether they remain in ratio with each other and with boxes — before naming a cause.

STEP 0 — MAGNITUDE GATE (do this FIRST, before any pattern below). Check whether anything is actually out of range:
- A diff only counts as out of range if it exceeds ±25% of expected.
- A ratio (S:C, F:C, D:C) is "in ratio" / "in band" ONLY if its value sits within 0.75–1.25. A ratio of 1.49 or 1.83 is NOT in ratio — it is well above band. A small diff of a few cases/bags on a large base is NOT out of range.
- A ratio (S:C, F:C) outside 0.75–1.25 is ITSELF an out-of-range signal, independent of the raw ingredient diffs. A store can be out of range on a ratio even when every individual ingredient diff sits within ±25% — do not dismiss an out-of-band ratio just because the ingredient %s look modest.
- When a ratio is out of band, identify which ingredient is DRIVING it before naming any cause: the driver is the ingredient whose OWN % diff vs box-expected is materially off target. A ratio compares two ingredients, so an out-of-band ratio can mean either side moved — read the two % diffs to see which one did. Never name an ingredient as the problem when its own % diff is within ±25% and the other side of the ratio is far outside it.
  - S:C ABOVE 1.25 with SAUCE far OVER (+25% or more) while cheese is near target → the driver is SAUCE being over-used/over-ordered. Per the causal principle this can never be outside buying — it points to sauce over-portioning, wastage, or overstocking. Do NOT call this cheese under-ordering; cheese is fine.
  - F:C (or D:C) ABOVE 1.25 with FLOUR/DOUGH far OVER (+25% or more) while cheese is near target → the driver is FLOUR/DOUGH being over, NOT cheese. Cheese is on target, so do NOT mention cheese sourcing or cheese under-ordering at all. A lone flour/dough overage is shelf-stable overstocking/wastage that often normalizes the next week — say that, and stop. Do not append a cheese theory.
  - S:C or F:C ABOVE 1.25 with CHEESE genuinely UNDER (its own diff below -25%) while sauce is on-target (sauce is brand-supplied and the least-likely item to be swapped, so on-target sauce means the box/sales baseline is sound) and BOTH cheese ratios (S:C and F:C) elevated → treat cheese as the implicated ingredient and lean toward cheese being purchased outside — even if cheese's own % diff looks only moderate, because outside cheese makes the approved-channel cheese order understate true volume. This applies ONLY when cheese's own diff is actually negative; if cheese is on target, the elevated ratio is the OTHER ingredient's doing, not cheese's.
  - S:C or F:C BELOW 0.75 means cheese is HIGH relative to sauce/flour (cheese OVER-ordered). This can NEVER be outside buying — by the causal principle below, outside buying only ever shows as UNDER. A low S:C/F:C points to cheese over-ordering, wastage, or portioning, NOT a supplier issue. Do not write "over-portioning or outside purchasing" as if they were interchangeable; over implies wastage/portioning only.
- If ALL diffs are within ±25% AND both ratios are within 0.75–1.25, the store is COMPLIANT. Say so plainly and STOP — do NOT apply the pattern rules below and do NOT name outside buying, portioning, or any cause. The pattern rules apply only to metrics that are genuinely out of band.

KEY CAUSAL PRINCIPLE (apply before naming any supplier cause): OUTSIDE BUYING always shows up as UNDER-ordering through approved channels — a NEGATIVE diff for that ingredient. An ingredient that is OVER (positive diff) can NEVER be explained by outside buying; over-ordering points to wastage, portioning, or overstocking instead. Therefore only ever attribute outside buying to an ingredient that is UNDER. If cheese is under and flour is over, the outside-buying suspicion is about the CHEESE, and the high flour is a SEPARATE usage/wastage issue — name both, do not blame the flour on a supplier.

Once you have confirmed something is actually out of range, apply these rules in order:

1. ALL ingredients UNDER together by a MATERIAL amount (each beyond ~25%), still in ratio with each other → strong indicator of OUTSIDE BUYING (the store is sourcing cheese/sauce/flour from an unapproved supplier). This is the most reliable pattern. (Do not invoke this when the under-amounts are small/within band — that is just a compliant store.)

2. ALL THREE ingredients OVER together — meaning EACH of the three is beyond +25%. An ingredient within ±25% is ON TARGET, not "over": +4% or +6% does NOT count, so sauce +140% with cheese +4% and flour +6% is a LONE over-ingredient (see the lone over-ingredient note below), NOT this rule. When all three genuinely exceed +25% together, still in ratio → the expected-usage baseline is understating true sales, most likely because the store is sourcing pizza BOXES outside approved channels (the box count is the denominator for every estimate, so missing boxes make everything look over). NOT over-portioning and NOT outside buying of ingredients — and per the data-provenance section, NOT a store data-entry error (the purchase quantities are the commissary's own records). This situation is unusual; flag it for a human to review the store's box sourcing rather than asserting a portioning or supplier cause. (This rule requires ALL THREE to be over. A SINGLE ingredient over while the others are fine is NOT this case — see the note below on a lone over-ingredient.) IMPORTANT: this applies to a SUSTAINED all-over pattern. A SINGLE week where all three are over but ratios stay in band — within an otherwise-compliant multi-week history — is normal ordering lumpiness (a restocking / bulk-order week), NOT a concern. Do not flag it; note it at most in passing. Only treat all-over as a review concern when it persists across multiple weeks.

3. ONE ingredient off while the others stay in ratio — this depends on how far off it is:
   - Off by roughly 20% or LESS → likely a PORTIONING issue (e.g. 7 or 9 oz of cheese on a large instead of 8, or 4 oz of sauce instead of 5). Real-world portioning rarely drifts beyond ~20%, because anything larger produces customer complaints.
   - UNDER by MORE than ~20% while sauce, flour, and boxes are all in ratio → that single ingredient is likely being PURCHASED OUTSIDE. A drift that large is too big to be portioning.

4. When the ingredient ratios to each other are in band but the diffs vs. boxes are high, the problem points to the BOXES (tracking / unapproved boxes), not the ingredients.

5. Always start from the box metric. Box counts are the most trustworthy signal of true sales volume; build every diagnosis on top of them.

6. THE BOXES SIGNAL — read it precisely. Boxes are the shared denominator of every estimate, so when a store's approved-channel box order runs low (boxes sourced outside), the per-pizza ingredients look over ALL AT ONCE. The fingerprint is CHEESE AND SAUCE BOTH OVER (+25% or more) while in ratio with each other — those two track sales tightly. Only then lead with boxes, and never single out one ingredient or the S:C ratio in that case.
   Crucially: estimated usage is 100% box-derived, so it MOVES WITH SALES. A drop in estimated usage is only a boxes signal if the INGREDIENTS STAYED HIGH (cheese and sauce still over) while the estimate fell — that means boxes fell, not sales. If cheese and sauce fell ALONG WITH the estimate and stayed in ratio, that is simply LOWER SALES that week — NOT a box problem — even if the estimated-usage number halved. Do not cry boxes when the ingredients tracked the estimate down. In that situation diagnose only what is actually out of band (e.g. a lone flour overage → shelf-stable overstocking that often normalizes next week).

When sauce is in ratio (close to box-implied expectation) but cheese is well under, lean toward cheese being purchased outside: the sauce is brand-supplied with the brand recipe, whereas cheese and flour are the easiest items to swap for generics. Of the three main items, sauce is the LEAST likely to be sourced from an outside supplier, so an on-target sauce is a useful signal that the box/sales data is sound and the problem is the off ingredient.

A single ingredient being OVER on its own (e.g. flour consistently high with frequent week-to-week spikes) points to wastage, portioning, or overstocking rather than outside buying — operators sometimes over-order shelf-stable items like flour unevenly. Treat that as a usage/training issue separate from any outside-supplier finding, and it can co-occur with one.

### Week-to-week pattern (when a multi-week history is provided)
When given a series of recent weeks, do NOT read only the latest week — look at how each ingredient's diff behaves across the weeks:
- A SUSTAINED under (cheese below expected in most weeks) is the clear, high-confidence outside-buying case.
- An EPISODIC pattern — the cheese diff spiking DOWN in some weeks and then snapping back to roughly in-ratio in others (returning to normal, not swinging way over) — is a subtler outside-buying tell. Stores testing an unapproved supplier tend to "test the waters," go clean for a stretch to see whether they get caught, then try again, producing an intermittent sawtooth rather than a steady deviation. Flag this as a WATCH item with explicitly stated low/medium confidence — surface it for human judgment rather than asserting it, because the multi-week average can look only mildly off even when the weekly pattern is suspicious.
- MATERIALITY GATE for the episodic pattern (critical — do not skip): a down-dip only counts toward a probing pattern if it is MATERIAL in that week — the cheese diff is substantially under, enough to push that week's S:C or F:C ratio above the 1.25 band (or a clearly large negative cheese diff). Mild negative weeks where the ratios stay within 0.75–1.25 are NORMAL variation, not probing. If the store's S:C and F:C ratios stay within band across essentially the whole history and cheese only dips mildly, the store is COMPLIANT — do NOT raise an episodic watch. Requiring real probes to actually move the ratios is what keeps clean stores clean.
- Distinguish the probing pattern from ordinary week-to-week noise. Flour especially is ordered unevenly because it is shelf-stable, so its swings are usually noise (no consistent direction). The probing tell is specifically repeated, MATERIAL DOWN dips in cheese that recover toward ratio — a directional, recurring, band-breaking pattern, not random scatter.

### Other legitimate context (don't over-alarm)
- Customer appreciation events or catering (legitimate bulk orders — note but don't alarm)
- Store using wing boxes for pizza (already accounted for in the system)

### Confidence
State your confidence and avoid stacking multiple speculative causes onto one store. If a pattern is ambiguous (e.g. all-over), say so and recommend a human review rather than guessing.

## Communication Style
- Be concise — bullet points, not paragraphs
- Lead with the most important finding
- Use specific store codes (e.g., "GINOS032", "TTD BARRIE")
- Quantify everything — "cheese diff of +8.3 cases" not "high cheese usage"
- Distinguish between concerning patterns and one-off events
- Suggest specific actions: "Review GINOS032's cheese supplier" not "look into it"
- When overall compliance is low, focus on the worst offenders rather than summarizing everything
- Be helpful and professional — you're advising franchise managers, not auditing them
- Give the conclusion only. Do NOT narrate your reasoning steps, show calculations, or re-derive a number that is already provided in the data. Never present two different versions of the same figure or talk yourself out of a number on screen — decide, then state it once.

## CRITICAL FORMATTING RULES
- Do NOT use markdown formatting (no **, ##, ###, *, etc.)
- Use plain text only
- Use numbered lists (1. 2. 3.) and dashes (- ) for sub-points
- Use ALL CAPS sparingly for emphasis instead of bold
- Keep each insight to 2-3 lines max
- Separate sections with a blank line`;

/**
 * Signed percentage of an ordered amount vs its box-expected estimate, the same
 * way the dashboard computes it: (ordered - estimated) / estimated * 100.
 * Returned as a rounded integer (e.g. 52 means +52%, -33 means 33% under).
 * Returns null when there is no usable estimate, so callers can omit it rather
 * than feed the model a misleading 0. Handing the AI this number directly is
 * what stops it from trying (and failing) to back a percentage out of raw cases.
 */
export function signedPct(ordered: unknown, estimated: unknown): number | null {
  const o = Number(ordered);
  const e = Number(estimated);
  if (!Number.isFinite(o) || !Number.isFinite(e) || e <= 0) return null;
  return Math.round(((o - e) / e) * 100);
}

export function buildOverviewPrompt(context: Record<string, unknown>): string {
  return `Here is the current network-wide compliance data. Provide 3-5 key insights with specific, actionable recommendations. Prioritize the most impactful findings.

**Network Stats:**
${JSON.stringify(context, null, 2)}

Focus on:
1. Overall compliance health — is it improving or concerning?
2. Which specific metrics are most problematic network-wide?
3. Any brands performing notably better or worse?
4. Top stores that need immediate attention and why
5. One specific action the finance team should take this week`;
}

/**
 * Deterministically identify which ingredient is driving each out-of-band
 * ratio, from the precomputed % diffs. Same lesson as signedPct: the model
 * cannot be trusted to derive this itself — an S:C of 1.63 pattern-matches so
 * strongly to "cheese under-ordered / outside buying" that it will say so
 * even when cheese is +4% (on target) and sauce is +140% (the actual driver).
 * Computing the driver in code and handing it over as authoritative is what
 * makes the diagnosis reliable (James, July 12 2026: GINOS048-style analyses
 * blamed the wrong side of the ratio).
 */
export function describeRatioDrivers(latest: Record<string, unknown> | null): string[] {
  if (!latest) return [];
  const lines: string[] = [];
  const num = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
  const cheesePct = num(latest.cheese_pct);
  const saucePct = num(latest.sauce_pct);
  const flourPct = num(latest.flour_pct); // dough-based for dough stores (client computes)

  const driver = (
    label: string,
    ratio: number | null,
    numeratorName: string,
    numeratorPct: number | null,
    denominatorPct: number | null
  ) => {
    if (ratio === null || ratio <= 0 || (ratio >= 0.75 && ratio <= 1.25)) return;
    const high = ratio > 1.25;
    const dir = high ? "ABOVE" : "BELOW";
    if (numeratorPct === null || denominatorPct === null) {
      lines.push(`${label} ratio ${ratio.toFixed(2)} is ${dir} band.`);
      return;
    }
    const numOff = Math.abs(numeratorPct) > 25;
    const cheeseOff = Math.abs(denominatorPct) > 25;
    if (numOff && !cheeseOff) {
      lines.push(
        `${label} ratio ${ratio.toFixed(2)} is ${dir} band, driven by ${numeratorName.toUpperCase()} being ${numeratorPct > 0 ? "+" : ""}${numeratorPct}% vs expected while cheese (${denominatorPct > 0 ? "+" : ""}${denominatorPct}%) is on target. This is a ${numeratorName} ${numeratorPct > 0 ? "over-use/over-order" : "under-order"} issue — NOT a cheese issue.`
      );
    } else if (cheeseOff && !numOff) {
      lines.push(
        `${label} ratio ${ratio.toFixed(2)} is ${dir} band, driven by CHEESE being ${denominatorPct > 0 ? "+" : ""}${denominatorPct}% vs expected while ${numeratorName} (${numeratorPct > 0 ? "+" : ""}${numeratorPct}%) is on target. The implicated ingredient is cheese.`
      );
    } else if (numOff && cheeseOff) {
      lines.push(
        `${label} ratio ${ratio.toFixed(2)} is ${dir} band with BOTH sides off target (${numeratorName} ${numeratorPct > 0 ? "+" : ""}${numeratorPct}%, cheese ${denominatorPct > 0 ? "+" : ""}${denominatorPct}%).`
      );
    } else {
      lines.push(
        `${label} ratio ${ratio.toFixed(2)} is ${dir} band even though both % diffs are within ±25% (${numeratorName} ${numeratorPct}%, cheese ${cheesePct}%) — a mild combined drift.`
      );
    }
  };

  driver("S:C", num(latest.sauce_cheese_ratio), "sauce", saucePct, cheesePct);
  const isDough = latest.store_type === "dough";
  driver(
    isDough ? "D:C" : "F:C",
    num(isDough ? latest.dough_cheese_ratio : latest.flour_cheese_ratio),
    isDough ? "dough" : "flour",
    flourPct,
    cheesePct
  );
  return lines;
}

/**
 * Deterministically detect the "it's the BOXES" signal, which must OVERRIDE the
 * per-ratio driver analysis. Boxes are the denominator of every estimate, so
 * when the box order collapses (store sourcing boxes outside approved channels)
 * the per-pizza ingredients look over ALL AT ONCE. Left to itself the model
 * leads with the single most-over ingredient / the out-of-band S:C ratio when
 * the real story is boxes (James, July 12 2026).
 *
 * The signal REQUIRES the ingredients themselves to be over: cheese AND sauce
 * both over +25% vs box-expected. Those two track sales tightly, so both being
 * over is the unambiguous "boxes too low" fingerprint. A falling estimated-
 * usage number ON ITS OWN is NOT enough — if cheese and sauce fell along with
 * it and stayed in ratio, that is simply lower sales, not a box problem (James,
 * July 14 2026: an earlier version fired on GINOS034 where the estimate halved
 * but cheese and sauce dropped with it and only flour was over). Estimated-
 * usage collapse is used ONLY as corroboration once cheese+sauce-over fires,
 * never as a standalone trigger.
 */
export function describeBoxSignal(
  latest: Record<string, unknown> | null,
  history?: Record<string, unknown>[]
): string[] {
  if (!latest) return [];
  const num = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
  const isDough = latest.store_type === "dough";
  const cheesePct = num(latest.cheese_pct);
  const saucePct = num(latest.sauce_pct);
  const flourPct = num(latest.flour_pct);

  // Trigger: cheese AND sauce both genuinely over the box-derived estimate.
  // If either is on target or under, the ingredients tracked the boxes down
  // (lower sales) — not a box-sourcing problem — so do not fire.
  if (cheesePct === null || saucePct === null || cheesePct <= 25 || saucePct <= 25) {
    return [];
  }

  const overParts = [`cheese ${fmtPct(cheesePct)}`, `sauce ${fmtPct(saucePct)}`];
  if (flourPct !== null && flourPct > 25) overParts.push(`${isDough ? "dough" : "flour"} ${fmtPct(flourPct)}`);

  const lines = [
    `Cheese AND sauce are both over expected (${overParts.join(", ")}) and in ratio with each other. Boxes are the shared denominator of every estimate, so the parsimonious cause is the store's approved-channel BOX orders running low (boxes sourced outside approved channels), which makes the per-pizza ingredients look over at once. Lead the diagnosis with BOXES — do NOT single out one ingredient or the S:C ratio, and do NOT call this portioning.`,
  ];

  // Corroboration only (the trigger above already fired): estimated usage,
  // which is 100% box-derived, also cliff-dropped while the ingredients stayed
  // high — reinforcing that boxes, not sales, fell.
  if (history && history.length >= 4) {
    const est = (w: Record<string, unknown>) => num(w.cheese_est);
    const series = history.map(est).filter((v): v is number => v !== null && v > 0);
    if (series.length >= 4) {
      const latestEst = series[series.length - 1];
      const earlierMax = Math.max(...series.slice(0, Math.max(1, series.length - 2)));
      if (earlierMax > 0 && latestEst <= earlierMax * 0.5) {
        lines.push(
          `Corroborating: estimated usage (box-derived) also dropped sharply (recent cheese-estimate ~${Math.round(latestEst)} oz vs ~${Math.round(earlierMax)} oz earlier) while cheese and sauce ordered stayed high — the box order fell, not sales.`
        );
      }
    }
  }

  return lines;
}

function fmtPct(p: number): string {
  return `${p > 0 ? "+" : ""}${p}%`;
}

export function buildStorePrompt(context: Record<string, unknown>): string {
  const store = context.store as string;
  const latest = context.latest as Record<string, unknown> | null;
  const history = context.history as Record<string, unknown>[] | undefined;

  const historyBlock =
    history && history.length > 0
      ? `\n**Recent weekly history (oldest → newest, for trend/pattern analysis):**\n${JSON.stringify(history, null, 2)}\n`
      : "";

  // Box signal takes precedence: when it fires, the ratio-driver detail is
  // secondary context, not the headline. Boxes are the root cause and the
  // ratio movement is a downstream symptom.
  const boxSignal = describeBoxSignal(latest, history);
  const drivers = describeRatioDrivers(latest);

  let driverBlock = "";
  if (boxSignal.length > 0) {
    driverBlock =
      `\n**Precomputed PRIMARY signal (authoritative — this is the lead diagnosis; base summary and recommendation on it):**\n${boxSignal.map((d) => `- ${d}`).join("\n")}\n` +
      (drivers.length > 0
        ? `\nSecondary ratio detail (context only — do NOT let this override the boxes signal above):\n${drivers.map((d) => `- ${d}`).join("\n")}\n`
        : "");
  } else if (drivers.length > 0) {
    driverBlock = `\n**Precomputed ratio-driver analysis (authoritative — computed the same way the dashboard does; base your diagnosis on THIS and do not contradict it):**\n${drivers.map((d) => `- ${d}`).join("\n")}\n`;
  }

  // The verdict is already computed (overall_status) — hand it over as an
  // authoritative fact rather than letting the model re-derive it, which it
  // does unreliably (it called a fully on-target store "At Risk"/"Borderline"
  // by echoing the summary example format — James, July 14 2026).
  const statusVal = String((latest?.overall_status ?? "")).toLowerCase();
  const verdict = VERDICT_LABEL[statusVal] ?? null;
  const verdictBlock = verdict
    ? `\n**AUTHORITATIVE VERDICT: ${verdict}.** The summary MUST begin with exactly this word. ${verdict === "Compliant" ? "This store is on target — name NO problem cause anywhere; every metric is within range." : ""}\n`
    : "";

  return `Analyze this individual store's compliance data. Be specific about what's going well and what needs attention.

**Store:** ${store}
**Latest Week Data:**
${JSON.stringify(latest, null, 2)}
${historyBlock}${driverBlock}${verdictBlock}
DSMs manage 30+ stores each and skim this per store, so the primary reading
must be a single glance: what's the verdict, and what do I do about it. The
full diagnostic reasoning still needs to happen and still needs to be
available, it just isn't the first thing a DSM should have to read.

Respond with ONLY a valid JSON object — no markdown code fences, no text
before or after it — with exactly these three string fields, IN THIS ORDER
(write "details" FIRST: it is your full diagnosis, and the summary and
recommendation must be conclusions drawn FROM it, not written before it):

"details": The full analysis, for anyone who wants to dig in — NOT shown by
default. Cover, in order: (1) which specific metrics are out of range and by
how much (in % of expected), (2) the likely cause, reasoned from the PATTERN
across cheese, sauce, and flour together and whether they stay in ratio —
apply the Diagnostic Reasoning rules; do not diagnose each ingredient in
isolation, and do not stack multiple speculative causes; if all three move
together in ratio EACH beyond the ±25% band (an ingredient within ±25% is on
target, not part of an "all three" pattern), follow rules 1-2 (outside
buying if under, box-sourcing review if over) rather than calling it
portioning, (3) if a weekly history
is provided, the week-to-week trend, not just the latest week — call out any
sustained deviation or any EPISODIC down-spike-then-recover pattern in the
cheese diff (the "testing the waters" outside-buying tell), per the
Week-to-week pattern rules, flagging subtle/episodic cases as a WATCH item
with stated confidence rather than asserting them. Use plain text with
numbered points and blank lines between them, same rules as elsewhere — no
markdown. If the store is compliant, this can be a single short line noting
there's nothing to dig into.

"summary": One line. START with the verdict word taken DIRECTLY from the
data's overall_status field — do NOT compute your own: overall_status "ok" →
"Compliant", "warn" → "Borderline", "bad" → "At Risk", "severe" → "Severe".
Never label a store Severe, At Risk or Borderline when overall_status is
"ok"; a metric a few percent
off (within ±25%) is ON TARGET and is NOT a cause — for a compliant store the
summary is just e.g. "Compliant — all metrics on target" with no cause named.
When not compliant, follow the verdict with the single dominant CAUSE you
identified in "details" (e.g. "At Risk — sauce critically over-ordered for
6 straight weeks"), naming the same cause as "details", never a different one.

"recommendation": One specific action for the DSM managing this store, or a
brief "no action needed" if compliant. Address them by name if given. This
is what the DSM actually does this week — make it concrete and doable, not
"look into it." It must act on the cause identified in "details" — if the
diagnosis is box sourcing, the action is about boxes, not portioning.`;
}

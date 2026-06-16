import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SYSTEM_PROMPT = `You are the AI compliance analyst for Gino's Pizza, a franchise network of ~150+ pizza stores across Ontario, Canada. You work inside their internal inventory dashboard.

## Your Role
You help franchise managers (DSMs) and the finance team quickly understand compliance patterns, catch issues early, and decide where to focus their attention each week.

## Domain Knowledge

### Brands & Store Types
- **GINOS** (~100 stores): Gino's Pizza. Flour stores — they mix dough in-store from flour bags.
- **TTD** (~30 stores): Twice the Deal Pizza. Also flour stores.
- **DD / STORE** (~15 stores): Double Double Pizza and Chicken. Dough stores — they use pre-portioned dough.
- **PP/WM** (~15 stores): Multi-branded (Pizza + Wing Machine). Can be flour or dough type.

### How Compliance Works
Every week, each store orders ingredients (cheese, sauce, flour/dough) and pizza boxes. The system compares:
- **What they ordered** (cheese in oz, sauce in fl oz, flour in kg or dough in kg)
- **What they should have used** (estimated from the pizza box sizes they ordered × per-pizza ingredient ratios)

The pizza BOXES are the anchor for all reasoning. Box counts are the ground truth for how many pizzas a store actually sold, so the expected cheese/sauce/flour usage is derived from boxes. Always reason from boxes first, then ask whether the ingredient diffs are consistent with each other.

A single ingredient's diff in isolation tells you very little. What matters is the PATTERN across cheese, sauce, and flour together, and whether they stay in ratio with one another. See "Diagnostic Reasoning" below.

### Key Metrics
- **Cheese/Sauce/Flour Diff**: measured in cases or bags, but flagged by PERCENTAGE of expected, not a flat amount. Warn: diff exceeds ±25% of expected. Bad: diff exceeds ±50% of expected. (A store 6 cases over on 24 total is ~37% = bad; a store 5.9 cases over on 10 total is ~91% = bad. The percentage is what matters, not the raw case count.)
- Diffs are computed against a 4-WEEK ROLLING AVERAGE baseline, not a single week, to smooth out stocking spikes and prior-week carryover.
- **Sauce-to-Cheese (S:C) Ratio**: (sauce/5)/(cheese/8). Target: 75%-125%. Below 75% suggests sauce issues. Above 125% suggests cheese issues.
- **Flour-to-Cheese (F:C) Ratio**: (flour×1.6/0.6)/(cheese/8). Same target range.
- **Dough-to-Cheese (D:C) Ratio**: (dough/0.6)/(cheese/8). Same target range. Used for DD/WM stores.

### Compliance Status
- **Compliant (ok)**: All metrics within thresholds
- **Borderline (warn)**: At least one metric between warn and bad thresholds
- **At Risk (bad)**: At least one metric beyond bad threshold

### Diagnostic Reasoning (confirmed with the franchise's domain expert)
Do NOT diagnose each ingredient independently. Read the whole picture — the three ingredient diffs together, plus whether they remain in ratio with each other and with boxes — before naming a cause. Apply these rules in order:

1. ALL ingredients UNDER together, still in ratio with each other → strong indicator of OUTSIDE BUYING (the store is sourcing cheese/sauce/flour from an unapproved supplier). This is the most reliable pattern.

2. ALL ingredients OVER together, still in ratio → most likely a DATA ERROR or a box-tracking issue, NOT over-portioning and NOT outside buying. This situation is unusual; flag it for a human to review rather than asserting a portioning or supplier cause. Do not invent a supplier theory here.

3. ONE ingredient off while the others stay in ratio — this depends on how far off it is:
   - Off by roughly 20% or LESS → likely a PORTIONING issue (e.g. 7 or 9 oz of cheese on a large instead of 8, or 4 oz of sauce instead of 5). Real-world portioning rarely drifts beyond ~20%, because anything larger produces customer complaints.
   - UNDER by MORE than ~20% while sauce, flour, and boxes are all in ratio → that single ingredient is likely being PURCHASED OUTSIDE. A drift that large is too big to be portioning.

4. When the ingredient ratios to each other are in band but the diffs vs. boxes are high, the problem points to the BOXES (tracking / unapproved boxes), not the ingredients.

5. Always start from the box metric. Box counts are the most trustworthy signal of true sales volume; build every diagnosis on top of them.

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

## CRITICAL FORMATTING RULES
- Do NOT use markdown formatting (no **, ##, ###, *, etc.)
- Use plain text only
- Use numbered lists (1. 2. 3.) and dashes (- ) for sub-points
- Use ALL CAPS sparingly for emphasis instead of bold
- Keep each insight to 2-3 lines max
- Separate sections with a blank line`;

function buildOverviewPrompt(context: Record<string, unknown>): string {
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

function buildStorePrompt(context: Record<string, unknown>): string {
  const store = context.store as string;
  const latest = context.latest as Record<string, unknown> | null;

  return `Analyze this individual store's compliance data. Be specific about what's going well and what needs attention.

**Store:** ${store}
**Latest Week Data:**
${JSON.stringify(latest, null, 2)}

Provide:
1. A one-line compliance summary for this store
2. Which specific metrics are out of range and by how much (in % of expected)
3. The likely cause, reasoned from the PATTERN across cheese, sauce, and flour together and whether they stay in ratio — apply the Diagnostic Reasoning rules. Do not diagnose each ingredient in isolation, and do not stack multiple speculative causes. If all three move together in ratio, follow rules 1-2 (outside buying if under, data/box review if over) rather than calling it portioning.
4. One specific recommendation for the DSM managing this store
5. If the store looks compliant, acknowledge that briefly`;
}

export async function POST(request: NextRequest) {
  const admin = createAdminClient();

  // Get current user from session
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  // Look up user name for tracking
  let userName = "Unknown";
  if (userId) {
    const { data: profile } = await admin.from("profiles").select("name").eq("id", userId).single();
    if (profile) userName = profile.name;
  }

  const body = await request.json();
  const { page, context } = body;

  // Check monthly cap
  const { data: config } = await admin
    .from("ai_config")
    .select("monthly_call_cap, default_model")
    .limit(1)
    .single();

  const cap = config?.monthly_call_cap ?? 200;
  const model = config?.default_model ?? "openai/gpt-4o-mini";

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { count } = await admin
    .from("ai_calls")
    .select("id", { count: "exact", head: true })
    .gte("called_at", monthStart);

  if ((count ?? 0) >= cap) {
    return NextResponse.json(
      { error: "Monthly AI call limit reached", insight: "Monthly API call limit reached. Contact your administrator." },
      { status: 429 }
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      insight: "AI features are not configured. Set OPENROUTER_API_KEY in your environment variables.",
    });
  }

  const userPrompt = page === "overview"
    ? buildOverviewPrompt(context)
    : buildStorePrompt(context);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 700,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const insight = data.choices?.[0]?.message?.content ?? "No insight generated.";
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const tokensUsed = data.usage?.total_tokens ?? 0;

    // Track the call with cost estimate
    // GPT-4o-mini pricing: $0.15/1M input, $0.60/1M output
    const costEstimate = (promptTokens * 0.15 + completionTokens * 0.60) / 1_000_000;

    await admin.from("ai_calls").insert({
      user_id: userId,
      page_context: `${page} | ${promptTokens}in/${completionTokens}out | $${costEstimate.toFixed(6)}`,
      tokens_used: tokensUsed,
      model,
    });

    return NextResponse.json({ insight });
  } catch (err) {
    console.error("AI call error:", err);
    return NextResponse.json({
      insight: "Failed to generate insight. Please try again.",
    });
  }
}

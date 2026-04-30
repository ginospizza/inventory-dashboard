import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/ai
 *
 * Generate AI insights via OpenRouter.
 * Enforces monthly call cap and tracks usage.
 */
export async function POST(request: NextRequest) {
  const supabase = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { page, context } = body;

  const admin = createAdminClient();

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

  // Build prompt
  const systemPrompt = `You are an AI assistant for Gino's Pizza franchise compliance dashboard.
You analyze weekly ingredient ordering data for ~150 franchise stores.

Key metrics you evaluate:
- Cheese, Sauce, Flour differences: ordered vs expected (based on pizza box orders). Threshold: ±6 cases/bags.
- Sauce-to-Cheese ratio: target 75-125%
- Flour-to-Cheese ratio: target 75-125%

When differences are positive, stores are over-ordering (possible over-portioning or unapproved boxes).
When negative, stores may be under-portioning or using unapproved suppliers.

Be concise, specific, and actionable. Use store codes when available. Focus on the most impactful findings.`;

  const userPrompt = page === "overview"
    ? `Analyze this network overview data and provide 3-4 key insights with specific recommendations:\n\n${JSON.stringify(context, null, 2)}`
    : `Analyze this store's compliance data and provide specific observations:\n\n${JSON.stringify(context, null, 2)}`;

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        insight: "AI features are not configured. Set OPENROUTER_API_KEY in your environment variables.",
      });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const insight = data.choices?.[0]?.message?.content ?? "No insight generated.";
    const tokensUsed = data.usage?.total_tokens ?? 0;

    // Track the call
    await admin.from("ai_calls").insert({
      user_id: user.id,
      page_context: page,
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

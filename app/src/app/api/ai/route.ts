import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildOverviewPrompt, buildStorePrompt, SYSTEM_PROMPT } from "@/lib/ai/prompts";

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

  const isStorePage = page !== "overview";
  const userPrompt = isStorePage ? buildStorePrompt(context) : buildOverviewPrompt(context);

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
        max_tokens: 1500,
        temperature: 0.3,
        // Store-level analysis is structured (summary/recommendation surfaced
        // to the DSM by default, full reasoning collapsed) -- see
        // buildStorePrompt. Overview stays free-text for the finance view.
        ...(isStorePage ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    const data = await response.json();
    const rawContent: string = data.choices?.[0]?.message?.content ?? "";
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

    if (!isStorePage) {
      return NextResponse.json({ insight: rawContent || "No insight generated." });
    }

    // Parse the structured store insight. Fall back to dumping the raw text
    // into `summary` if the model didn't return valid JSON, so the UI still
    // shows something instead of breaking.
    try {
      const parsed = JSON.parse(rawContent);
      return NextResponse.json({
        summary: parsed.summary ?? "No summary generated.",
        recommendation: parsed.recommendation ?? "",
        details: parsed.details ?? "",
      });
    } catch {
      return NextResponse.json({
        summary: rawContent || "No insight generated.",
        recommendation: "",
        details: "",
      });
    }
  } catch (err) {
    console.error("AI call error:", err);
    return NextResponse.json({
      insight: "Failed to generate insight. Please try again.",
      summary: "Failed to generate insight. Please try again.",
      recommendation: "",
      details: "",
    });
  }
}

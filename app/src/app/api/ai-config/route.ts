import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdminApi } from "@/lib/supabase/auth";

/**
 * Super-admin control of AI Insights access (James + Raj, July 31 2026):
 * turn AI on/off for DSMs at any time — all of them, or a selected pilot
 * group — without a deploy. Super admins always retain access themselves.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.error) return auth.error;
  const admin = createAdminClient();

  const { dsm_access_mode, allowed_dsm_ids } = await request.json();

  if (!["none", "all", "selected"].includes(dsm_access_mode)) {
    return NextResponse.json(
      { error: "dsm_access_mode must be 'none', 'all' or 'selected'" },
      { status: 400 }
    );
  }
  if (
    dsm_access_mode === "selected" &&
    (!Array.isArray(allowed_dsm_ids) || allowed_dsm_ids.length === 0)
  ) {
    return NextResponse.json(
      { error: "Select at least one DSM, or choose 'none'" },
      { status: 400 }
    );
  }

  // Single-row config table — update the one row rather than trusting an id
  // from the client.
  const { data: existing } = await admin.from("ai_config").select("id").limit(1).single();
  if (!existing) {
    return NextResponse.json({ error: "ai_config row missing" }, { status: 500 });
  }

  const { error } = await admin
    .from("ai_config")
    .update({
      dsm_access_mode,
      allowed_dsm_ids: dsm_access_mode === "selected" ? allowed_dsm_ids : [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

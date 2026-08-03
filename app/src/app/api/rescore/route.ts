import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminApi } from "@/lib/supabase/auth";
import { reloadEngineConfig } from "@/lib/calculations/config-loader";
import { runRescore } from "@/lib/rescore";

// A full re-score reads ~13k rows and can write thousands — allow the route
// time to finish (writes are batched 500/request, so this is generous).
export const maxDuration = 300;

/**
 * Re-grade every stored status against the current thresholds (James, July 31
 * 2026 — after editing thresholds in the admin panel, history is stale until
 * this runs).
 *
 * Body: { apply: boolean } — apply=false returns the would-be transition
 * summary without writing, and the admin UI shows that preview before letting
 * the real thing run. Same recompute as scripts/rescore-metrics.ts; both call
 * recomputeRollingStatuses, the single source of truth.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.error) return auth.error;

  const { apply } = (await request.json()) as { apply?: boolean };

  // Always grade with a fresh config read — this route usually runs right
  // after a threshold edit.
  await reloadEngineConfig();

  try {
    const result = await runRescore(apply === true);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("rescore failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/metrics
 *
 * Fetch weekly metrics with optional filters.
 * RLS handles store-level access control automatically.
 *
 * Query params:
 *   week    — filter by week number
 *   year    — filter by year (defaults to current)
 *   brand   — filter by brand prefix
 *   dsm     — filter by DSM id (admin only, DSMs are auto-filtered by RLS)
 *   status  — filter by overall_status (ok|warn|bad)
 *   store   — filter by store_id
 *   limit   — max rows (default 500)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const week = params.get("week");
  const year = params.get("year") ?? String(new Date().getFullYear());
  const brand = params.get("brand");
  const dsm = params.get("dsm");
  const status = params.get("status");
  const storeId = params.get("store");
  const limit = Number(params.get("limit") ?? 500);

  // Build query — join with stores for brand/dsm filtering
  let query = supabase
    .from("weekly_metrics")
    .select(`
      *,
      stores!inner (
        id,
        code,
        name,
        brand,
        city,
        dsm_id,
        dsms (
          id,
          name,
          region
        )
      )
    `)
    .eq("year", Number(year))
    .order("week_number", { ascending: false })
    .limit(limit);

  if (week) {
    query = query.eq("week_number", Number(week));
  }

  if (brand && brand !== "all") {
    query = query.eq("stores.brand", brand);
  }

  if (dsm && dsm !== "all") {
    query = query.eq("stores.dsm_id", dsm);
  }

  if (status && status !== "all") {
    query = query.eq("overall_status", status);
  }

  if (storeId) {
    query = query.eq("store_id", storeId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

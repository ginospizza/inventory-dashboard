import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/dsms — Create a new DSM district
 * Body: { name, region? }
 */
export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const { name, region } = await request.json();

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("dsms")
    .insert({ name, region: region || "Ontario" })
    .select("id, name")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, dsm: data });
}

/**
 * PUT /api/dsms — Rename a DSM district
 * Body: { id, name }
 */
export async function PUT(request: NextRequest) {
  const admin = createAdminClient();
  const { id, name } = await request.json();

  if (!id || !name) {
    return NextResponse.json({ error: "ID and name are required" }, { status: 400 });
  }

  const { error } = await admin.from("dsms").update({ name }).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/dsms — Reassign a store to a different DSM
 * Body: { store_id, dsm_id }
 */
export async function PATCH(request: NextRequest) {
  const admin = createAdminClient();
  const { store_id, dsm_id } = await request.json();

  if (!store_id) {
    return NextResponse.json({ error: "store_id is required" }, { status: 400 });
  }

  const { error } = await admin
    .from("stores")
    .update({ dsm_id: dsm_id || null })
    .eq("id", store_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

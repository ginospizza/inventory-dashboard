import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createAuthClient } from "@supabase/supabase-js";

/**
 * POST /api/users — Create a new user (admin only)
 * Body: { email, name, role, dsm_id, password }
 */
export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const body = await request.json();
  const { email, name, role, dsm_id, password } = body;

  if (!email || !name || !role || !password) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (role !== "super_admin" && role !== "dsm") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  if (role === "dsm" && !dsm_id) {
    return NextResponse.json({ error: "DSM role requires a DSM assignment" }, { status: 400 });
  }

  try {
    // Create auth user via Supabase Admin API
    const authAdmin = createAuthClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: authData, error: authError } = await authAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    // Create profile
    const { error: profileError } = await admin.from("profiles").insert({
      id: authData.user.id,
      email,
      name,
      role,
      dsm_id: role === "dsm" ? dsm_id : null,
    });

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, user_id: authData.user.id });
  } catch (err) {
    console.error("Create user error:", err);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

/**
 * DELETE /api/users — Delete a user (admin only)
 * Body: { user_id }
 */
export async function DELETE(request: NextRequest) {
  const admin = createAdminClient();
  const body = await request.json();
  const { user_id } = body;

  if (!user_id) {
    return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
  }

  try {
    // Delete profile first
    await admin.from("profiles").delete().eq("id", user_id);

    // Delete auth user
    const authAdmin = createAuthClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { error } = await authAdmin.auth.admin.deleteUser(user_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete user error:", err);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "./server";
import { createAdminClient } from "./admin";
import type { AppUser } from "@/lib/types";

/**
 * Get the current authenticated user with their profile data.
 * Returns null if not authenticated.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Use admin client to bypass RLS for profile read
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Auto-create profile if authenticated but missing
    const { data: newProfile } = await admin
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email!,
        name: user.user_metadata?.name || user.email!.split("@")[0],
        role: "super_admin",
      }, { onConflict: "id" })
      .select()
      .single();

    if (!newProfile) return null;

    return {
      id: newProfile.id,
      email: newProfile.email,
      name: newProfile.name,
      role: newProfile.role,
      dsm_id: newProfile.dsm_id,
      last_login_at: newProfile.last_login_at,
    };
  }

  // Update last login (non-blocking, fire-and-forget)
  void admin
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id)
    .then(() => {});

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    dsm_id: profile.dsm_id,
    last_login_at: profile.last_login_at,
  };
}

/**
 * Check if the current user is a super admin.
 */
export async function requireAdmin(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  if (user.role !== "super_admin") throw new Error("Forbidden: admin access required");
  return user;
}

/**
 * Get the DSM ID filter for the current user.
 * Returns null for admins (no filter), or the DSM ID for DSM users.
 */
export async function getDsmFilter(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  if (user.role === "super_admin") return null;
  return user.dsm_id;
}

/**
 * API-route auth guard: verify the caller is an authenticated super_admin.
 *
 * MUST be used instead of hand-rolling `createAdminClient().auth.getUser()` —
 * the admin client holds the service-role key and has no session, so calling
 * .auth.getUser() on it always returns no user regardless of who's logged in
 * in the browser (this broke /api/upload's auth check until fixed). Session
 * state only exists on the cookie-based client from ./server, which is what
 * getCurrentUser() (used here) reads from.
 *
 * Usage: `const auth = await requireSuperAdminApi(); if (auth.error) return auth.error;`
 */
export async function requireSuperAdminApi(): Promise<
  { user: AppUser; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (user.role !== "super_admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

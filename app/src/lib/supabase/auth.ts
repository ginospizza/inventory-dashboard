import { createClient } from "./server";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  // Update last login
  await supabase
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id);

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

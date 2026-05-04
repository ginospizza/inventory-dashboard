import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@supabase/supabase-js";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin") redirect("/overview");

  const supabase = createAdminClient();

  // Fetch auth users to sync missing profiles
  const authAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: authUsers } = await authAdmin.auth.admin.listUsers();

  // Check for auth users missing profiles and auto-create them
  const { data: existingProfiles } = await supabase.from("profiles").select("id");
  const existingIds = new Set(existingProfiles?.map(p => p.id) ?? []);

  for (const authUser of authUsers?.users ?? []) {
    if (!existingIds.has(authUser.id)) {
      await supabase.from("profiles").insert({
        id: authUser.id,
        email: authUser.email!,
        name: authUser.user_metadata?.name || authUser.email!.split("@")[0],
        role: authUser.user_metadata?.role || "super_admin",
        dsm_id: null,
      });
    }
  }

  const [
    { data: dsmsData },
    { data: storesData },
    { data: productsData },
    { data: thresholdsData },
    { data: assumptionsData },
    { data: profilesData },
    { data: aiConfigData },
    { data: aiCallsData },
  ] = await Promise.all([
    supabase.from("dsms").select("*").order("name"),
    supabase.from("stores").select("*, dsms(name)").order("code"),
    supabase.from("products").select("*").order("type, description"),
    supabase.from("thresholds").select("*"),
    supabase.from("usage_assumptions").select("*").order("pizza_size"),
    supabase.from("profiles").select("*, dsms(name)").order("name"),
    supabase.from("ai_config").select("*").limit(1).single(),
    supabase.from("ai_calls").select("*, profiles(name)").order("called_at", { ascending: false }).limit(20),
  ]);

  return (
    <AdminClient
      dsms={dsmsData ?? []}
      stores={storesData ?? []}
      products={productsData ?? []}
      thresholds={thresholdsData ?? []}
      assumptions={assumptionsData ?? []}
      profiles={profilesData ?? []}
      aiConfig={aiConfigData ?? { monthly_call_cap: 200 }}
      aiCalls={aiCallsData ?? []}
    />
  );
}

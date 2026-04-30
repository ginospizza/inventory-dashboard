import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin") redirect("/overview");

  const supabase = createAdminClient();

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

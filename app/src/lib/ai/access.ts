/**
 * Who can use AI Insights (James + Raj, July 31 2026).
 *
 * They're rolling the app out to DSMs without AI, keeping it for admins, and
 * want to switch it on later — for everyone or for a pilot group of DSMs —
 * from the admin panel without a deploy. So access is data in ai_config:
 *
 *   dsm_access_mode  'none'      no DSM has AI (launch default)
 *                    'all'       every DSM has AI
 *                    'selected'  only DSMs in allowed_dsm_ids
 *
 * Super admins always have access: they need to see the feature to decide
 * whether to enable it for others.
 *
 * Server-only (reads via the service-role client). The UI hides buttons based
 * on this, and /api/ai enforces it — hiding a button is not access control.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { AppUser } from "@/lib/types";

export type DsmAccessMode = "none" | "all" | "selected";

export interface AiAccessConfig {
  dsm_access_mode: DsmAccessMode;
  allowed_dsm_ids: string[];
}

export async function getAiAccessConfig(): Promise<AiAccessConfig> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_config")
    .select("dsm_access_mode, allowed_dsm_ids")
    .limit(1)
    .single();
  return {
    dsm_access_mode: (data?.dsm_access_mode as DsmAccessMode) ?? "none",
    allowed_dsm_ids: (data?.allowed_dsm_ids as string[]) ?? [],
  };
}

/** Can this user use AI Insights right now? */
export async function hasAiAccess(user: AppUser): Promise<boolean> {
  if (user.role === "super_admin") return true;
  const config = await getAiAccessConfig();
  if (config.dsm_access_mode === "all") return true;
  if (config.dsm_access_mode === "selected") {
    return user.dsm_id !== null && config.allowed_dsm_ids.includes(user.dsm_id);
  }
  return false;
}

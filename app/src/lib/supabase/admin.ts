import { createClient } from "@supabase/supabase-js";

/**
 * Server-side admin client with service role key.
 * Used for operations that bypass RLS (upload pipeline, seeding, etc.)
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

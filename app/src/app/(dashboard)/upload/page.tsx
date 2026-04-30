import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getRecentUploads } from "@/lib/data-access";
import { UploadClient } from "./upload-client";

export default async function UploadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin") redirect("/overview");

  const recentUploads = await getRecentUploads(5);

  return <UploadClient recentUploads={recentUploads} />;
}

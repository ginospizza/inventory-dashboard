import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <Sidebar user={user} />
      <main className="min-w-0 flex flex-col" style={{ marginLeft: 232 }}>
        <Topbar user={user} />
        <div className="animate-fade-up" style={{ padding: "24px 28px 64px", maxWidth: 1640 }}>
          {children}
        </div>
      </main>
    </div>
  );
}

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
      <main className="min-w-0 flex flex-col lg:ml-[232px]">
        <Topbar user={user} />
        <div className="animate-fade-up px-4 py-5 pb-16 lg:px-7 lg:py-6 lg:pb-16" style={{ maxWidth: 1640 }}>
          {children}
        </div>
      </main>
    </div>
  );
}

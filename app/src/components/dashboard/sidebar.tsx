"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Store,
  Upload,
  Settings,
  LogOut,
  Lock,
  Menu,
  X,
} from "lucide-react";
import type { AppUser } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface SidebarProps {
  user: AppUser;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  adminOnly?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Analytics",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/stores", label: "All Stores", icon: Store },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/upload", label: "Upload Data", icon: Upload, adminOnly: true },
      { href: "/admin", label: "Admin Panel", icon: Settings, adminOnly: true },
    ],
  },
];

function SidebarContent({ user, onNavigate }: { user: AppUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const isDsm = user.role === "dsm";

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      {/* Brand */}
      <div className="flex items-center gap-[10px] px-[6px] pt-1 pb-[18px]">
        <Image
          src="/ginos-logo.png"
          alt="Gino's Pizza"
          width={42}
          height={42}
          className="rounded-[6px]"
        />
        <div className="leading-[1.05]">
          <div className="font-serif text-[22px]">Gino&apos;s</div>
          <div
            className="text-[10px] tracking-[.14em] uppercase"
            style={{ color: "#C9B68B" }}
          >
            Inventory
          </div>
        </div>
      </div>

      {/* Nav sections */}
      <nav className="flex flex-col gap-[2px] flex-1">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <div
              className="text-[10px] tracking-[.12em] uppercase px-2 pt-[14px] pb-[6px]"
              style={{ color: "#8A7C5F" }}
            >
              {section.label}
            </div>
            {section.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/overview" && pathname.startsWith(item.href));
              const isLocked = isDsm && item.adminOnly;
              const Icon = item.icon;

              if (isLocked) {
                return (
                  <div
                    key={item.href}
                    className="flex items-center gap-[10px] px-[10px] py-[9px] rounded-lg opacity-[.42] cursor-not-allowed"
                    style={{
                      fontSize: "13.5px",
                      fontWeight: 500,
                      letterSpacing: "-0.005em",
                      color: "#C9B68B",
                    }}
                  >
                    <Icon className="w-4 h-4 opacity-80" />
                    <span>{item.label}</span>
                    <Lock className="w-3 h-3 ml-auto opacity-60" />
                  </div>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className="flex items-center gap-[10px] px-[10px] py-[9px] rounded-lg transition-colors duration-100"
                  style={{
                    fontSize: "13.5px",
                    fontWeight: 500,
                    letterSpacing: "-0.005em",
                    color: isActive ? "white" : "#E0D5BD",
                    background: isActive ? "var(--color-ginos-red)" : "transparent",
                    boxShadow: isActive
                      ? "inset 0 0 0 1px rgba(255,255,255,.08), 0 4px 14px rgba(226,35,26,.35)"
                      : "none",
                  }}
                >
                  <Icon
                    className="w-4 h-4"
                    style={{ opacity: isActive ? 1 : 0.8 }}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div
        className="flex items-center gap-[10px] p-[10px] text-xs"
        style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}
      >
        <div className="w-[30px] h-[30px] rounded-full bg-ginos-red grid place-items-center text-white font-bold text-xs">
          {initials}
        </div>
        <div className="leading-[1.2] flex-1 min-w-0">
          <div className="font-semibold truncate" style={{ color: "#FBF8F2" }}>
            {user.name}
          </div>
          <div
            className="text-[10.5px] tracking-[.04em]"
            style={{ color: "#8A7C5F" }}
          >
            {user.role === "super_admin" ? "Super Admin" : "District Manager"}
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-7 h-7 grid place-items-center rounded-md hover:bg-white/5 transition-colors"
          style={{ color: "#8A7C5F" }}
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}

export function Sidebar({ user }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-screen w-[232px] flex-col z-10"
        style={{
          background: "linear-gradient(180deg, #1B1A17 0%, #2A211A 100%)",
          color: "#F4ECDD",
          padding: "20px 16px",
          gap: "6px",
        }}
      >
        <SidebarContent user={user} />
      </aside>

      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-[14px] left-[14px] z-30 w-[38px] h-[38px] grid place-items-center rounded-[9px]"
        style={{
          background: "linear-gradient(180deg, #1B1A17 0%, #2A211A 100%)",
          color: "#F4ECDD",
          boxShadow: "0 2px 8px rgba(0,0,0,.2)",
        }}
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside
            className="absolute top-0 left-0 h-full w-[280px] flex flex-col"
            style={{
              background: "linear-gradient(180deg, #1B1A17 0%, #2A211A 100%)",
              color: "#F4ECDD",
              padding: "20px 16px",
              gap: "6px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-[18px] right-[14px] w-8 h-8 grid place-items-center rounded-md hover:bg-white/5"
              style={{ color: "#8A7C5F" }}
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent user={user} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}

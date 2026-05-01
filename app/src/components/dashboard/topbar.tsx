"use client";

import { usePathname } from "next/navigation";
import { Search, Bell } from "lucide-react";
import type { AppUser } from "@/lib/types";

interface TopbarProps {
  user: AppUser;
}

const BREADCRUMB_MAP: Record<string, string> = {
  "/overview": "Overview",
  "/stores": "All Stores",
  "/compare": "Compare",
  "/upload": "Upload Data",
  "/admin": "Admin Panel",
};

export function Topbar({ user }: TopbarProps) {
  const pathname = usePathname();

  const currentPage =
    BREADCRUMB_MAP[pathname] ??
    (pathname.startsWith("/store/") ? "Store Detail" : "Dashboard");

  return (
    <header
      className="sticky top-0 z-5 flex items-center gap-[14px] px-4 py-3 lg:px-7 lg:py-[14px]"
      style={{
        background: "var(--color-paper)",
        borderBottom: "1px solid var(--color-line)",
      }}
    >
      {/* Spacer for mobile hamburger */}
      <div className="w-[38px] lg:hidden" />

      {/* Breadcrumb */}
      <div
        className="flex items-center gap-[6px] text-ink-3"
        style={{ fontSize: "12.5px" }}
      >
        <span className="hidden sm:inline">Dashboard</span>
        <span className="hidden sm:inline" style={{ color: "var(--color-ink-3)" }}>/</span>
        <span className="font-semibold text-ink">{currentPage}</span>
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-[10px]">
        {/* Search — hidden on mobile */}
        <div
          className="hidden md:flex items-center gap-2 px-[11px] py-[7px] bg-white rounded-full"
          style={{
            border: "1px solid var(--color-line)",
            fontSize: "12.5px",
            color: "var(--color-ink-2)",
          }}
        >
          <Search className="w-[14px] h-[14px]" />
          <input
            type="text"
            placeholder="Search stores..."
            className="border-0 outline-none bg-transparent text-inherit w-[180px]"
            style={{ font: "inherit" }}
          />
        </div>

        {/* Notifications */}
        <button
          className="relative w-[34px] h-[34px] grid place-items-center bg-white rounded-[9px]"
          style={{
            border: "1px solid var(--color-line)",
            color: "var(--color-ink-2)",
          }}
        >
          <Bell className="w-4 h-4" />
          <span
            className="absolute rounded-full bg-ginos-red"
            style={{
              top: "7px",
              right: "8px",
              width: "7px",
              height: "7px",
              border: "2px solid white",
            }}
          />
        </button>
      </div>
    </header>
  );
}

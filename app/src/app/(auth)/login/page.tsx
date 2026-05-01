"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const router = useRouter();

  const carouselItems = [
    {
      title: "Network Compliance",
      visual: (
        <div className="flex items-end gap-[6px] h-[120px] px-2">
          {[65, 42, 78, 55, 88, 70, 82, 60, 90, 75, 85, 68].map((h, i) => (
            <div key={i} className="flex-1 rounded-t-[3px] transition-all duration-700" style={{
              height: `${h}%`,
              background: h >= 75 ? "rgba(46,125,79,.7)" : h >= 50 ? "rgba(199,122,0,.6)" : "rgba(226,35,26,.6)",
              animationDelay: `${i * 80}ms`,
            }} />
          ))}
        </div>
      ),
      label: "Weekly store compliance rates across the network",
    },
    {
      title: "Ingredient Tracking",
      visual: (
        <div className="flex items-center gap-5 h-[120px] px-2">
          {[
            { name: "Cheese", pct: 87, color: "#E2231A" },
            { name: "Sauce", pct: 72, color: "#C77A00" },
            { name: "Flour", pct: 91, color: "#2E7D4F" },
          ].map((item) => (
            <div key={item.name} className="flex-1 flex flex-col items-center gap-2">
              <div className="relative w-[70px] h-[70px]">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke={item.color} strokeWidth="3"
                    strokeDasharray={`${item.pct * 0.88} 88`} strokeLinecap="round"
                    className="transition-all duration-1000" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-[13px] font-mono font-semibold" style={{ color: "#F4ECDD" }}>
                  {item.pct}%
                </div>
              </div>
              <div className="text-[11px]" style={{ color: "#8A7C5F" }}>{item.name}</div>
            </div>
          ))}
        </div>
      ),
      label: "Real-time ratio monitoring for key ingredients",
    },
    {
      title: "Store Performance",
      visual: (
        <div className="flex flex-col gap-[10px] h-[120px] justify-center px-2">
          {[
            { store: "GINOS032", status: "ok", val: "+1.2" },
            { store: "TTD BARRIE", status: "warn", val: "-4.1" },
            { store: "GINOS085", status: "bad", val: "+8.3" },
            { store: "TTD MILTON", status: "ok", val: "-0.5" },
          ].map((row) => (
            <div key={row.store} className="flex items-center gap-3 text-[12px]">
              <div className="w-[6px] h-[6px] rounded-full" style={{
                background: row.status === "ok" ? "#2E7D4F" : row.status === "warn" ? "#C77A00" : "#E2231A",
              }} />
              <span className="font-mono flex-1" style={{ color: "#C9B68B" }}>{row.store}</span>
              <span className="font-mono" style={{
                color: row.status === "ok" ? "#2E7D4F" : row.status === "warn" ? "#C77A00" : "#E2231A",
              }}>{row.val}</span>
            </div>
          ))}
        </div>
      ),
      label: "Drill into individual store compliance details",
    },
    {
      title: "Trend Analysis",
      visual: (
        <div className="h-[120px] flex items-end px-2">
          <svg viewBox="0 0 280 100" className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(226,35,26,.25)" />
                <stop offset="100%" stopColor="rgba(226,35,26,0)" />
              </linearGradient>
            </defs>
            <path d="M0,80 Q35,75 70,60 T140,45 T210,30 T280,20 V100 H0 Z" fill="url(#trendFill)" />
            <path d="M0,80 Q35,75 70,60 T140,45 T210,30 T280,20" fill="none" stroke="#E2231A" strokeWidth="2" strokeLinecap="round" />
            <circle cx="280" cy="20" r="3" fill="#E2231A" />
          </svg>
        </div>
      ),
      label: "8-week compliance trends improving over time",
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % carouselItems.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [carouselItems.length]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push("/overview");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex flex-col lg:grid lg:grid-cols-2">
      {/* Mobile — logo + heading (light background, above form) */}
      <div className="lg:hidden px-6 pt-8 pb-4" style={{ background: "var(--color-paper)" }}>
        <div className="flex items-center gap-3 mb-5">
          <Image src="/ginos-logo.png" alt="Gino's Pizza" width={44} height={44} />
          <div className="font-serif text-2xl">Gino&apos;s Pizza</div>
        </div>
        <h2 className="font-serif text-[26px] leading-[1.1] mb-2">
          Inventory &amp; Compliance
        </h2>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          Monitor ingredient orders and track compliance across all franchise stores.
        </p>
      </div>

      {/* Mobile — dark carousel strip (~30% of screen) */}
      <div
        className="lg:hidden relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #1B1A17 0%, #3a2218 50%, #1B1A17 100%)",
          padding: "16px 20px",
        }}
      >
        <div className="checker absolute inset-0 opacity-30" />
        <div className="relative z-10">
          <div
            className="rounded-[12px] overflow-hidden"
            style={{
              background: "rgba(255,255,255,.04)",
              border: "1px solid rgba(255,255,255,.06)",
            }}
          >
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
              <div className="text-[12px] font-semibold" style={{ color: "#F4ECDD" }}>
                {carouselItems[carouselIndex].title}
              </div>
              <div className="flex gap-[4px]">
                {carouselItems.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCarouselIndex(i)}
                    className="h-[3px] rounded-full transition-all duration-500"
                    style={{
                      width: carouselIndex === i ? 16 : 5,
                      background: carouselIndex === i ? "#E2231A" : "rgba(255,255,255,.15)",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="relative h-[110px] overflow-hidden">
              {carouselItems.map((item, i) => (
                <div
                  key={i}
                  className="absolute inset-0 transition-all duration-700 ease-in-out"
                  style={{
                    opacity: carouselIndex === i ? 1 : 0,
                    transform: carouselIndex === i ? "translateX(0)" : i > carouselIndex ? "translateX(40px)" : "translateX(-40px)",
                  }}
                >
                  <div className="p-3">{item.visual}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop — left brand panel */}
      <div
        className="hidden lg:flex flex-col p-12 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #1B1A17 0%, #3a2218 50%, #1B1A17 100%)",
        }}
      >
        <div className="checker absolute inset-0 opacity-30" />

        {/* Logo */}
        <div className="relative z-10 mb-10">
          <div className="flex items-center gap-3">
            <Image
              src="/ginos-logo.png"
              alt="Gino's Pizza"
              width={56}
              height={56}
            />
            <div>
              <div className="font-serif text-3xl text-white">Gino&apos;s Pizza</div>
            </div>
          </div>
        </div>

        {/* Header */}
        <div className="relative z-10 mb-3">
          <h2
            className="font-serif text-[42px] leading-[1.1] mb-3"
            style={{ color: "#F4ECDD" }}
          >
            Inventory &<br />
            Compliance
          </h2>
          <p className="text-[15px] leading-relaxed max-w-md" style={{ color: "#C9B68B" }}>
            Monitor weekly ingredient orders against expected usage across all franchise
            stores. Track cheese, sauce, and flour ratios to ensure compliance.
          </p>
        </div>

        {/* Visual carousel */}
        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <div
            className="rounded-[14px] overflow-hidden"
            style={{
              background: "rgba(255,255,255,.04)",
              border: "1px solid rgba(255,255,255,.06)",
            }}
          >
            {/* Carousel header */}
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
              <div className="text-[13px] font-semibold" style={{ color: "#F4ECDD" }}>
                {carouselItems[carouselIndex].title}
              </div>
              <div className="flex gap-[5px]">
                {carouselItems.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCarouselIndex(i)}
                    className="h-[4px] rounded-full transition-all duration-500"
                    style={{
                      width: carouselIndex === i ? 20 : 6,
                      background: carouselIndex === i ? "#E2231A" : "rgba(255,255,255,.15)",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Carousel content */}
            <div className="relative h-[140px] overflow-hidden">
              {carouselItems.map((item, i) => (
                <div
                  key={i}
                  className="absolute inset-0 transition-all duration-700 ease-in-out"
                  style={{
                    opacity: carouselIndex === i ? 1 : 0,
                    transform: carouselIndex === i
                      ? "translateX(0)"
                      : i > carouselIndex
                      ? "translateX(40px)"
                      : "translateX(-40px)",
                  }}
                >
                  <div className="p-4">{item.visual}</div>
                </div>
              ))}
            </div>

            {/* Carousel label */}
            <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
              <p className="text-[11.5px] transition-opacity duration-500" style={{ color: "#8A7C5F" }}>
                {carouselItems[carouselIndex].label}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <a
          href="https://builtwithgloo.com"
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 text-[12px] mt-6 hover:underline transition-colors"
          style={{ color: "#8A7C5F" }}
        >
          Built by Gloo
        </a>
      </div>

      {/* Right — login form */}
      <div
        className="flex-1 flex items-center justify-center p-6 lg:p-8"
        style={{ background: "var(--color-paper)" }}
      >
        <div className="w-full max-w-[400px]">
          <h1
            className="font-serif text-[32px] leading-tight mb-2"
            style={{ letterSpacing: "-0.015em" }}
          >
            Welcome back
          </h1>
          <p className="text-[13.5px] mb-8" style={{ color: "var(--color-ink-2)" }}>
            Sign in to access your dashboard
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="email"
                className="block mb-1.5"
                style={{
                  fontSize: "11.5px",
                  fontWeight: 600,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  color: "var(--color-ink-3)",
                }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="james@ginospizza.ca"
                required
                className="w-full px-3 py-[10px] rounded-[10px] bg-white text-[14px] outline-none transition-colors"
                style={{
                  border: "1px solid var(--color-line)",
                  color: "var(--color-ink)",
                }}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block mb-1.5"
                style={{
                  fontSize: "11.5px",
                  fontWeight: 600,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  color: "var(--color-ink-3)",
                }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                className="w-full px-3 py-[10px] rounded-[10px] bg-white text-[14px] outline-none transition-colors"
                style={{
                  border: "1px solid var(--color-line)",
                  color: "var(--color-ink)",
                }}
              />
            </div>

            {error && (
              <div
                className="px-3 py-2 rounded-lg text-[13px]"
                style={{
                  background: "var(--color-ginos-red-soft)",
                  color: "var(--color-ginos-red)",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-[11px] rounded-[10px] text-white font-medium text-[14px] transition-colors disabled:opacity-60"
              style={{
                background: loading
                  ? "var(--color-ginos-red-deep)"
                  : "var(--color-ginos-red)",
                boxShadow:
                  "0 4px 14px rgba(226,35,26,.25), inset 0 1px 0 rgba(255,255,255,.18)",
                border: "none",
                cursor: loading ? "wait" : "default",
              }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p
            className="mt-6 text-center text-[12px]"
            style={{ color: "var(--color-ink-3)" }}
          >
            Contact your administrator for access
          </p>
        </div>
      </div>
    </div>
  );
}

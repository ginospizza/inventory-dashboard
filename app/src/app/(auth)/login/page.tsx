"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left — brand moment */}
      <div
        className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #1B1A17 0%, #3a2218 50%, #1B1A17 100%)",
        }}
      >
        <div className="checker absolute inset-0 opacity-30" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-xl bg-white p-1 grid place-items-center"
              style={{ boxShadow: "0 4px 20px rgba(226,35,26,.4)" }}
            >
              <div className="w-full h-full rounded-lg bg-ginos-red grid place-items-center text-white font-bold text-lg">
                G
              </div>
            </div>
            <div>
              <div className="font-serif text-3xl text-white">Gino&apos;s Pizza</div>
            </div>
          </div>
        </div>

        <div className="relative z-10">
          <h2
            className="font-serif text-[42px] leading-[1.1] mb-4"
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

        <div
          className="relative z-10 text-[12px]"
          style={{ color: "#8A7C5F" }}
        >
          Built by Gloo &middot; Powered by AI
        </div>
      </div>

      {/* Right — login form */}
      <div
        className="flex items-center justify-center p-8"
        style={{ background: "var(--color-paper)" }}
      >
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div
              className="w-10 h-10 rounded-lg bg-white p-[3px] grid place-items-center"
              style={{ boxShadow: "0 4px 14px rgba(226,35,26,.3)" }}
            >
              <div className="w-full h-full rounded-md bg-ginos-red grid place-items-center text-white font-bold text-sm">
                G
              </div>
            </div>
            <span className="font-serif text-2xl">Gino&apos;s</span>
          </div>

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

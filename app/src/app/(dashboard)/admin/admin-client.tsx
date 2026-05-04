"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Package, Sliders, Activity, Sparkles, UserPlus, Trash2 } from "lucide-react";

interface AdminClientProps {
  dsms: Record<string, unknown>[];
  stores: Record<string, unknown>[];
  products: Record<string, unknown>[];
  thresholds: Record<string, unknown>[];
  assumptions: Record<string, unknown>[];
  profiles: Record<string, unknown>[];
  aiConfig: Record<string, unknown>;
  aiCalls: Record<string, unknown>[];
}

type Tab = "users" | "dsm" | "products" | "thresholds" | "activity" | "ai";

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "users", label: "Users", icon: UserPlus },
  { key: "dsm", label: "DSM ↔ Stores", icon: Users },
  { key: "products", label: "Product Classification", icon: Package },
  { key: "thresholds", label: "Thresholds & Assumptions", icon: Sliders },
  { key: "activity", label: "Login Activity", icon: Activity },
  { key: "ai", label: "AI Usage", icon: Sparkles },
];

export function AdminClient({
  dsms,
  stores,
  products,
  thresholds,
  assumptions,
  profiles,
  aiConfig,
  aiCalls,
}: AdminClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>("users");

  return (
    <div>
      <div className="flex items-end justify-between gap-5 mb-[22px]">
        <div>
          <h1 className="font-serif text-[28px] lg:text-[38px] leading-none" style={{ letterSpacing: "-0.015em" }}>Admin Panel</h1>
          <p className="text-[13px] mt-[6px]" style={{ color: "var(--color-ink-3)" }}>Manage stores, products, thresholds, and users</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-[3px] rounded-lg overflow-x-auto" style={{ background: "var(--color-crust)", display: "inline-flex" }}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-2 px-4 py-[7px] rounded-[6px] text-[12.5px] font-medium transition-all"
              style={{
                background: activeTab === tab.key ? "white" : "transparent",
                color: activeTab === tab.key ? "var(--color-ink)" : "var(--color-ink-2)",
                boxShadow: activeTab === tab.key ? "var(--shadow-sm)" : "none",
              }}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="rounded-[14px] bg-white" style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}>
        {activeTab === "users" && <UsersTab profiles={profiles} dsms={dsms} />}
        {activeTab === "dsm" && <DsmTab dsms={dsms} stores={stores} />}
        {activeTab === "products" && <ProductsTab products={products} />}
        {activeTab === "thresholds" && <ThresholdsTab thresholds={thresholds} assumptions={assumptions} />}
        {activeTab === "activity" && <ActivityTab profiles={profiles} />}
        {activeTab === "ai" && <AiTab config={aiConfig} calls={aiCalls} />}
      </div>
    </div>
  );
}

// ── Users ───────────────────────────────────────────────────

function UsersTab({ profiles, dsms }: { profiles: Record<string, unknown>[]; dsms: Record<string, unknown>[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ email: "", name: "", role: "dsm", dsm_id: "", new_dsm_name: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    const payload = {
      ...formData,
      dsm_id: formData.dsm_id === "__new__" ? "" : formData.dsm_id,
    };

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    setLoading(false);

    if (data.error) {
      setError(data.error);
    } else {
      setSuccess(`User ${formData.email} created successfully${formData.new_dsm_name ? ` — new district "${formData.new_dsm_name}" created` : ""}`);
      setFormData({ email: "", name: "", role: "dsm", dsm_id: "", new_dsm_name: "", password: "" });
      setShowForm(false);
      router.refresh();
    }
  }

  async function handleDelete(userId: string, userName: string) {
    if (!confirm(`Delete user "${userName}"? This cannot be undone.`)) return;

    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });

    const data = await res.json();
    if (data.error) {
      setError(data.error);
    } else {
      setSuccess(`User "${userName}" deleted`);
      router.refresh();
    }
  }

  return (
    <div className="p-[18px]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-[14px] font-semibold">Manage Users</h4>
          <p className="text-[12px] mt-1" style={{ color: "var(--color-ink-3)" }}>
            Create accounts for admins and district managers
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-[7px] px-[14px] py-2 rounded-[9px] text-white text-[13px] font-medium"
          style={{
            background: "var(--color-ginos-red)",
            boxShadow: "0 4px 14px rgba(226,35,26,.25), inset 0 1px 0 rgba(255,255,255,.18)",
          }}
        >
          <UserPlus className="w-4 h-4" />
          {showForm ? "Cancel" : "Add User"}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-[13px] mb-4" style={{ background: "var(--color-ginos-red-soft)", color: "var(--color-ginos-red)" }}>
          {error}
        </div>
      )}
      {success && (
        <div className="px-3 py-2 rounded-lg text-[13px] mb-4" style={{ background: "var(--color-basil-soft)", color: "var(--color-basil)" }}>
          {success}
        </div>
      )}

      {/* Create user form */}
      {showForm && (
        <form onSubmit={handleCreate} className="rounded-xl p-5 mb-5" style={{ border: "1px solid var(--color-line)", background: "var(--color-paper)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block mb-1.5 text-[11.5px] font-semibold tracking-[.04em] uppercase" style={{ color: "var(--color-ink-3)" }}>Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Brijesh Patel"
                required
                className="w-full px-3 py-[9px] rounded-[9px] bg-white text-[13px] outline-none"
                style={{ border: "1px solid var(--color-line)" }}
              />
            </div>
            <div>
              <label className="block mb-1.5 text-[11.5px] font-semibold tracking-[.04em] uppercase" style={{ color: "var(--color-ink-3)" }}>Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="e.g., brijesh@ginospizza.ca"
                required
                className="w-full px-3 py-[9px] rounded-[9px] bg-white text-[13px] outline-none"
                style={{ border: "1px solid var(--color-line)" }}
              />
            </div>
            <div>
              <label className="block mb-1.5 text-[11.5px] font-semibold tracking-[.04em] uppercase" style={{ color: "var(--color-ink-3)" }}>Password</label>
              <input
                type="text"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Temporary password"
                required
                minLength={6}
                className="w-full px-3 py-[9px] rounded-[9px] bg-white text-[13px] outline-none"
                style={{ border: "1px solid var(--color-line)" }}
              />
            </div>
            <div>
              <label className="block mb-1.5 text-[11.5px] font-semibold tracking-[.04em] uppercase" style={{ color: "var(--color-ink-3)" }}>Role</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value, dsm_id: "" })}
                className="w-full px-3 py-[9px] rounded-[9px] bg-white text-[13px]"
                style={{ border: "1px solid var(--color-line)" }}
              >
                <option value="dsm">District Manager (DSM)</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            {formData.role === "dsm" && (
              <div className="sm:col-span-2">
                <label className="block mb-1.5 text-[11.5px] font-semibold tracking-[.04em] uppercase" style={{ color: "var(--color-ink-3)" }}>Assign to DSM District</label>
                <select
                  value={formData.dsm_id}
                  onChange={(e) => setFormData({ ...formData, dsm_id: e.target.value, new_dsm_name: "" })}
                  required={!formData.new_dsm_name}
                  className="w-full px-3 py-[9px] rounded-[9px] bg-white text-[13px]"
                  style={{ border: "1px solid var(--color-line)" }}
                >
                  <option value="">Select district...</option>
                  {dsms.map((d) => (
                    <option key={d.id as string} value={d.id as string}>{d.name as string}</option>
                  ))}
                  <option value="__new__">+ Create new district</option>
                </select>
                {formData.dsm_id === "__new__" && (
                  <input
                    type="text"
                    value={formData.new_dsm_name}
                    onChange={(e) => setFormData({ ...formData, dsm_id: "__new__", new_dsm_name: e.target.value })}
                    placeholder="New district name (e.g., Sarah)"
                    required
                    className="w-full mt-2 px-3 py-[9px] rounded-[9px] bg-white text-[13px] outline-none"
                    style={{ border: "1px solid var(--color-line)" }}
                  />
                )}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-[9px] rounded-[9px] text-white text-[13px] font-medium disabled:opacity-60"
            style={{ background: "var(--color-ginos-red)" }}
          >
            {loading ? "Creating..." : "Create User"}
          </button>
        </form>
      )}

      {/* User list */}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              {["User", "Email", "Role", "District", "Last Login", ""].map((h) => (
                <th key={h} className="text-left font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const role = p.role as string;
              const dsm = p.dsms as { name: string } | null;
              const lastLogin = p.last_login_at ? new Date(p.last_login_at as string).toLocaleDateString() : "Never";
              return (
                <tr key={p.id as string} className="hover:bg-[rgba(244,236,221,.4)]">
                  <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full grid place-items-center text-white font-bold text-[10px]"
                        style={{ background: role === "super_admin" ? "var(--color-ink)" : "var(--color-ginos-red)" }}
                      >
                        {(p.name as string)?.charAt(0) ?? "?"}
                      </div>
                      <span className="font-medium">{p.name as string}</span>
                    </div>
                  </td>
                  <td className="px-[14px] py-[10px] text-[12px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-2)" }}>
                    {p.email as string}
                  </td>
                  <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{
                        background: role === "super_admin" ? "var(--color-crust)" : "var(--color-ginos-red-soft)",
                        color: role === "super_admin" ? "var(--color-ink)" : "var(--color-ginos-red)",
                      }}
                    >
                      {role === "super_admin" ? "Admin" : "DSM"}
                    </span>
                  </td>
                  <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-2)" }}>
                    {dsm?.name ?? "—"}
                  </td>
                  <td className="px-[14px] py-[10px] font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-3)" }}>
                    {lastLogin}
                  </td>
                  <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                    <button
                      onClick={() => handleDelete(p.id as string, p.name as string)}
                      className="w-7 h-7 grid place-items-center rounded-md hover:bg-ginos-red-soft transition-colors"
                      style={{ color: "var(--color-ink-3)" }}
                      title="Delete user"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {profiles.length === 0 && <p className="text-center py-8 text-[13px]" style={{ color: "var(--color-ink-3)" }}>No users yet</p>}
      </div>
    </div>
  );
}

// ── DSM ↔ Stores ─────────────────────────────────────────────

function DsmTab({ dsms, stores }: { dsms: Record<string, unknown>[]; stores: Record<string, unknown>[] }) {
  const router = useRouter();
  const [newDsmName, setNewDsmName] = useState("");
  const [addingDsm, setAddingDsm] = useState(false);
  const [reassigning, setReassigning] = useState<string | null>(null); // store id being reassigned
  const [message, setMessage] = useState("");

  async function handleAddDsm(e: React.FormEvent) {
    e.preventDefault();
    if (!newDsmName.trim()) return;
    setAddingDsm(true);
    const res = await fetch("/api/dsms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newDsmName.trim() }),
    });
    const data = await res.json();
    setAddingDsm(false);
    if (data.error) {
      setMessage(`Error: ${data.error}`);
    } else {
      setMessage(`District "${newDsmName}" created`);
      setNewDsmName("");
      router.refresh();
    }
  }

  async function handleReassign(storeId: string, newDsmId: string) {
    const res = await fetch("/api/dsms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_id: storeId, dsm_id: newDsmId || null }),
    });
    const data = await res.json();
    if (data.error) {
      setMessage(`Error: ${data.error}`);
    } else {
      setMessage("Store reassigned");
      setReassigning(null);
      router.refresh();
    }
  }

  const unassigned = stores.filter(s => !s.dsm_id);

  return (
    <div className="p-[18px]">
      {/* Add DSM */}
      <div className="flex items-center gap-3 mb-5">
        <form onSubmit={handleAddDsm} className="flex items-center gap-2">
          <input
            type="text"
            value={newDsmName}
            onChange={(e) => setNewDsmName(e.target.value)}
            placeholder="New district name..."
            className="px-3 py-[7px] rounded-[9px] bg-white text-[13px] outline-none w-[200px]"
            style={{ border: "1px solid var(--color-line)" }}
          />
          <button
            type="submit"
            disabled={addingDsm || !newDsmName.trim()}
            className="px-3 py-[7px] rounded-[9px] text-white text-[13px] font-medium disabled:opacity-50"
            style={{ background: "var(--color-ginos-red)" }}
          >
            {addingDsm ? "Adding..." : "Add District"}
          </button>
        </form>
        {message && (
          <span className="text-[12px]" style={{ color: message.startsWith("Error") ? "var(--color-ginos-red)" : "var(--color-basil)" }}>
            {message}
          </span>
        )}
      </div>

      {/* DSM cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {dsms.map((dsm) => {
          const dsmStores = stores.filter((s) => s.dsm_id === dsm.id);
          return (
            <div key={dsm.id as string} className="rounded-xl p-4" style={{ border: "1px solid var(--color-line)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-ginos-red grid place-items-center text-white font-bold text-sm">
                  {(dsm.name as string).charAt(0)}
                </div>
                <div>
                  <div className="font-semibold text-[14px]">{dsm.name as string}</div>
                  <div className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                    {dsm.region as string || "—"} &middot; {dsmStores.length} stores
                  </div>
                </div>
              </div>
              <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1">
                {dsmStores.map((s) => (
                  <div key={s.id as string} className="text-[12px] px-2 py-1 rounded hover:bg-crust transition-colors flex items-center justify-between group">
                    <div>
                      <span className="font-medium">{s.code as string}</span>
                      <span className="ml-2" style={{ color: "var(--color-ink-3)" }}>{s.city as string}</span>
                    </div>
                    {reassigning === s.id ? (
                      <select
                        autoFocus
                        defaultValue={dsm.id as string}
                        onChange={(e) => handleReassign(s.id as string, e.target.value)}
                        onBlur={() => setReassigning(null)}
                        className="text-[11px] px-1 py-0.5 rounded border"
                        style={{ borderColor: "var(--color-line)" }}
                      >
                        {dsms.map(d => (
                          <option key={d.id as string} value={d.id as string}>{d.name as string}</option>
                        ))}
                        <option value="">Unassign</option>
                      </select>
                    ) : (
                      <button
                        onClick={() => setReassigning(s.id as string)}
                        className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded"
                        style={{ color: "var(--color-ink-3)", background: "var(--color-crust)" }}
                      >
                        Move
                      </button>
                    )}
                  </div>
                ))}
                {dsmStores.length === 0 && (
                  <p className="text-[12px] py-2" style={{ color: "var(--color-ink-3)" }}>No stores assigned</p>
                )}
              </div>
            </div>
          );
        })}

        {/* Unassigned stores */}
        {unassigned.length > 0 && (
          <div className="rounded-xl p-4" style={{ border: "1px dashed var(--color-line)" }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full grid place-items-center font-bold text-sm" style={{ background: "var(--color-crust)", color: "var(--color-ink-3)" }}>
                ?
              </div>
              <div>
                <div className="font-semibold text-[14px]">Unassigned</div>
                <div className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>{unassigned.length} stores</div>
              </div>
            </div>
            <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1">
              {unassigned.map((s) => (
                <div key={s.id as string} className="text-[12px] px-2 py-1 rounded hover:bg-crust transition-colors flex items-center justify-between group">
                  <div>
                    <span className="font-medium">{s.code as string}</span>
                    <span className="ml-2" style={{ color: "var(--color-ink-3)" }}>{s.brand as string}</span>
                  </div>
                  {reassigning === s.id ? (
                    <select
                      autoFocus
                      defaultValue=""
                      onChange={(e) => handleReassign(s.id as string, e.target.value)}
                      onBlur={() => setReassigning(null)}
                      className="text-[11px] px-1 py-0.5 rounded border"
                      style={{ borderColor: "var(--color-line)" }}
                    >
                      <option value="">Unassigned</option>
                      {dsms.map(d => (
                        <option key={d.id as string} value={d.id as string}>{d.name as string}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setReassigning(s.id as string)}
                      className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded"
                      style={{ color: "var(--color-ginos-red)", background: "var(--color-ginos-red-soft)" }}
                    >
                      Assign
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {dsms.length === 0 && <p className="text-center py-8 text-[13px]" style={{ color: "var(--color-ink-3)" }}>No DSMs configured</p>}
    </div>
  );
}

// ── Products ─────────────────────────────────────────────────

function ProductsTab({ products }: { products: Record<string, unknown>[] }) {
  const classColors: Record<string, { bg: string; text: string }> = {
    primary: { bg: "var(--color-basil-soft)", text: "var(--color-basil)" },
    secondary: { bg: "var(--color-crust)", text: "var(--color-ink-2)" },
    neither: { bg: "var(--color-mustard-soft)", text: "var(--color-mustard)" },
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            {["Code", "Description", "Type", "Pack Size", "Classification"].map((h) => (
              <th key={h} className="text-left font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)", background: "var(--color-paper)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const cls = p.classification as string;
            const colors = classColors[cls] ?? classColors.neither;
            return (
              <tr key={p.id as string} className="hover:bg-[rgba(244,236,221,.4)]" style={cls === "neither" ? { background: "var(--color-mustard-soft)", opacity: 0.7 } : undefined}>
                <td className="px-[14px] py-[10px] font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)" }}>{p.code as string}</td>
                <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>{p.description as string}</td>
                <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-2)" }}>{p.type as string}</td>
                <td className="px-[14px] py-[10px] font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)" }}>{p.pack_size as string}</td>
                <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: colors.bg, color: colors.text }}>
                    {cls}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {products.length === 0 && <p className="text-center py-8 text-[13px]" style={{ color: "var(--color-ink-3)" }}>No products loaded</p>}
    </div>
  );
}

// ── Thresholds ───────────────────────────────────────────────

function ThresholdsTab({ thresholds, assumptions }: { thresholds: Record<string, unknown>[]; assumptions: Record<string, unknown>[] }) {
  return (
    <div className="p-[18px] grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h4 className="text-[14px] font-semibold mb-3">Compliance Thresholds</h4>
        <div className="flex flex-col gap-3">
          {thresholds.map((t) => (
            <div key={t.id as string} className="flex items-center justify-between p-3 rounded-lg" style={{ border: "1px solid var(--color-line)" }}>
              <span className="text-[13px] font-medium">{t.metric as string}</span>
              <div className="flex gap-3 text-[12px] font-mono">
                <span style={{ color: "var(--color-mustard)" }}>warn: {String(t.warn_value)}</span>
                <span style={{ color: "var(--color-ginos-red)" }}>bad: {String(t.bad_value)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-[14px] font-semibold mb-3">Per-Pizza Usage Assumptions</h4>
        <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              {["Size", "Cheese (oz)", "Sauce (oz)", "Flour (kg)"].map((h) => (
                <th key={h} className="text-left font-semibold text-[11px] tracking-[.06em] uppercase px-3 py-2" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assumptions.map((a) => (
              <tr key={a.id as string}>
                <td className="px-3 py-2 font-medium capitalize" style={{ borderBottom: "1px solid var(--color-line)" }}>{a.pizza_size as string}</td>
                <td className="px-3 py-2 font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>{String(a.cheese_oz)}</td>
                <td className="px-3 py-2 font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>{String(a.sauce_oz)}</td>
                <td className="px-3 py-2 font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>{String(a.flour_kg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Login Activity ───────────────────────────────────────────

function ActivityTab({ profiles }: { profiles: Record<string, unknown>[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            {["User", "Role", "Last Login", "DSM"].map((h) => (
              <th key={h} className="text-left font-semibold text-[11px] tracking-[.06em] uppercase px-[14px] py-[10px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)", background: "var(--color-paper)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => {
            const role = p.role as string;
            const dsm = p.dsms as { name: string } | null;
            const lastLogin = p.last_login_at ? new Date(p.last_login_at as string).toLocaleString() : "Never";

            return (
              <tr key={p.id as string} className="hover:bg-[rgba(244,236,221,.4)]">
                <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-full grid place-items-center text-white font-bold text-[10px]"
                      style={{ background: role === "super_admin" ? "var(--color-ink)" : "var(--color-ginos-red)" }}
                    >
                      {(p.name as string)?.charAt(0) ?? "?"}
                    </div>
                    <div>
                      <div className="font-medium">{p.name as string}</div>
                      <div className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>{p.email as string}</div>
                    </div>
                  </div>
                </td>
                <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                    style={{
                      background: role === "super_admin" ? "var(--color-crust)" : "var(--color-ginos-red-soft)",
                      color: role === "super_admin" ? "var(--color-ink)" : "var(--color-ginos-red)",
                    }}
                  >
                    {role === "super_admin" ? "Admin" : "DSM"}
                  </span>
                </td>
                <td className="px-[14px] py-[10px] font-mono text-[12px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-2)" }}>
                  {lastLogin}
                </td>
                <td className="px-[14px] py-[10px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-2)" }}>
                  {dsm?.name ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── AI Usage ─────────────────────────────────────────────────

function AiTab({ config, calls }: { config: Record<string, unknown>; calls: Record<string, unknown>[] }) {
  const cap = config.monthly_call_cap as number ?? 200;
  const thisMonth = calls.filter((c) => {
    const d = new Date(c.called_at as string);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="p-[18px] grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="font-serif text-[32px] leading-none mb-2">
          {thisMonth} <span className="text-[18px]" style={{ color: "var(--color-ink-3)" }}>of {cap} calls</span>
        </div>
        <p className="text-[12px] mb-4" style={{ color: "var(--color-ink-3)" }}>This month&apos;s AI API usage</p>
        <div className="h-[8px] rounded-full overflow-hidden" style={{ background: "var(--color-crust)" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min((thisMonth / cap) * 100, 100)}%`,
              background: thisMonth > cap * 0.8 ? "var(--color-ginos-red)" : "var(--color-basil)",
            }}
          />
        </div>
        <p className="text-[11px] mt-2" style={{ color: "var(--color-ink-3)" }}>
          Model: {config.default_model as string ?? "openai/gpt-4o-mini"}
        </p>
      </div>

      <div>
        <h4 className="text-[14px] font-semibold mb-3">Recent Calls</h4>
        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
          {calls.slice(0, 10).map((c) => {
            const user = c.profiles as { name: string } | null;
            return (
              <div key={c.id as string} className="flex items-center justify-between text-[12px] py-1.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
                <div>
                  <span className="font-medium">{user?.name ?? "Unknown"}</span>
                  <span className="ml-2" style={{ color: "var(--color-ink-3)" }}>{c.page_context as string}</span>
                </div>
                <span className="font-mono" style={{ color: "var(--color-ink-3)" }}>
                  {new Date(c.called_at as string).toLocaleString()}
                </span>
              </div>
            );
          })}
          {calls.length === 0 && <p className="text-[12px] py-4 text-center" style={{ color: "var(--color-ink-3)" }}>No AI calls yet</p>}
        </div>
      </div>
    </div>
  );
}

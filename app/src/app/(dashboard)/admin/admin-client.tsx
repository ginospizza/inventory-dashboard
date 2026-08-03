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
        {activeTab === "ai" && <AiTab config={aiConfig} calls={aiCalls} dsms={dsms} />}
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
  // District being renamed + the in-progress value. James, July 31 2026:
  // "Michel is gone and a new DSM is being assigned his territory. It would be
  // convenient if I could just change the name Michel instead of making a new
  // district and moving everything into the new one."
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [message, setMessage] = useState("");

  async function handleRenameDsm(dsmId: string, oldName: string) {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name || name === oldName) return;
    const res = await fetch("/api/dsms", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: dsmId, name }),
    });
    const data = await res.json();
    if (data.error) {
      setMessage(`Error: ${data.error}`);
    } else {
      setMessage(`District "${oldName}" renamed to "${name}"`);
      router.refresh();
    }
  }

  async function handleDeleteDsm(dsmId: string, dsmName: string, storeCount: number) {
    const msg = storeCount > 0
      ? `Delete district "${dsmName}"? Its ${storeCount} stores will become unassigned.`
      : `Delete district "${dsmName}"?`;
    if (!confirm(msg)) return;

    const res = await fetch("/api/dsms", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: dsmId }),
    });
    const data = await res.json();
    if (data.error) {
      setMessage(`Error: ${data.error}`);
    } else {
      setMessage(`District "${dsmName}" deleted`);
      router.refresh();
    }
  }

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
                <div className="flex-1">
                  {renaming === (dsm.id as string) ? (
                    <input
                      autoFocus
                      defaultValue={dsm.name as string}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameDsm(dsm.id as string, dsm.name as string)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") { setRenameValue(""); setRenaming(null); }
                      }}
                      className="font-semibold text-[14px] w-full rounded px-1 -mx-1"
                      style={{ border: "1px solid var(--color-ginos-red)", outline: "none" }}
                    />
                  ) : (
                    <button
                      onClick={() => { setRenameValue(dsm.name as string); setRenaming(dsm.id as string); }}
                      className="font-semibold text-[14px] text-left hover:underline decoration-dotted underline-offset-2"
                      title="Click to rename district"
                    >
                      {dsm.name as string}
                    </button>
                  )}
                  <div className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                    {dsm.region as string || "—"} &middot; {dsmStores.length} stores
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteDsm(dsm.id as string, dsm.name as string, dsmStores.length)}
                  className="w-7 h-7 grid place-items-center rounded-md hover:bg-ginos-red-soft transition-colors"
                  style={{ color: "var(--color-ink-3)" }}
                  title="Delete district"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
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
  const router = useRouter();

  // Editable thresholds & assumptions (James, July 31 2026). These rows DRIVE
  // grading now — the engine loads them at runtime with the old constants as
  // fallback. Diff thresholds are stored as fractions but edited as percent.
  const diffRow = thresholds.find((t) => t.metric === "ingredient_diff_pct");
  const ratioRow = thresholds.find((t) => t.metric === "ratio_bands");

  const [pct, setPct] = useState({
    warn: Number(diffRow?.warn_value ?? 0.25) * 100,
    bad: Number(diffRow?.bad_value ?? 0.5) * 100,
    severe: Number(diffRow?.severe_value ?? 0.75) * 100,
  });
  const [ratio, setRatio] = useState({
    ok_low: Number(ratioRow?.ok_low ?? 75), ok_high: Number(ratioRow?.ok_high ?? 125),
    warn_low: Number(ratioRow?.warn_low ?? 65), warn_high: Number(ratioRow?.warn_high ?? 135),
    bad_low: Number(ratioRow?.bad_low ?? 50), bad_high: Number(ratioRow?.bad_high ?? 150),
  });
  const [rows, setRows] = useState(
    assumptions.map((a) => ({
      pizza_size: a.pizza_size as string,
      cheese_oz: Number(a.cheese_oz ?? 0),
      sauce_oz: Number(a.sauce_oz ?? 0),
      dough_kg: Number(a.dough_kg ?? 0),
      pizza_sales_per_case: Number(a.pizza_sales_per_case ?? 0),
    }))
  );

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Re-score flow: preview first, always.
  const [rescorePreview, setRescorePreview] = useState<{ changed: number; total: number; transitions: Record<string, number> } | null>(null);
  const [rescoring, setRescoring] = useState<"preview" | "apply" | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage("");
    setSaved(false);
    try {
      const res = await fetch("/api/thresholds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pct: { warn: pct.warn / 100, bad: pct.bad / 100, severe: pct.severe / 100 },
          ratio,
          assumptions: rows,
        }),
      });
      const data = await res.json();
      if (data.error) setMessage(`Error: ${data.error}`);
      else {
        setMessage("Saved. New uploads grade with these values immediately.");
        setSaved(true);
        setRescorePreview(null);
        router.refresh();
      }
    } catch {
      setMessage("Error: request failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRescore(apply: boolean) {
    setRescoring(apply ? "apply" : "preview");
    setMessage("");
    try {
      const res = await fetch("/api/rescore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const data = await res.json();
      if (data.error) setMessage(`Error: ${data.error}`);
      else if (!apply) setRescorePreview(data);
      else {
        setMessage(`Re-score complete: ${data.updated} store-weeks updated.`);
        setRescorePreview(null);
        setSaved(false);
        router.refresh();
      }
    } catch {
      setMessage("Error: request failed");
    } finally {
      setRescoring(null);
    }
  }

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const inputCls = "w-[76px] rounded px-2 py-1 text-[12.5px] font-mono text-right";
  const inputStyle = { border: "1px solid var(--color-line)", background: "white" } as const;

  return (
    <div className="p-[18px] flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-[12px] p-[16px]" style={{ border: "1px solid var(--color-line)" }}>
          <h4 className="text-[14px] font-semibold mb-1">Ingredient thresholds</h4>
          <p className="text-[12px] mb-3" style={{ color: "var(--color-ink-3)" }}>
            How far an ingredient may drift from its box-expected amount (6-week average), as a percentage.
          </p>
          <div className="flex flex-col gap-2">
            {([["warn", "Borderline beyond"], ["bad", "At Risk beyond"], ["severe", "Severe beyond"]] as const).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between text-[13px]">
                <span>{label}</span>
                <span className="flex items-center gap-1">
                  <input type="number" step="1" min="1" className={inputCls} style={inputStyle}
                    value={pct[k]} onChange={(e) => setPct({ ...pct, [k]: num(e.target.value) })} />
                  <span className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>%</span>
                </span>
              </label>
            ))}
          </div>

          <h4 className="text-[14px] font-semibold mb-1 mt-5">Ratio bands</h4>
          <p className="text-[12px] mb-3" style={{ color: "var(--color-ink-3)" }}>
            Sauce:Cheese and Flour:Cheese, as a percentage of the 100% ideal. Outside the widest band is Severe.
          </p>
          <div className="flex flex-col gap-2">
            {([["ok", "Compliant"], ["warn", "Borderline"], ["bad", "At Risk"]] as const).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between text-[13px]">
                <span>{label} within</span>
                <span className="flex items-center gap-1 font-mono text-[12.5px]">
                  <input type="number" step="1" className={inputCls} style={inputStyle}
                    value={ratio[`${k}_low` as keyof typeof ratio]}
                    onChange={(e) => setRatio({ ...ratio, [`${k}_low`]: num(e.target.value) })} />
                  <span style={{ color: "var(--color-ink-3)" }}>–</span>
                  <input type="number" step="1" className={inputCls} style={inputStyle}
                    value={ratio[`${k}_high` as keyof typeof ratio]}
                    onChange={(e) => setRatio({ ...ratio, [`${k}_high`]: num(e.target.value) })} />
                  <span className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>%</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-[12px] p-[16px]" style={{ border: "1px solid var(--color-line)" }}>
          <h4 className="text-[14px] font-semibold mb-1">Per-box usage assumptions</h4>
          <p className="text-[12px] mb-3" style={{ color: "var(--color-ink-3)" }}>
            Usage per box (per piece for clamshells and plates). Dough kg — flour stores derive flour as dough ÷ 1.6.
            Changes apply to FUTURE uploads; historical estimates keep the values they were computed with.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  {["Size", "Cheese (oz)", "Sauce (fl oz)", "Dough (kg)", "Pizzas/case"].map((h, i) => (
                    <th key={h} className="font-semibold text-[11px] tracking-[.06em] uppercase px-2 py-2" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a, idx) => (
                  <tr key={a.pizza_size}>
                    <td className="px-2 py-1.5 font-medium" style={{ borderBottom: "1px solid var(--color-line)" }}>{a.pizza_size.replace("_", " ")}</td>
                    {(["cheese_oz", "sauce_oz", "dough_kg", "pizza_sales_per_case"] as const).map((f) => (
                      <td key={f} className="px-2 py-1.5 text-right" style={{ borderBottom: "1px solid var(--color-line)" }}>
                        <input type="number" step="0.005" min="0" className={inputCls} style={inputStyle}
                          value={a[f]}
                          onChange={(e) => {
                            const next = [...rows];
                            next[idx] = { ...a, [f]: num(e.target.value) };
                            setRows(next);
                          }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className="px-[14px] py-2 rounded-[9px] text-white text-[13px] font-medium disabled:opacity-60"
          style={{ background: "var(--color-ginos-red)" }}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        {message && (
          <span className="text-[12px]" style={{ color: message.startsWith("Error") ? "var(--color-ginos-red)" : "var(--color-basil)" }}>{message}</span>
        )}
      </div>

      {saved && (
        <div className="rounded-[10px] px-4 py-3" style={{ background: "var(--color-mustard-soft)", border: "1px solid var(--color-mustard)" }}>
          <p className="text-[12.5px] font-semibold mb-1" style={{ color: "var(--color-mustard)" }}>
            Historical statuses still reflect the previous thresholds
          </p>
          <p className="text-[12px] mb-2" style={{ color: "var(--color-ink-2)" }}>
            Every stored week was graded with the values that were active at the time. Preview what a
            re-grade would change before applying it — the preview writes nothing.
          </p>
          {!rescorePreview ? (
            <button onClick={() => handleRescore(false)} disabled={rescoring !== null}
              className="px-3 py-1.5 rounded-[8px] text-[12.5px] font-medium disabled:opacity-60"
              style={{ border: "1px solid var(--color-mustard)", color: "var(--color-mustard)", background: "white" }}>
              {rescoring === "preview" ? "Computing preview…" : "Preview re-score"}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] font-medium">
                {rescorePreview.changed} of {rescorePreview.total} store-weeks would change:
              </p>
              <ul className="text-[12px] font-mono flex flex-col gap-0.5" style={{ color: "var(--color-ink-2)" }}>
                {Object.entries(rescorePreview.transitions).map(([k, n]) => (
                  <li key={k}>{k.replace("->", " → ")}: {n}</li>
                ))}
                {Object.keys(rescorePreview.transitions).length === 0 && <li>No overall-status changes (only sub-metric colours move)</li>}
              </ul>
              <div className="flex gap-2 mt-1">
                <button onClick={() => handleRescore(true)} disabled={rescoring !== null}
                  className="px-3 py-1.5 rounded-[8px] text-white text-[12.5px] font-medium disabled:opacity-60"
                  style={{ background: "var(--color-ginos-red)" }}>
                  {rescoring === "apply" ? "Re-scoring…" : `Apply re-score (${rescorePreview.changed} rows)`}
                </button>
                <button onClick={() => setRescorePreview(null)} disabled={rescoring !== null}
                  className="px-3 py-1.5 rounded-[8px] text-[12.5px] font-medium"
                  style={{ border: "1px solid var(--color-line)" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
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

function AiTab({ config, calls, dsms }: {
  config: Record<string, unknown>;
  calls: Record<string, unknown>[];
  dsms: Record<string, unknown>[];
}) {
  const router = useRouter();

  // ── DSM access control (James + Raj, July 31 2026) ─────────
  // Super admins always have AI. DSM access is set here: off for launch,
  // on for everyone, or on for a pilot group — switchable any time, no deploy.
  const [accessMode, setAccessMode] = useState<string>(
    (config.dsm_access_mode as string) ?? "none"
  );
  const [selectedDsms, setSelectedDsms] = useState<string[]>(
    (config.allowed_dsm_ids as string[]) ?? []
  );
  const [accessMessage, setAccessMessage] = useState("");
  const [savingAccess, setSavingAccess] = useState(false);

  async function handleSaveAccess() {
    setSavingAccess(true);
    setAccessMessage("");
    try {
      const res = await fetch("/api/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dsm_access_mode: accessMode,
          allowed_dsm_ids: accessMode === "selected" ? selectedDsms : [],
        }),
      });
      const data = await res.json();
      if (data.error) {
        setAccessMessage(`Error: ${data.error}`);
      } else {
        setAccessMessage("Saved");
        router.refresh();
      }
    } catch {
      setAccessMessage("Error: request failed");
    } finally {
      setSavingAccess(false);
    }
  }

  const cap = config.monthly_call_cap as number ?? 200;
  const monthCalls = calls.filter((c) => {
    const d = new Date(c.called_at as string);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisMonth = monthCalls.length;
  const totalTokens = monthCalls.reduce((sum, c) => sum + ((c.tokens_used as number) ?? 0), 0);
  // GPT-4o-mini: ~$0.15/1M input + $0.60/1M output. Approx avg $0.35/1M total
  const estMonthlyCost = (totalTokens * 0.35) / 1_000_000;

  // ── Usage by person, this month ─────────────────────────────
  // James wants to see which DSM uses how much AI and what it costs, so this
  // groups the month's calls per user with their district alongside.
  const usageByUser = (() => {
    const map = new Map<string, { name: string; district: string; calls: number; tokens: number }>();
    for (const c of monthCalls) {
      const profile = c.profiles as { name?: string; dsms?: { name?: string } | null } | null;
      const name = profile?.name ?? "Unknown";
      const district = profile?.dsms?.name ?? "—";
      const entry = map.get(name) ?? { name, district, calls: 0, tokens: 0 };
      entry.calls += 1;
      entry.tokens += (c.tokens_used as number) ?? 0;
      map.set(name, entry);
    }
    return [...map.values()].sort((a, b) => b.tokens - a.tokens);
  })();

  // Parse per-call cost from page_context if available
  function parseCallInfo(context: string) {
    const parts = (context ?? "").split(" | ");
    const page = parts[0] ?? "unknown";
    const tokenBreakdown = parts[1] ?? "";
    const cost = parts[2] ?? "";
    return { page, tokenBreakdown, cost };
  }

  const accessOptions = [
    { key: "none", label: "Off for all DSMs", hint: "Only admins see AI Insights (launch default)" },
    { key: "all", label: "On for all DSMs", hint: "Every DSM gets the AI Insights buttons" },
    { key: "selected", label: "Pilot group", hint: "Only the DSMs picked below" },
  ];

  return (
    <div className="p-[18px] flex flex-col gap-6">
      {/* DSM access control */}
      <div className="rounded-[12px] p-[16px]" style={{ border: "1px solid var(--color-line)", background: "var(--color-paper)" }}>
        <h4 className="text-[14px] font-semibold mb-1">DSM access</h4>
        <p className="text-[12px] mb-3" style={{ color: "var(--color-ink-3)" }}>
          Admins always have AI Insights. Choose what DSMs see — switch any time, takes effect immediately.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          {accessOptions.map((o) => (
            <button
              key={o.key}
              onClick={() => setAccessMode(o.key)}
              className="flex-1 text-left rounded-[10px] px-3 py-2 transition-all"
              style={{
                border: accessMode === o.key ? "1.5px solid var(--color-ginos-red)" : "1px solid var(--color-line)",
                background: accessMode === o.key ? "var(--color-ginos-red-soft)" : "white",
              }}
            >
              <div className="text-[13px] font-medium">{o.label}</div>
              <div className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>{o.hint}</div>
            </button>
          ))}
        </div>
        {accessMode === "selected" && (
          <div className="flex flex-wrap gap-2 mb-3">
            {dsms.map((d) => {
              const id = d.id as string;
              const on = selectedDsms.includes(id);
              return (
                <button
                  key={id}
                  onClick={() =>
                    setSelectedDsms(on ? selectedDsms.filter((x) => x !== id) : [...selectedDsms, id])
                  }
                  className="px-3 py-[6px] rounded-full text-[12px] font-medium transition-all"
                  style={{
                    border: on ? "1.5px solid var(--color-ginos-red)" : "1px solid var(--color-line)",
                    background: on ? "var(--color-ginos-red-soft)" : "white",
                    color: on ? "var(--color-ginos-red)" : "var(--color-ink-2)",
                  }}
                >
                  {d.name as string}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveAccess}
            disabled={savingAccess}
            className="px-[14px] py-2 rounded-[9px] text-white text-[13px] font-medium disabled:opacity-60"
            style={{ background: "var(--color-ginos-red)" }}
          >
            {savingAccess ? "Saving…" : "Save access"}
          </button>
          {accessMessage && (
            <span className="text-[12px]" style={{ color: accessMessage.startsWith("Error") ? "var(--color-ginos-red)" : "var(--color-basil)" }}>
              {accessMessage}
            </span>
          )}
        </div>
      </div>

      {/* Usage by person, this month */}
      <div className="rounded-[12px] p-[16px]" style={{ border: "1px solid var(--color-line)" }}>
        <h4 className="text-[14px] font-semibold mb-3">Usage by person (this month)</h4>
        {usageByUser.length > 0 ? (
          <table className="w-full text-[12.5px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {["Person", "District", "Calls", "Tokens", "Est. cost"].map((h, i) => (
                  <th key={h} className="font-semibold text-[11px] tracking-[.06em] uppercase px-2 py-[8px]" style={{ color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-line)", textAlign: i < 2 ? "left" : "right" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usageByUser.map((u) => (
                <tr key={u.name}>
                  <td className="px-2 py-[8px] font-medium" style={{ borderBottom: "1px solid var(--color-line)" }}>{u.name}</td>
                  <td className="px-2 py-[8px]" style={{ borderBottom: "1px solid var(--color-line)", color: "var(--color-ink-3)" }}>{u.district}</td>
                  <td className="px-2 py-[8px] text-right font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>{u.calls}</td>
                  <td className="px-2 py-[8px] text-right font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>{u.tokens.toLocaleString()}</td>
                  <td className="px-2 py-[8px] text-right font-mono" style={{ borderBottom: "1px solid var(--color-line)" }}>${((u.tokens * 0.35) / 1_000_000).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[12px] py-2" style={{ color: "var(--color-ink-3)" }}>No AI calls this month</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
        <div className="flex flex-col gap-1 mt-3">
          <p className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
            Model: {config.default_model as string ?? "openai/gpt-4o-mini"}
          </p>
          <p className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
            Tokens this month: <span className="font-mono">{totalTokens.toLocaleString()}</span>
          </p>
          <p className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
            Est. cost this month: <span className="font-mono">${estMonthlyCost.toFixed(4)}</span>
          </p>
        </div>
      </div>

      <div>
        <h4 className="text-[14px] font-semibold mb-3">Recent Calls</h4>
        <div className="flex flex-col gap-1 max-h-[350px] overflow-y-auto">
          {calls.slice(0, 20).map((c) => {
            const user = c.profiles as { name: string } | null;
            const tokens = c.tokens_used as number ?? 0;
            const info = parseCallInfo(c.page_context as string);
            // Estimate per-call cost from tokens
            const perCallCost = info.cost || `$${((tokens * 0.35) / 1_000_000).toFixed(6)}`;

            return (
              <div key={c.id as string} className="flex items-center gap-3 text-[12px] py-2.5" style={{ borderBottom: "1px solid var(--color-line)" }}>
                <div
                  className="w-7 h-7 rounded-full grid place-items-center text-white font-bold text-[10px] shrink-0"
                  style={{ background: user?.name ? "var(--color-ginos-red)" : "var(--color-ink-3)" }}
                >
                  {user?.name?.charAt(0) ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{user?.name ?? "Unknown"}</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                    <span className="capitalize">{info.page}</span>
                    <span className="font-mono">{tokens} tkn</span>
                    {info.tokenBreakdown && <span className="font-mono">{info.tokenBreakdown}</span>}
                    <span className="font-mono" style={{ color: "var(--color-mustard)" }}>{perCallCost}</span>
                  </div>
                </div>
                <span className="font-mono text-[10px] shrink-0 text-right leading-tight" style={{ color: "var(--color-ink-3)" }}>
                  {new Date(c.called_at as string).toLocaleDateString()}<br />
                  {new Date(c.called_at as string).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })}
          {calls.length === 0 && <p className="text-[12px] py-4 text-center" style={{ color: "var(--color-ink-3)" }}>No AI calls yet</p>}
        </div>
      </div>
      </div>
    </div>
  );
}

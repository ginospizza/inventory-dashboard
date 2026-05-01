"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react";

type Stage = "idle" | "preview" | "uploading" | "done" | "error";

interface PreviewData {
  total_rows: number;
  sheets_count: number;
  weeks: number[];
  stores: string[];
  primary_count: number;
  secondary_count: number;
  unclassified_count: number;
  errors: string[];
}

interface UploadResult {
  upload_id: string;
  rows_processed: number;
  stores_processed: number;
  weeks_processed: number[];
  primary_count: number;
  secondary_count: number;
  unclassified_count: number;
}

export function UploadClient({ recentUploads }: { recentUploads: Record<string, unknown>[] }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setStage("preview");
    setError("");

    const formData = new FormData();
    formData.append("file", f);

    try {
      const res = await fetch("/api/upload?preview=true", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data);
    } catch (err) {
      setError(String(err));
      setStage("error");
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleProcess = useCallback(async () => {
    if (!file) return;
    setStage("uploading");
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    // Simulate progress
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + Math.random() * 15, 90));
    }, 300);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      clearInterval(interval);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setProgress(100);
      setResult(data);
      setTimeout(() => setStage("done"), 500);
    } catch (err) {
      clearInterval(interval);
      setError(String(err));
      setStage("error");
    }
  }, [file]);

  const reset = () => {
    setStage("idle");
    setFile(null);
    setPreview(null);
    setProgress(0);
    setResult(null);
    setError("");
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-5 mb-[22px]">
        <div>
          <h1 className="font-serif text-[28px] lg:text-[38px] leading-none" style={{ letterSpacing: "-0.015em" }}>Upload Data</h1>
          <p className="text-[13px] mt-[6px]" style={{ color: "var(--color-ink-3)" }}>Import weekly order data from the warehouse system</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-[18px]">
        {/* Left — Upload flow */}
        <div className="rounded-[14px] bg-white" style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}>
          {/* Idle */}
          {stage === "idle" && (
            <div
              className="p-10 flex flex-col items-center text-center cursor-default"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <div className="w-14 h-14 rounded-2xl grid place-items-center mb-5" style={{ background: "var(--color-ginos-red-soft)" }}>
                <Upload className="w-6 h-6" style={{ color: "var(--color-ginos-red)" }} />
              </div>
              <h3 className="font-serif text-[22px] mb-2" style={{ letterSpacing: "-0.01em" }}>
                Drop this week&apos;s order export here
              </h3>
              <p className="text-[13px] mb-5 max-w-sm" style={{ color: "var(--color-ink-3)" }}>
                Excel files (.xlsx, .xls) with columns: CompanyName, WeekNumber, productcode, description, TotalQty
              </p>
              <button
                onClick={() => fileRef.current?.click()}
                className="px-5 py-[10px] rounded-[9px] text-white text-[13px] font-medium"
                style={{ background: "var(--color-ginos-red)", boxShadow: "0 4px 14px rgba(226,35,26,.25), inset 0 1px 0 rgba(255,255,255,.18)" }}
              >
                Choose file
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          )}

          {/* Preview */}
          {stage === "preview" && preview && (
            <div className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <FileSpreadsheet className="w-5 h-5" style={{ color: "var(--color-basil)" }} />
                <div>
                  <div className="text-[14px] font-medium">{file?.name}</div>
                  <div className="text-[12px]" style={{ color: "var(--color-ink-3)" }}>
                    {(file?.size ?? 0 / 1024).toFixed(0)} KB
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <StatCard label="Total Rows" value={preview.total_rows} />
                <StatCard label="Primary" value={preview.primary_count} color="var(--color-basil)" />
                <StatCard label="Secondary" value={preview.secondary_count} color="var(--color-brand-ttd)" />
                <StatCard label="Unclassified" value={preview.unclassified_count} color="var(--color-mustard)" />
              </div>

              <div className="text-[12px] mb-4" style={{ color: "var(--color-ink-3)" }}>
                {preview.sheets_count} sheet{preview.sheets_count !== 1 ? "s" : ""} &middot;
                {preview.stores.length} stores &middot;
                Week{preview.weeks.length > 1 ? "s" : ""} {preview.weeks.join(", ")}
              </div>

              {preview.errors.length > 0 && (
                <div className="p-3 rounded-lg mb-4 text-[12px]" style={{ background: "var(--color-mustard-soft)", color: "var(--color-mustard)" }}>
                  {preview.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={reset} className="px-4 py-2 rounded-[9px] text-[13px] font-medium" style={{ border: "1px solid var(--color-line)" }}>
                  Cancel
                </button>
                <button onClick={handleProcess} className="px-5 py-2 rounded-[9px] text-white text-[13px] font-medium" style={{ background: "var(--color-ginos-red)", boxShadow: "0 4px 14px rgba(226,35,26,.25)" }}>
                  Confirm & process
                </button>
              </div>
            </div>
          )}

          {/* Uploading */}
          {stage === "uploading" && (
            <div className="p-10 flex flex-col items-center text-center">
              <h3 className="font-serif text-[22px] mb-4">Processing orders...</h3>
              <div className="w-full max-w-xs h-[6px] rounded-full overflow-hidden mb-3" style={{ background: "var(--color-crust)" }}>
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: "linear-gradient(90deg, var(--color-ginos-red), var(--color-ginos-red-deep))" }} />
              </div>
              <span className="font-mono text-[14px]">{Math.round(progress)}%</span>
            </div>
          )}

          {/* Done */}
          {stage === "done" && result && (
            <div className="p-10 flex flex-col items-center text-center">
              <CheckCircle2 className="w-12 h-12 mb-4" style={{ color: "var(--color-basil)" }} />
              <h3 className="font-serif text-[22px] mb-2">Upload complete</h3>
              <p className="text-[13px] mb-5" style={{ color: "var(--color-ink-3)" }}>
                {result.rows_processed} rows processed across {result.stores_processed} stores
              </p>
              <div className="flex gap-2">
                <button onClick={reset} className="px-4 py-2 rounded-[9px] text-[13px] font-medium" style={{ border: "1px solid var(--color-line)" }}>
                  Upload another
                </button>
                <button onClick={() => router.push("/overview")} className="px-5 py-2 rounded-[9px] text-white text-[13px] font-medium" style={{ background: "var(--color-ginos-red)" }}>
                  Open dashboard
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {stage === "error" && (
            <div className="p-10 flex flex-col items-center text-center">
              <AlertCircle className="w-12 h-12 mb-4" style={{ color: "var(--color-ginos-red)" }} />
              <h3 className="font-serif text-[22px] mb-2">Upload failed</h3>
              <p className="text-[13px] mb-5" style={{ color: "var(--color-ginos-red)" }}>{error}</p>
              <button onClick={reset} className="px-4 py-2 rounded-[9px] text-[13px] font-medium" style={{ border: "1px solid var(--color-line)" }}>
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Right — Recent uploads */}
        <div className="rounded-[14px] bg-white" style={{ border: "1px solid var(--color-line)", boxShadow: "var(--shadow-sm)" }}>
          <div className="px-[18px] py-[14px]" style={{ borderBottom: "1px solid var(--color-line)" }}>
            <h3 className="text-[14px] font-semibold">Recent Uploads</h3>
          </div>
          <div className="p-[18px]">
            {recentUploads.length > 0 ? (
              <div className="flex flex-col gap-3">
                {recentUploads.map((u) => (
                  <div key={u.id as string} className="flex items-center gap-3 text-[13px]">
                    <FileSpreadsheet className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-ink-3)" }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{u.filename as string}</div>
                      <div className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                        {u.rows_processed as number} rows &middot; {new Date(u.uploaded_at as string).toLocaleDateString()}
                      </div>
                    </div>
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: (u.status as string) === "completed" ? "var(--color-basil-soft)" : "var(--color-mustard-soft)",
                        color: (u.status as string) === "completed" ? "var(--color-basil)" : "var(--color-mustard)",
                      }}
                    >
                      {u.status as string}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-center py-4" style={{ color: "var(--color-ink-3)" }}>No uploads yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--color-line)" }}>
      <div className="text-[10px] font-semibold tracking-[.06em] uppercase mb-1" style={{ color: "var(--color-ink-3)" }}>{label}</div>
      <div className="font-serif text-[24px] leading-none" style={{ color: color ?? "var(--color-ink)" }}>{value.toLocaleString()}</div>
    </div>
  );
}

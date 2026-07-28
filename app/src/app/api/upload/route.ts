import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdminApi } from "@/lib/supabase/auth";
import { parseExcelFile, getUploadPreview } from "@/lib/excel-parser";
import {
  computeWeeklyMetrics,
  detectBrand,
  resolveStoreType,
  normalizeStoreCode,
  shouldIgnoreStore,
  recomputeRollingStatuses,
  type RollingStatusRow,
} from "@/lib/calculations";
import type { Product, RawOrderRow, Brand, StoreType, ComplianceStatus } from "@/lib/types";

/**
 * POST /api/upload
 *
 * Accepts an Excel file upload. Parses, classifies, computes metrics, and persists.
 *
 * Query params:
 *   ?preview=true — returns a preview without persisting
 *
 * Body: multipart/form-data with a "file" field
 */
export async function POST(request: NextRequest) {
  // Auth check — reads the browser's session cookie. A prior version called
  // .auth.getUser() on the service-role admin client, which has no session
  // and always returned "Not authenticated" no matter who was logged in.
  const auth = await requireSuperAdminApi();
  if (auth.error) return auth.error;
  const currentUser = auth.user;

  // Parse the file
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const parseResult = parseExcelFile(buffer);

  if (parseResult.rows.length === 0) {
    return NextResponse.json(
      {
        error: "No valid data rows found",
        details: parseResult.errors,
      },
      { status: 400 }
    );
  }

  // Preview mode — stats plus the safety checks the uploader must see before
  // confirming: unknown SKUs (which would NOT count toward estimates — the
  // root cause of the July clamshell discrepancy), brand-new stores, and rows
  // for ignored non-store entries (head offices, wholesalers).
  const isPreview = request.nextUrl.searchParams.get("preview") === "true";
  if (isPreview) {
    const admin = createAdminClient();

    // Classify rows against product table
    const { data: products } = await admin
      .from("products")
      .select("code, classification");

    const productMap = new Map(
      (products ?? []).map((p: { code: string; classification: string }) => [p.code, p.classification])
    );

    let primary = 0;
    let secondary = 0;
    let unclassified = 0;

    // Unknown SKUs, aggregated: code -> description + total qty ordered.
    const unknownSkus = new Map<string, { description: string; total_qty: number; stores: Set<string> }>();

    for (const row of parseResult.rows) {
      const cls = productMap.get(row.product_code);
      if (cls === "primary") primary++;
      else if (cls === "secondary") secondary++;
      else {
        unclassified++;
        if (!productMap.has(row.product_code)) {
          const u = unknownSkus.get(row.product_code) ?? { description: row.description, total_qty: 0, stores: new Set<string>() };
          u.total_qty += row.total_qty;
          u.stores.add(normalizeStoreCode(row.company_name));
          unknownSkus.set(row.product_code, u);
        }
      }
    }

    // Store checks against the normalized code, same rules as processing.
    const { data: dbStores } = await admin.from("stores").select("code");
    const knownCodes = new Set((dbStores ?? []).map((s: { code: string }) => s.code));
    const newStores = new Set<string>();
    const ignoredStores = new Set<string>();
    for (const raw of new Set(parseResult.rows.map((r) => r.company_name))) {
      const code = normalizeStoreCode(raw);
      if (shouldIgnoreStore(code)) ignoredStores.add(code);
      else if (!knownCodes.has(code)) newStores.add(code);
    }

    const preview = getUploadPreview(parseResult);
    return NextResponse.json({
      ...preview,
      primary_count: primary,
      secondary_count: secondary,
      unclassified_count: unclassified,
      unmapped_skus: [...unknownSkus.entries()].map(([code, u]) => ({
        code,
        description: u.description,
        total_qty: u.total_qty,
        store_count: u.stores.size,
      })),
      new_stores: [...newStores].sort(),
      ignored_stores: [...ignoredStores].sort(),
    });
  }

  // Full processing
  try {
    const admin = createAdminClient();
    const year = formData.get("year")
      ? Number(formData.get("year"))
      : new Date().getFullYear();

    // 1. Load product lookup
    const { data: products } = await admin.from("products").select("*");
    const productLookup = new Map<string, Product>();
    for (const p of products ?? []) {
      productLookup.set(p.code, p as Product);
    }

    // 2. Load store lookup (or create new stores). We need brand + store_type
    //    (drives the flour/dough calc path and paper-plate handling) and the
    //    store id (to fetch prior weeks for the rolling average).
    interface StoreInfo {
      id: string;
      brand: Brand;
      storeType: StoreType;
    }
    const storeMap = new Map<string, StoreInfo>();
    // Keyed by NORMALIZED store code — the raw export writes names
    // inconsistently ("GINOS002 NEW"); without normalizing, an upload would
    // create duplicate stores next to the canonical ones.
    const { data: existingStores } = await admin
      .from("stores")
      .select("id, code, brand");
    for (const s of existingStores ?? []) {
      const brand = (s.brand as Brand) ?? detectBrand(s.code);
      storeMap.set(normalizeStoreCode(s.code), {
        id: s.id,
        brand,
        // resolveStoreType honors the flour-method hybrid overrides (some PP/WM
        // stores make dough from flour like Gino's), else the brand default.
        storeType: resolveStoreType(s.code, brand),
      });
    }

    // Find genuinely new stores in the data (normalized, non-ignored)
    const uniqueStores = [
      ...new Set(parseResult.rows.map((r) => normalizeStoreCode(r.company_name))),
    ];
    const newStores = uniqueStores.filter(
      (code) => !storeMap.has(code) && !shouldIgnoreStore(code)
    );

    if (newStores.length > 0) {
      const storesToInsert = newStores.map((code) => {
        const brand = detectBrand(code);
        return { code, name: code, brand };
      });

      const { data: inserted } = await admin
        .from("stores")
        .insert(storesToInsert)
        .select("id, code, brand");

      for (const s of inserted ?? []) {
        const brand = (s.brand as Brand) ?? detectBrand(s.code);
        storeMap.set(normalizeStoreCode(s.code), {
          id: s.id,
          brand,
          storeType: resolveStoreType(s.code, brand),
        });
      }
    }

    // 3. Create upload record
    const weeks = [...new Set(parseResult.rows.map((r) => r.week_number))];
    const { data: upload } = await admin
      .from("uploads")
      .insert({
        filename: file.name,
        uploaded_by: currentUser.id,
        week_number: weeks.length === 1 ? weeks[0] : null,
        year,
        status: "processing",
        rows_processed: parseResult.rows.length,
      })
      .select("id")
      .single();

    if (!upload) {
      return NextResponse.json({ error: "Failed to create upload record" }, { status: 500 });
    }

    // 4. Group rows by normalized store + week, dropping ignored non-store
    // entries (head offices, wholesalers, SAPUTO/SUNDRY summary rows).
    const grouped = new Map<string, RawOrderRow[]>();
    let ignoredRowCount = 0;
    for (const row of parseResult.rows) {
      const normCode = normalizeStoreCode(row.company_name);
      if (shouldIgnoreStore(normCode)) {
        ignoredRowCount++;
        continue;
      }
      const key = `${normCode}__${row.week_number}`;
      const existing = grouped.get(key) ?? [];
      existing.push(row);
      grouped.set(key, existing);
    }

    // 5. Compute metrics for each store-week (PASS 1 — raw, no smoothing yet)
    let primaryCount = 0;
    let secondaryCount = 0;
    let unclassifiedCount = 0;
    const ordersToInsert: Record<string, unknown>[] = [];
    // Each computed metric, kept with the context the rolling-average pass needs.
    const computed: { storeId: string; weekNum: number; storeType: StoreType; metric: Record<string, unknown> }[] = [];

    for (const [key, rows] of grouped) {
      const storeCode = key.split("__")[0]; // normalized
      const weekNum = rows[0].week_number;
      const info = storeMap.get(storeCode);

      if (!info) continue;
      const storeId = info.id;

      // Insert raw orders
      for (const row of rows) {
        const product = productLookup.get(row.product_code);

        if (product) {
          if (product.classification === "primary") primaryCount++;
          else if (product.classification === "secondary") secondaryCount++;
          else unclassifiedCount++;
        } else {
          unclassifiedCount++;
        }

        ordersToInsert.push({
          upload_id: upload.id,
          store_id: storeId,
          product_id: product?.id ?? null,
          week_number: weekNum,
          year,
          quantity: row.total_qty,
          raw_company_name: row.company_name,
          raw_product_code: row.product_code,
          raw_description: row.description,
        });
      }

      // Compute metrics with the store's actual type + brand (plate handling).
      // Strip fields that exist on the metrics object but NOT as weekly_metrics
      // columns (boxes_clamshell / boxes_plates / boxes_party_21x15 — their
      // contribution is already folded into boxes_total and the estimates);
      // PostgREST rejects the whole upsert on any unknown key.
      const metrics = computeWeeklyMetrics(rows, productLookup, year, info.storeType, info.brand);
      const {
        store_id: _sid,
        store_code: _sc,
        boxes_clamshell: _bc,
        boxes_plates: _bp,
        boxes_party_21x15: _b21,
        ...metricFields
      } = metrics;
      computed.push({
        storeId,
        weekNum,
        storeType: info.storeType,
        metric: { ...metricFields, store_id: storeId, week_number: weekNum, year },
      });
    }

    // 5b. Metrics rows to write. The diff/overall status values here reflect
    // each week graded in ISOLATION (computeWeeklyMetrics's default when no
    // priorWeeks are passed) — step 7b below immediately recomputes and
    // overwrites the rolling-average status for every touched store from a
    // fresh, fully-committed read, so these are never what gets displayed.
    const metricsToInsert: Record<string, unknown>[] = computed.map((c) => c.metric);

    // 6. Batch insert orders (in chunks of 500)
    for (let i = 0; i < ordersToInsert.length; i += 500) {
      const chunk = ordersToInsert.slice(i, i + 500);
      await admin.from("weekly_orders").insert(chunk);
    }

    // 7. Upsert metrics (replace existing store-week if re-uploaded)
    for (const m of metricsToInsert) {
      await admin
        .from("weekly_metrics")
        .upsert(m, { onConflict: "store_id,year,week_number" });
    }

    // 7b. Recompute rolling-average STATUS for every touched store from a
    // fresh, fully-committed read of its whole year — one query in, one
    // batched write out. This is the SAME canonical recompute
    // (recomputeRollingStatuses) the rescore-metrics.ts backfill script
    // uses, run here against real persisted data rather than an in-memory
    // reconstruction of "prior weeks" — so upload-time and backfill-time
    // status can never drift apart again. (A GINOS008 week-27 case, James,
    // July 10 2026, showed the old in-memory windowing landing on "bad" when
    // a fresh recompute against the same underlying data said "warn.")
    // Re-scoring the WHOLE year (not just the uploaded weeks) also means a
    // corrected re-upload of an OLDER week properly refreshes every later
    // week whose rolling average depends on it.
    const touchedStoreIds = [...new Set(computed.map((c) => c.storeId))];
    if (touchedStoreIds.length > 0) {
      // PAGINATE. Supabase caps a REST response at 1000 rows, and this reads
      // every week of the year for every touched store — ~150 stores x ~29 weeks
      // is well over 4000. Unpaginated, it silently returned only the first
      // ~1000, so most stores never had their rolling status written at all and
      // kept the week-in-ISOLATION value from step 5b, while the stores that were
      // partially included got recomputed against a TRUNCATED series.
      //
      // James spotted the symptom on 2026-07-28: a Compare row whose explanation
      // said every metric was in band on the 6-week average sat next to a Severe
      // pill. 85 of 148 stores were wrong on week 29, plus scattered damage in
      // weeks 1-7 (the truncated-series stores). Every other multi-row read in
      // the app already loops like this; this one was missed.
      const yearRows: Record<string, unknown>[] = [];
      const SELECT_COLS =
        "store_id, week_number, store_type, cheese_ordered_oz, sauce_ordered_floz, flour_ordered_kg, dough_ordered_kg, cheese_estimated_oz, sauce_estimated_floz, flour_estimated_kg, dough_estimated_kg, sauce_cheese_status, flour_cheese_status, dough_cheese_status, cheese_status, sauce_status, flour_status, dough_status, overall_status";
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("weekly_metrics")
          .select(SELECT_COLS)
          .in("store_id", touchedStoreIds)
          .eq("year", year)
          .order("store_id", { ascending: true })
          .order("week_number", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) {
          console.error("rolling-status read failed:", error);
          break;
        }
        if (!data || data.length === 0) break;
        yearRows.push(...(data as unknown as Record<string, unknown>[]));
        if (data.length < PAGE) break;
      }

      type YearRow = {
        store_id: string;
        week_number: number;
        store_type: StoreType;
        cheese_ordered_oz: number;
        sauce_ordered_floz: number;
        flour_ordered_kg: number;
        dough_ordered_kg: number;
        cheese_estimated_oz: number;
        sauce_estimated_floz: number;
        flour_estimated_kg: number;
        dough_estimated_kg: number;
        cheese_status: string;
        sauce_status: string;
        flour_status: string;
        dough_status: string;
        sauce_cheese_status: string;
        flour_cheese_status: string;
        dough_cheese_status: string;
        overall_status: string;
      };
      const rowsByStore = new Map<string, YearRow[]>();
      for (const r of yearRows as unknown as YearRow[]) {
        const arr = rowsByStore.get(r.store_id) ?? [];
        arr.push(r);
        rowsByStore.set(r.store_id, arr);
      }

      const statusUpdates: Record<string, unknown>[] = [];
      for (const [storeId, rows] of rowsByStore) {
        rows.sort((a, b) => a.week_number - b.week_number);
        const inputs: RollingStatusRow[] = rows.map((r) => ({
          cheese_ordered_oz: r.cheese_ordered_oz || 0,
          sauce_ordered_floz: r.sauce_ordered_floz || 0,
          flour_ordered_kg: r.flour_ordered_kg || 0,
          dough_ordered_kg: r.dough_ordered_kg || 0,
          cheese_estimated_oz: r.cheese_estimated_oz || 0,
          sauce_estimated_floz: r.sauce_estimated_floz || 0,
          flour_estimated_kg: r.flour_estimated_kg || 0,
          dough_estimated_kg: r.dough_estimated_kg || 0,
          store_type: r.store_type as StoreType,
        }));
        const results = recomputeRollingStatuses(inputs);

        rows.forEach((r, i) => {
          const next = results[i];
          // Any of the seven status fields changing counts (ratio statuses are
          // smoothed now too, so overall can be unchanged while a ratio moves).
          const changed =
            next.overall_status !== r.overall_status ||
            next.cheese_status !== r.cheese_status ||
            next.sauce_status !== r.sauce_status ||
            next.flour_status !== r.flour_status ||
            next.dough_status !== r.dough_status ||
            next.sauce_cheese_status !== r.sauce_cheese_status ||
            next.flour_cheese_status !== r.flour_cheese_status ||
            next.dough_cheese_status !== r.dough_cheese_status;
          if (changed) {
            statusUpdates.push({
              store_id: storeId,
              year,
              week_number: r.week_number,
              cheese_status: next.cheese_status,
              sauce_status: next.sauce_status,
              flour_status: next.flour_status,
              dough_status: next.dough_status,
              sauce_cheese_status: next.sauce_cheese_status,
              flour_cheese_status: next.flour_cheese_status,
              dough_cheese_status: next.dough_cheese_status,
              overall_status: next.overall_status,
            });
          }
        });
      }

      for (let i = 0; i < statusUpdates.length; i += 500) {
        const chunk = statusUpdates.slice(i, i + 500);
        await admin.from("weekly_metrics").upsert(chunk, { onConflict: "store_id,year,week_number" });
      }
    }

    // 8. Update upload record
    await admin
      .from("uploads")
      .update({
        status: "completed",
        primary_count: primaryCount,
        secondary_count: secondaryCount,
        unclassified_count: unclassifiedCount,
      })
      .eq("id", upload.id);

    return NextResponse.json({
      success: true,
      upload_id: upload.id,
      rows_processed: parseResult.rows.length,
      rows_ignored: ignoredRowCount,
      stores_processed: grouped.size,
      weeks_processed: weeks,
      primary_count: primaryCount,
      secondary_count: secondaryCount,
      unclassified_count: unclassifiedCount,
    });
  } catch (err) {
    console.error("Upload processing error:", err);
    return NextResponse.json(
      { error: "Processing failed", details: String(err) },
      { status: 500 }
    );
  }
}

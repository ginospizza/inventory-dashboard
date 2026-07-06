import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseExcelFile, getUploadPreview } from "@/lib/excel-parser";
import {
  computeWeeklyMetrics,
  detectBrand,
  defaultStoreType,
  smoothedDiffStatuses,
  overallStatus,
  type RollingWeek,
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
  // Auth check
  const supabase = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Check admin role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  // Preview mode — just return stats
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

    for (const row of parseResult.rows) {
      const cls = productMap.get(row.product_code);
      if (cls === "primary") primary++;
      else if (cls === "secondary") secondary++;
      else unclassified++;
    }

    const preview = getUploadPreview(parseResult);
    return NextResponse.json({
      ...preview,
      primary_count: primary,
      secondary_count: secondary,
      unclassified_count: unclassified,
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
    const { data: existingStores } = await admin
      .from("stores")
      .select("id, code, brand, store_type");
    for (const s of existingStores ?? []) {
      const brand = (s.brand as Brand) ?? detectBrand(s.code);
      storeMap.set(s.code, {
        id: s.id,
        brand,
        // Respect an admin-assigned store_type (e.g. PP/WM stores); otherwise
        // fall back to the brand default.
        storeType: (s.store_type as StoreType) ?? defaultStoreType(brand),
      });
    }

    // Find new stores in the data
    const uniqueStores = [...new Set(parseResult.rows.map((r) => r.company_name))];
    const newStores = uniqueStores.filter((code) => !storeMap.has(code));

    if (newStores.length > 0) {
      const storesToInsert = newStores.map((code) => {
        const brand = detectBrand(code);
        return { code, name: code, brand, store_type: defaultStoreType(brand) };
      });

      const { data: inserted } = await admin
        .from("stores")
        .insert(storesToInsert)
        .select("id, code, brand, store_type");

      for (const s of inserted ?? []) {
        const brand = (s.brand as Brand) ?? detectBrand(s.code);
        storeMap.set(s.code, {
          id: s.id,
          brand,
          storeType: (s.store_type as StoreType) ?? defaultStoreType(brand),
        });
      }
    }

    // 3. Create upload record
    const weeks = [...new Set(parseResult.rows.map((r) => r.week_number))];
    const { data: upload } = await admin
      .from("uploads")
      .insert({
        filename: file.name,
        uploaded_by: user.id,
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

    // 4. Group rows by store + week
    const grouped = new Map<string, RawOrderRow[]>();
    for (const row of parseResult.rows) {
      const key = `${row.company_name}__${row.week_number}`;
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

    for (const [, rows] of grouped) {
      const storeCode = rows[0].company_name;
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
      const metrics = computeWeeklyMetrics(rows, productLookup, year, info.storeType, info.brand);
      const { store_id: _sid, store_code: _sc, ...metricFields } = metrics;
      computed.push({
        storeId,
        weekNum,
        storeType: info.storeType,
        metric: { ...metricFields, store_id: storeId, week_number: weekNum, year },
      });
    }

    // 5b. PASS 2 — apply the 4-week rolling average to each uploaded week's STATUS.
    // The window is the current week plus up to 3 prior weeks, drawn from BOTH this
    // upload and weeks already in the database. Smoothing both orders and
    // box-expected (inside smoothedDiffStatuses) is what stops a single stock-up
    // week from tripping At Risk. Without this pass uploads were graded in isolation.
    const toRollingWeek = (m: Record<string, unknown>): RollingWeek => ({
      cheese_ordered_oz: Number(m.cheese_ordered_oz) || 0,
      sauce_ordered_floz: Number(m.sauce_ordered_floz) || 0,
      flour_ordered_kg: Number(m.flour_ordered_kg) || 0,
      dough_ordered_kg: Number(m.dough_ordered_kg) || 0,
      cheese_estimated_oz: Number(m.cheese_estimated_oz) || 0,
      sauce_estimated_floz: Number(m.sauce_estimated_floz) || 0,
      flour_estimated_kg: Number(m.flour_estimated_kg) || 0,
      dough_estimated_kg: Number(m.dough_estimated_kg) || 0,
    });

    // Per store: week_number -> RollingWeek, seeded from prior DB weeks then
    // overlaid with this batch's freshly computed weeks (batch wins on conflict).
    const windowByStore = new Map<string, Map<number, RollingWeek>>();
    const touchedStoreIds = [...new Set(computed.map((c) => c.storeId))];
    if (touchedStoreIds.length > 0) {
      const { data: priorRows } = await admin
        .from("weekly_metrics")
        .select(
          "store_id, week_number, cheese_ordered_oz, sauce_ordered_floz, flour_ordered_kg, dough_ordered_kg, cheese_estimated_oz, sauce_estimated_floz, flour_estimated_kg, dough_estimated_kg"
        )
        .in("store_id", touchedStoreIds)
        .eq("year", year);
      for (const r of priorRows ?? []) {
        const wk = windowByStore.get(r.store_id) ?? new Map<number, RollingWeek>();
        wk.set(r.week_number as number, toRollingWeek(r as Record<string, unknown>));
        windowByStore.set(r.store_id, wk);
      }
    }
    for (const c of computed) {
      const wk = windowByStore.get(c.storeId) ?? new Map<number, RollingWeek>();
      wk.set(c.weekNum, toRollingWeek(c.metric));
      windowByStore.set(c.storeId, wk);
    }

    const metricsToInsert: Record<string, unknown>[] = computed.map((c) => {
      const weeks = windowByStore.get(c.storeId)!;
      // Up to 3 most-recent weeks strictly before this one (gap-tolerant).
      const prior = [...weeks.entries()]
        .filter(([w]) => w < c.weekNum)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 3)
        .map(([, rw]) => rw);

      const { cheese_status, sauce_status, flour_status, dough_status } = smoothedDiffStatuses(
        toRollingWeek(c.metric),
        prior,
        c.storeType
      );

      const ratioStatuses: ComplianceStatus[] =
        c.storeType === "flour"
          ? [c.metric.sauce_cheese_status as ComplianceStatus, c.metric.flour_cheese_status as ComplianceStatus]
          : [c.metric.sauce_cheese_status as ComplianceStatus, c.metric.dough_cheese_status as ComplianceStatus];
      const diffStatuses: ComplianceStatus[] =
        c.storeType === "flour"
          ? [cheese_status, sauce_status, flour_status]
          : [cheese_status, sauce_status, dough_status];

      return {
        ...c.metric,
        cheese_status,
        sauce_status,
        flour_status,
        dough_status,
        overall_status: overallStatus([...diffStatuses, ...ratioStatuses]),
      };
    });

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

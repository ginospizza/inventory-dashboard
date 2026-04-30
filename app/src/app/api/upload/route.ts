import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseExcelFile, getUploadPreview } from "@/lib/excel-parser";
import { computeWeeklyMetrics, detectBrand } from "@/lib/calculations";
import type { Product, RawOrderRow } from "@/lib/types";

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
  const supabase = await createClient();
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

    // 2. Load store lookup (or create new stores)
    const { data: existingStores } = await admin.from("stores").select("id, code");
    const storeMap = new Map<string, string>();
    for (const s of existingStores ?? []) {
      storeMap.set(s.code, s.id);
    }

    // Find new stores in the data
    const uniqueStores = [...new Set(parseResult.rows.map((r) => r.company_name))];
    const newStores = uniqueStores.filter((code) => !storeMap.has(code));

    if (newStores.length > 0) {
      const storesToInsert = newStores.map((code) => ({
        code,
        name: code,
        brand: detectBrand(code),
      }));

      const { data: inserted } = await admin
        .from("stores")
        .insert(storesToInsert)
        .select("id, code");

      for (const s of inserted ?? []) {
        storeMap.set(s.code, s.id);
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

    // 5. Compute metrics for each store-week
    let primaryCount = 0;
    let secondaryCount = 0;
    let unclassifiedCount = 0;
    const metricsToInsert: Record<string, unknown>[] = [];
    const ordersToInsert: Record<string, unknown>[] = [];

    for (const [, rows] of grouped) {
      const storeCode = rows[0].company_name;
      const weekNum = rows[0].week_number;
      const storeId = storeMap.get(storeCode);

      if (!storeId) continue;

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

      // Compute metrics
      const metrics = computeWeeklyMetrics(rows, productLookup, year);
      const { store_id: _sid, store_code: _sc, ...metricFields } = metrics;
      metricsToInsert.push({
        ...metricFields,
        store_id: storeId,
        week_number: weekNum,
        year,
      });
    }

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

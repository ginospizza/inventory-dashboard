import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdminApi } from "@/lib/supabase/auth";

/**
 * Super-admin product catalog management (James, July 31 2026: "add a function
 * for the Admin user to change the Product classifications please? Like adding
 * new SKUs, SKU type, change pack size, assigning primary or secondary").
 *
 * Two caveats the UI surfaces, worth knowing here too:
 *   - weight/weight_unit are what the engine MULTIPLIES BY (a cheese SKU's kg,
 *     a sauce SKU's fl oz, a clamshell's units-per-case), so they matter more
 *     than they look
 *   - changes affect FUTURE uploads only; historical metrics keep the values
 *     they were computed with (a re-import is the tool for rewriting history)
 */

const PRODUCT_TYPES = new Set([
  "Cheese", "Pizza Sauce", "Flour", "Dough", "Packaging", "Wing Box", "Secondary", "Other",
]);
const CLASSIFICATIONS = new Set(["primary", "secondary", "neither"]);

function validate(body: Record<string, unknown>, requireAll: boolean): string | null {
  const { code, description, type, classification, weight } = body;
  if (requireAll && (!code || !description)) return "Code and description are required";
  if (code !== undefined && !String(code).trim()) return "Code cannot be empty";
  if (type !== undefined && !PRODUCT_TYPES.has(String(type)))
    return `Type must be one of: ${[...PRODUCT_TYPES].join(", ")}`;
  if (classification !== undefined && !CLASSIFICATIONS.has(String(classification)))
    return "Classification must be primary, secondary or neither";
  if (weight !== undefined && (!Number.isFinite(Number(weight)) || Number(weight) < 0))
    return "Weight must be a non-negative number";
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.error) return auth.error;
  const admin = createAdminClient();

  const body = await request.json();
  const err = validate(body, true);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const { data, error } = await admin
    .from("products")
    .insert({
      code: String(body.code).trim(),
      description: String(body.description).trim(),
      type: body.type ?? "Other",
      classification: body.classification ?? "neither",
      pack_size: body.pack_size ?? "",
      weight: Number(body.weight ?? 0),
      weight_unit: body.weight_unit ?? "each",
    })
    .select("id, code")
    .single();

  if (error) {
    const msg = error.message.includes("duplicate")
      ? `A product with code "${body.code}" already exists`
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ success: true, product: data });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.error) return auth.error;
  const admin = createAdminClient();

  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const err = validate(body, false);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const patch: Record<string, unknown> = {};
  for (const f of ["code", "description", "type", "classification", "pack_size", "weight", "weight_unit"]) {
    if (body[f] !== undefined) patch[f] = f === "weight" ? Number(body[f]) : body[f];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await admin.from("products").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.error) return auth.error;
  const admin = createAdminClient();

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // weekly_orders.product_id is ON DELETE SET NULL — deleting a product with
  // order history silently unlinks every historical line from its product,
  // which would make it vanish from the Secondary Products tab and YoY.
  // Blocked: reclassify to "neither" instead if it should stop counting.
  const { count } = await admin
    .from("weekly_orders")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `This product has ${count} historical order lines. Deleting it would unlink them all — set its classification to "neither" instead if it should stop counting.`,
      },
      { status: 409 }
    );
  }

  const { error } = await admin.from("products").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdminApi } from "@/lib/supabase/auth";
import { reloadEngineConfig } from "@/lib/calculations/config-loader";
import {
  DEFAULT_ENGINE_CONFIG,
  validateEngineConfig,
  type BoxBucket,
  type EngineConfig,
} from "@/lib/calculations/engine-config";

/**
 * Super-admin editing of the grading thresholds and usage assumptions
 * (James, July 31 2026). Writes the two thresholds rows and the eight
 * usage_assumptions rows, then reloads the active engine config so new
 * uploads grade with the new values immediately.
 *
 * Historical statuses stay graded with the OLD values until a re-score runs —
 * the admin UI surfaces that and offers /api/rescore with a dry-run preview.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.error) return auth.error;
  const admin = createAdminClient();

  const body = await request.json();
  const { pct, ratio, assumptions } = body as {
    pct: EngineConfig["pct"];
    ratio: EngineConfig["ratio"];
    assumptions?: {
      pizza_size: string; cheese_oz: number; sauce_oz: number;
      dough_kg: number; pizza_sales_per_case: number;
    }[];
  };

  // Build a full config and validate it as a whole — the same validation the
  // UI runs, re-checked server-side.
  const candidate: EngineConfig = {
    pct: {
      warn: Number(pct?.warn),
      bad: Number(pct?.bad),
      severe: Number(pct?.severe),
    },
    ratio: {
      ok_low: Number(ratio?.ok_low), ok_high: Number(ratio?.ok_high),
      warn_low: Number(ratio?.warn_low), warn_high: Number(ratio?.warn_high),
      bad_low: Number(ratio?.bad_low), bad_high: Number(ratio?.bad_high),
    },
    boxRatios: { ...DEFAULT_ENGINE_CONFIG.boxRatios },
    pizzaSales: { ...DEFAULT_ENGINE_CONFIG.pizzaSales },
  };
  for (const a of assumptions ?? []) {
    const bucket = a.pizza_size as BoxBucket;
    if (!(bucket in candidate.boxRatios)) {
      return NextResponse.json({ error: `Unknown box bucket "${a.pizza_size}"` }, { status: 400 });
    }
    candidate.boxRatios[bucket] = {
      cheese_oz: Number(a.cheese_oz),
      sauce_oz: Number(a.sauce_oz),
      dough_kg: Number(a.dough_kg),
    };
    candidate.pizzaSales[bucket] = Number(a.pizza_sales_per_case);
  }

  const allNums = [
    ...Object.values(candidate.pct), ...Object.values(candidate.ratio),
    ...Object.values(candidate.boxRatios).flatMap((v) => Object.values(v)),
    ...Object.values(candidate.pizzaSales),
  ];
  if (allNums.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "All values must be numbers" }, { status: 400 });
  }
  const errors = validateEngineConfig(candidate);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  // Write the two rule rows.
  const { error: diffErr } = await admin
    .from("thresholds")
    .update({ warn_value: candidate.pct.warn, bad_value: candidate.pct.bad, severe_value: candidate.pct.severe })
    .eq("metric", "ingredient_diff_pct");
  if (diffErr) return NextResponse.json({ error: diffErr.message }, { status: 400 });

  const { error: ratioErr } = await admin
    .from("thresholds")
    .update({ ...candidate.ratio })
    .eq("metric", "ratio_bands");
  if (ratioErr) return NextResponse.json({ error: ratioErr.message }, { status: 400 });

  // Write the assumption rows that were provided.
  for (const a of assumptions ?? []) {
    const bucket = a.pizza_size as BoxBucket;
    const { error } = await admin
      .from("usage_assumptions")
      .update({
        cheese_oz: candidate.boxRatios[bucket].cheese_oz,
        sauce_oz: candidate.boxRatios[bucket].sauce_oz,
        dough_kg: candidate.boxRatios[bucket].dough_kg,
        pizza_sales_per_case: candidate.pizzaSales[bucket],
      })
      .eq("pizza_size", a.pizza_size);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // New uploads grade with the new values immediately.
  await reloadEngineConfig();

  return NextResponse.json({ success: true });
}

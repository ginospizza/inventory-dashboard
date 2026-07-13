/**
 * AI Insights accuracy eval.
 *
 * Runs the PRODUCTION system prompt (src/lib/ai/prompts.ts) against James's
 * labeled TTD dataset (3 stores x ~5 months) and prints the AI's diagnosis
 * next to James's expert answer key, so we can see whether the model's
 * reasoning matches the domain expert's.
 *
 * Usage:
 *   node --env-file=.env.local scripts/eval-ai.mjs [path-to-xlsx]
 *
 * Requires OPENROUTER_API_KEY in the environment (loaded from .env.local).
 */

import XLSX from "xlsx";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { SYSTEM_PROMPT, buildStorePrompt, buildOverviewPrompt, signedPct } from "../src/lib/ai/prompts.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const XLSX_PATH =
  process.argv[2] ||
  resolve(process.env.HOME ?? "", "Downloads/TTD June 16.xlsx");

const MODEL = process.env.EVAL_MODEL || "openai/gpt-4o-mini";

// ── James's answer key (from his June 16 message) ───────────────────────────
const ANSWER_KEY = {
  Welland: {
    label: "CONTROL — compliant",
    expected:
      "Healthy/compliant control store. All diffs near zero, ratios in band. No outside-supplier or portioning finding expected.",
  },
  "St Cath": {
    label: "Cheese bought outside",
    expected:
      "Cheese purchased from an outside supplier. Cheese way under on box ratio; S:C and F:C ratios both OVER; flour also under; sauce on-target (so data is sound, since branded sauce is least likely swapped). Recommend: regional manager inspect store regularly for unauthorized products.",
  },
  Milton: {
    label: "Cheese bought outside + flour wastage",
    expected:
      "Cheese purchased from an outside supplier (ratios indicate it, sauce in ratio). ALSO flour consumption too high with weekly spikes -> wastage / portioning / overstocking. Recommend: inspect for unauthorized cheese AND review flour usage on site / retrain.",
  },
};

// ── Synthetic OVERVIEW regression cases ─────────────────────────────────────
// These exercise the overview prompt path (the network "AI Insights" button),
// which is where the STORE 070 "in ratio" miss happened: the worstStores payload
// must now carry sc_ratio / fc_ratio so the model can SEE that a ratio is out of
// band. Each case is a hand-built network context plus the answer it must reach.
const OVERVIEW_CASES = [
  {
    name: "STORE 070 — cheese under, S:C blown out of band",
    // Mirrors the live worstStores payload shape after the ratio-enrichment fix.
    context: {
      compliance_pct: 13.6,
      avg_cheese_diff: 3.0,
      avg_sauce_diff: 0.4,
      currentWeek: 15,
      worstStores: [
        {
          store: "STORE 070",
          cheese_diff: -9.5,
          sauce_diff: -1.6,
          flour_diff: -0.4,
          cheese_pct: -48, // cheese far under box-expected
          sauce_pct: 3, // sauce roughly on-target -> box baseline is sound
          flour_pct: -6,
          sc_ratio: 2.091, // 209.1% — far ABOVE the 1.25 band
          fc_ratio: 1.74,
          status: "bad",
        },
      ],
      anomalyCount: 14,
      anomalySummary: { critical: 9, warning: 3, info: 2 },
    },
    expected:
      "STORE 070's S:C ratio (209%) and F:C (174%) are well ABOVE the 0.75-1.25 band — cheese is under-ordered relative to sauce/flour. Sauce is roughly on-target, so the box baseline is sound. Diagnosis: cheese specifically is being purchased OUTSIDE. The model must NOT call cheese and sauce 'in ratio with each other' (a 209% ratio is out of band), and must NOT lump 'over-portioning' onto a cheese-UNDER store.",
  },
];

// ── Parse a store pivot sheet into aggregated metrics ───────────────────────
function colIdx(header, name) {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`Column not found: ${name}`);
  return i;
}

function buildStoreContext(wb, sheetName) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
  });
  const hdr = rows[0];
  const ix = {
    week: 0,
    cheeseOrdered: colIdx(hdr, "Cheese oz"),
    cheeseNeeded: colIdx(hdr, "Cheese needed"),
    cheeseDiffCase: colIdx(hdr, "Cheese Diff Case"),
    flourDiffBag: colIdx(hdr, "Flour Diff Bag"),
    sauceOrdered: colIdx(hdr, "Sauce fl oz"),
    sauceNeeded: colIdx(hdr, "Sauce Needed"),
    sauceDiffCase: colIdx(hdr, "Sauce Diff Case"),
    sc: colIdx(hdr, "Sauce to Cheese"),
    fc: colIdx(hdr, "Flour to Cheese"),
  };

  const data = rows.slice(1).filter((r) => typeof r[ix.week] === "number");
  const num = (r, k) => Number(r[ix[k]]) || 0;
  const avg = (k) => data.reduce((a, r) => a + num(r, k), 0) / data.length;
  const round = (n, d = 2) => Number(n.toFixed(d));

  // Cheese diff as % of expected, derived from oz totals (matches engine's pct basis)
  const totCheeseOrd = data.reduce((a, r) => a + num(r, "cheeseOrdered"), 0);
  const totCheeseNeed = data.reduce((a, r) => a + num(r, "cheeseNeeded"), 0);
  const totSauceOrd = data.reduce((a, r) => a + num(r, "sauceOrdered"), 0);
  const totSauceNeed = data.reduce((a, r) => a + num(r, "sauceNeeded"), 0);
  const pct = (ord, need) => (need ? round(((ord - need) / need) * 100, 1) : null);

  // Per-week history (chronological), matching the shape the live store page sends.
  // Includes the precomputed signed % vs box-expected (same signedPct the live app
  // uses) so the eval tests the exact payload production now sends. The eval xlsx
  // carries cheese/sauce ordered+needed per week but not flour, so flour_pct is null.
  const history = data.map((r) => ({
    week: num(r, "week"),
    cheese_diff: round(num(r, "cheeseDiffCase")),
    sauce_diff: round(num(r, "sauceDiffCase")),
    flour_diff: round(num(r, "flourDiffBag")),
    cheese_pct: signedPct(num(r, "cheeseOrdered"), num(r, "cheeseNeeded")),
    sauce_pct: signedPct(num(r, "sauceOrdered"), num(r, "sauceNeeded")),
    flour_pct: null,
    cheese_est: num(r, "cheeseNeeded"),
    sauce_est: num(r, "sauceNeeded"),
    sc_ratio: round(num(r, "sc"), 3),
    fc_ratio: round(num(r, "fc"), 3),
  }));

  // "Latest week" = the most recent row, mirroring the live app's `latest`.
  const lastRow = data[data.length - 1];
  const latest = {
    week_number: num(lastRow, "week"),
    cheese_diff: round(num(lastRow, "cheeseDiffCase")),
    sauce_diff: round(num(lastRow, "sauceDiffCase")),
    flour_diff: round(num(lastRow, "flourDiffBag")),
    cheese_pct: signedPct(num(lastRow, "cheeseOrdered"), num(lastRow, "cheeseNeeded")),
    sauce_pct: signedPct(num(lastRow, "sauceOrdered"), num(lastRow, "sauceNeeded")),
    flour_pct: null,
    sauce_cheese_ratio: round(num(lastRow, "sc"), 3),
    flour_cheese_ratio: round(num(lastRow, "fc"), 3),
  };

  return {
    store: `TTD ${sheetName.toUpperCase()}`,
    weeks_of_data: data.length,
    // aggregates kept only for the console summary line, not sent to the model
    summary: {
      cheese_pct: pct(totCheeseOrd, totCheeseNeed),
      sauce_pct: pct(totSauceOrd, totSauceNeed),
      flour_avg_bags: round(avg("flourDiffBag")),
      sc_avg: round(avg("sc"), 3),
      fc_avg: round(avg("fc"), 3),
    },
    latest,
    history,
  };
}

async function callModel(userPrompt, { json = false } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1500,
      temperature: 0.3,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data)}`);
  return data.choices?.[0]?.message?.content ?? "(no content)";
}

// Mirrors the production /api/ai route's handling of the store-level
// structured response: JSON with summary/recommendation/details, formatted
// here for readability. Falls back to the raw string if parsing fails.
function formatStoreOutput(raw) {
  try {
    const parsed = JSON.parse(raw);
    return (
      `SUMMARY: ${parsed.summary ?? "(none)"}\n\n` +
      `RECOMMENDATION: ${parsed.recommendation ?? "(none)"}\n\n` +
      `DETAILS:\n${parsed.details ?? "(none)"}`
    );
  } catch {
    return raw;
  }
}

async function main() {
  console.log(`\nAI Insights accuracy eval`);
  console.log(`Model: ${MODEL}`);
  console.log(`Dataset: ${XLSX_PATH}\n`);

  // ── Synthetic overview regression cases (no xlsx required) ────────────────
  for (const c of OVERVIEW_CASES) {
    const userPrompt = buildOverviewPrompt(c.context);
    const aiOutput = await callModel(userPrompt);
    console.log("============================================================");
    console.log(`OVERVIEW CASE: ${c.name}`);
    console.log("============================================================");
    console.log(`\n--- EXPECTED ---`);
    console.log(c.expected);
    console.log(`\n--- AI OUTPUT ---`);
    console.log(aiOutput.trim());
    console.log("");
  }

  // ── James's labeled store dataset (requires the xlsx) ─────────────────────
  if (!existsSync(XLSX_PATH)) {
    console.log(
      `\n(Skipping labeled store eval — xlsx not found at ${XLSX_PATH}. ` +
        `Pass a path as argv[2] to run it.)\n`
    );
    console.log("Done.\n");
    return;
  }

  const wb = XLSX.readFile(XLSX_PATH);
  const sheets = ["Welland", "St Cath", "Milton"];

  for (const sheet of sheets) {
    const ctx = buildStoreContext(wb, sheet);
    // Use the PRODUCTION prompt builder with the live {store, latest, history} shape.
    const userPrompt = buildStorePrompt({
      store: ctx.store,
      latest: ctx.latest,
      history: ctx.history,
    });
    const aiOutput = await callModel(userPrompt, { json: true });
    const key = ANSWER_KEY[sheet];
    const s = ctx.summary;

    console.log("============================================================");
    console.log(`STORE: ${ctx.store}   (${ctx.weeks_of_data} weeks)`);
    console.log("============================================================");
    console.log(
      `aggregate: cheese ${s.cheese_pct}% | sauce ${s.sauce_pct}% | flour avg ${s.flour_avg_bags} bags | S:C ${s.sc_avg} | F:C ${s.fc_avg}`
    );
    console.log(`\n--- JAMES (expected: ${key.label}) ---`);
    console.log(key.expected);
    console.log(`\n--- AI OUTPUT ---`);
    console.log(formatStoreOutput(aiOutput.trim()));
    console.log("");
  }
  console.log("Done. Compare each AI OUTPUT against the JAMES expected answer.\n");
}

main().catch((e) => {
  console.error("Eval failed:", e.message);
  process.exit(1);
});

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
import { SYSTEM_PROMPT } from "../src/lib/ai/prompts.ts";

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

  return {
    store: `TTD ${sheetName.toUpperCase()}`,
    weeks_of_data: data.length,
    baseline: "averaged across all available weeks (5 months)",
    cheese: {
      avg_diff_cases: round(avg("cheeseDiffCase")),
      diff_pct_of_expected: pct(totCheeseOrd, totCheeseNeed),
    },
    sauce: {
      avg_diff_cases: round(avg("sauceDiffCase")),
      diff_pct_of_expected: pct(totSauceOrd, totSauceNeed),
    },
    flour: {
      avg_diff_bags: round(avg("flourDiffBag")),
      weekly_diff_bags_series: data.map((r) => round(num(r, "flourDiffBag"))),
    },
    ratios: {
      sauce_to_cheese_avg: round(avg("sc"), 3),
      flour_to_cheese_avg: round(avg("fc"), 3),
      target_band: "0.75 – 1.25",
    },
  };
}

function buildEvalUserPrompt(ctx) {
  return `Analyze this store's compliance data. It is aggregated over ~5 months (not a single week), so reason about the overall pattern and the week-to-week flour series.

**Store:** ${ctx.store}
**Data:**
${JSON.stringify(ctx, null, 2)}

Provide:
1. A one-line compliance summary.
2. Which metrics are out of range (in % / ratio terms).
3. The likely cause, reasoned from the PATTERN across cheese, sauce, and flour together and whether they stay in ratio — apply the Diagnostic Reasoning rules. Do not diagnose ingredients in isolation or stack speculative causes.
4. One specific recommendation for the regional/district manager.`;
}

async function callModel(userPrompt) {
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
      max_tokens: 700,
      temperature: 0.3,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data)}`);
  return data.choices?.[0]?.message?.content ?? "(no content)";
}

async function main() {
  console.log(`\nAI Insights accuracy eval`);
  console.log(`Model: ${MODEL}`);
  console.log(`Dataset: ${XLSX_PATH}\n`);

  const wb = XLSX.readFile(XLSX_PATH);
  const sheets = ["Welland", "St Cath", "Milton"];

  for (const sheet of sheets) {
    const ctx = buildStoreContext(wb, sheet);
    const aiOutput = await callModel(buildEvalUserPrompt(ctx));
    const key = ANSWER_KEY[sheet];

    console.log("============================================================");
    console.log(`STORE: ${ctx.store}   (${ctx.weeks_of_data} weeks)`);
    console.log("============================================================");
    console.log(
      `metrics: cheese ${ctx.cheese.diff_pct_of_expected}% | sauce ${ctx.sauce.diff_pct_of_expected}% | flour avg ${ctx.flour.avg_diff_bags} bags | S:C ${ctx.ratios.sauce_to_cheese_avg} | F:C ${ctx.ratios.flour_to_cheese_avg}`
    );
    console.log(`\n--- JAMES (expected: ${key.label}) ---`);
    console.log(key.expected);
    console.log(`\n--- AI OUTPUT ---`);
    console.log(aiOutput.trim());
    console.log("");
  }
  console.log("Done. Compare each AI OUTPUT against the JAMES expected answer.\n");
}

main().catch((e) => {
  console.error("Eval failed:", e.message);
  process.exit(1);
});

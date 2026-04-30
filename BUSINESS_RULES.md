# Gino's Pizza — Business Rules & Calculation Logic

This document captures every business rule confirmed by James (finance manager) as of April 28, 2026. It is the single source of truth for how the calculation engine works. If the code disagrees with this document, the code is wrong.

---

## 1. Brands

| Brand | Code Prefix | Full Name | Store Type |
|-------|-------------|-----------|------------|
| GINOS | `GINOS` | Gino's Pizza | Flour |
| TTD | `TTD` | Twice the Deal Pizza | Flour |
| DD | `DD`, `STORE` | Double Double Pizza and Chicken | Dough |
| WM | `WM` | Wing Machine | Dough |
| PP/WM | `PP/WM`, `PP` | Multi-branded (Gino's + Wing Machine) | Admin assigns per store |

**Ignore:** SAPUTO, SUNDRY, and any other one-off entries in the raw data.

**Naming note:** `STORE` prefix and `DD` prefix both refer to Double Double Pizza and Chicken. Historical naming variation.

---

## 2. Two Calculation Paths: Flour vs. Dough

Every store falls into one of two categories that determines how the dough/flour metric is calculated.

### Flour Stores (GINOS, TTD, some PP/WM)

These stores mix their own dough in-store using flour.

- **What they order:** Flour (20kg bags)
- **Conversion:** Flour (kg) x 1.6 = Dough equivalent (kg)
- **Estimated usage:** Based on box orders x per-pizza dough ratios, then divided by 1.6 to get back to flour
- **Diff unit:** Bags (divide by 20kg)
- **Formula:** `flour_diff = (flour_ordered_kg - estimated_flour_kg) / 20`
- **Where estimated flour:** `(sum of boxes_per_size x dough_kg_per_pizza) / 1.6`

### Dough Stores (DD, WM, some PP/WM)

These stores use pre-portioned dough made at the commissary.

- **What they order:** Dough PT items (e.g., Large Dough PT 36x550 = 36 portions of 550g)
- **Conversion:** None — dough weight is direct
- **Estimated usage:** Based on box orders x per-pizza dough ratios (no /1.6 step)
- **Diff unit:** Cases of the specific dough SKU they order (use dominant SKU's case weight)
- **Formula:** `dough_diff = (dough_ordered_kg - estimated_dough_kg) / dominant_case_weight_kg`

### PP/WM Store Assignment

Each PP/WM store is assigned as either Flour-type or Dough-type by a super admin in the admin panel. This is a static setting, not auto-detected per upload.

---

## 3. Box Ratios (Per-Pizza Ingredient Usage)

These ratios are **universal across all brands**. Confirmed by James on April 28, 2026.

| Box Size | Cheese (oz) | Sauce (oz) | Dough (kg) | Boxes per Case |
|----------|-------------|------------|------------|----------------|
| Small (10") | 4 | 2.5 | 0.3 | 40 |
| Medium (12") | 6 | 4 | 0.45 | 40 |
| Large (14") | 8 | 5 | 0.6 | 40 |
| XL (16") | 10 | 6 | 0.775 | 40 |
| Party 20" | 16 | 10 | 1.2 | 40 |
| Party 21x15 | 20 | 13 | 1.5 | 40 |
| Clamshell (Slice) | 2 | 0.75 | 0.097 | varies |

**Important:** The "Dough KG" column is kilograms of **dough**, not flour. For Flour stores, divide by 1.6 to get flour equivalent.

---

## 4. Product Classification

### Primary Products (used in compliance calculations)

**Cheese (4 SKUs):**

| Code | Description | Weight per Case |
|------|-------------|-----------------|
| 20103 | SAP 20% PMZ IQF 1/8 3D 2x5KG | 10 kg |
| 20105 | 3D 20% SHRED CHEESE (4x2.27 Kg) | 9.08 kg |
| 020102A | French Mozz Cheese - 10kg | 10 kg |
| T020111 | SAG 20% PZMZ EW 3D 10*2.4KG GOLD | 24 kg |

All cheese is converted to **ounces** using: weight_kg x 35.27

**Pizza Sauce (2 SKUs):**

| Code | Description | Weight per Case |
|------|-------------|-----------------|
| G040114 | Ginos Pizza Sauce 6x100 fl.oz | 600 fl oz |
| 40114 | V Food Premium Pizza Sauce 6x2.84L | ~576.2 fl oz |

GINOS uses G040114, TTD uses 40114. Both tracked in **fl oz**.

**Flour (2 SKUs) — Flour stores only:**

| Code | Description | Weight per Case |
|------|-------------|-----------------|
| G050106 | Ginos Flour (20 Kg) | 20 kg |
| T050106 | V Food Flour (20 Kg) | 20 kg |

GINOS uses G050106, TTD uses T050106.

**Dough (5 SKUs) — Dough stores only:**

| Code | Description | Portions x Grams | Weight per Case (kg) |
|------|-------------|-------------------|---------------------|
| 50120 | Small Dough PT (72x300) | 72 small portions | 21.6 |
| 50121 | Medium Dough PT (40x410) | 40 medium portions | 16.4 |
| 50122 | Large Dough PT (36x550) | 36 large portions | 19.8 |
| 50123 | X-Large Dough PT (24x800) | 24 XL portions | 19.2 |
| 50124 | Party Dough PT (20x1000) | 20 party portions | 20.0 |

**Packaging — Pizza Boxes (14 SKUs):** Across GINOS, TTD, DD brands. Each case = 40 boxes. Sizes: Small (10"), Medium (12"), Large (14"), XL (16"), Party (20" and 21x15).

**Packaging — Clamshells:** Used in GINOS stores only. Counted WITH pizza boxes for estimated usage calculations (using the Clamshell row from the box ratios table).

**Packaging — Wing Boxes (4 SKUs):** 8/10/12/14 wing boxes, 50 per case. **Volume tracking only — NOT included in estimated usage calculations.**

### Secondary Products (tracked for volume, no ratios)

Wings, chicken topping, hot peppers, olives, pineapple, jalapenos, pepperoni, bacon, ham, sausage, paper plates.

**Paper plates:** Used in TTD and DD stores. Secondary item — track volume only.

### Neither (background data)

Everything else. Stored but not displayed. Admins can promote to primary or secondary.

---

## 5. Compliance Calculations

### Step 1: Aggregate Orders by Product Type

For each store-week, sum all orders by product type:

- **Total Cheese (oz):** Sum of (qty x weight_kg x 35.27) for all cheese SKUs
- **Total Sauce (fl oz):** Sum of (qty x weight_floz) for all sauce SKUs
- **Total Flour (kg):** Sum of (qty x 20) for all flour SKUs [Flour stores only]
- **Total Dough (kg):** Sum of (qty x case_weight_kg) for all dough SKUs [Dough stores only]
- **Boxes by size:** Sum of (qty) for each box size, including clamshells for GINOS stores

### Step 2: Estimated Usage (from box orders)

**Estimated Cheese (oz):**
```
Party_20_cases x 40 x 16
+ Party_21x15_cases x 40 x 20
+ XL_cases x 40 x 10
+ Large_cases x 40 x 8
+ Medium_cases x 40 x 6
+ Small_cases x 40 x 4
+ Clamshell_cases x units_per_case x 2    [GINOS only]
```

**Estimated Sauce (fl oz):**
```
Party_20_cases x 40 x 10
+ Party_21x15_cases x 40 x 13
+ XL_cases x 40 x 6
+ Large_cases x 40 x 5
+ Medium_cases x 40 x 4
+ Small_cases x 40 x 2.5
+ Clamshell_cases x units_per_case x 0.75  [GINOS only]
```

**Estimated Dough (kg):**
```
Party_20_cases x 40 x 1.2
+ Party_21x15_cases x 40 x 1.5
+ XL_cases x 40 x 0.775
+ Large_cases x 40 x 0.6
+ Medium_cases x 40 x 0.45
+ Small_cases x 40 x 0.3
+ Clamshell_cases x units_per_case x 0.097  [GINOS only]
```

**Estimated Flour (kg):** [Flour stores only]
```
Estimated Dough (kg) / 1.6
```

### Step 3: Differences

**Cheese Diff (cases):**
```
(Total Cheese oz - Estimated Cheese oz) / dominant_cheese_case_weight_oz
```
Where `dominant_cheese_case_weight_oz = weight_kg x 35.27` of the cheese SKU ordered in highest quantity.

**Sauce Diff (cases):**
```
(Total Sauce fl oz - Estimated Sauce fl oz) / (33.814 x 6 x 2.84)
```
Divisor = ~576.22 fl oz (weight of one case of V Food sauce).

**Flour Diff (bags):** [Flour stores]
```
(Total Flour kg - Estimated Flour kg) / 20
```

**Dough Diff (cases):** [Dough stores]
```
(Total Dough kg - Estimated Dough kg) / dominant_dough_case_weight_kg
```
Where `dominant_dough_case_weight_kg` is the case weight of the dough SKU ordered in highest quantity.

### Step 4: Ratios

**Sauce-to-Cheese Ratio:**
```
(Total Sauce fl oz / 5) / (Total Cheese oz / 8)
```
Target: 75% – 125%. Result is a decimal (e.g., 0.95 = 95%).

**Flour-to-Cheese Ratio:** [Flour stores]
```
(Total Flour kg x 1.6 / 0.6) / (Total Cheese oz / 8)
```
Target: 75% – 125%.

**Dough-to-Cheese Ratio:** [Dough stores]
```
(Total Dough kg / 0.6) / (Total Cheese oz / 8)
```
Target: 75% – 125%. Same formula but without the x1.6 since dough is already dough.

---

## 6. Flagging Thresholds

Thresholds are **configurable per metric** in the admin panel. Defaults:

| Metric | Warn (borderline) | Bad (out of compliance) |
|--------|-------------------|------------------------|
| Cheese diff | |diff| > 3 | |diff| > 6 |
| Sauce diff | |diff| > 3 | |diff| > 6 |
| Flour/Dough diff | |diff| > 3 | |diff| > 6 |
| Sauce:Cheese ratio | < 75% or > 125% | < 65% or > 135% |
| Flour/Dough:Cheese ratio | < 75% or > 125% | < 65% or > 135% |

**Overall store status:** Worst of all individual metric statuses. Any `bad` = store is `bad`. Any `warn` (no `bad`) = `warn`. All `ok` = `ok`.

### Flag Meanings

| Condition | Possible Cause |
|-----------|---------------|
| Cheese diff > threshold | Over portioning cheese, buying unapproved boxes |
| Cheese diff < -threshold | Buying unapproved cheese, under portioning |
| Sauce diff > threshold | Over portioning sauce, buying unapproved boxes |
| Sauce diff < -threshold | Buying unapproved sauce, mixing water in sauce, under portioning |
| Flour/Dough diff > threshold | Dough too heavy, buying unapproved boxes |
| Flour/Dough diff < -threshold | Dough too light, buying unapproved flour/dough |
| S:C ratio < 75% | Buying unapproved sauce, mixing water, under portioning sauce |
| S:C ratio > 125% | Buying unapproved cheese, under portioning cheese |
| F:C or D:C ratio < 75% | Dough too light, buying unapproved flour/dough |
| F:C or D:C ratio > 125% | Buying unapproved cheese, under portioning cheese |

---

## 7. Users & Access

| Role | Count | Access |
|------|-------|--------|
| Super Admin | 3 | All stores, all brands, upload, admin panel, AI chatbot |
| District Manager (DSM) | 5 | Only their assigned stores, dashboards + AI insights only |

**DSMs:** Brijesh (32 stores), Jim (9), Michel (35), Paul (49), Raj (35)

**Vick:** Removed. Was in training, territory overlapped with others.

---

## 8. Data Flow

1. James exports weekly order data from the ordering system (Excel file)
2. One file per week going forward; historical files have one tab per week
3. Super admin uploads the file via the Upload page
4. System parses, classifies, computes metrics, persists
5. DSMs log in and see their stores' compliance data
6. Email notification sent to all DSMs when new data is uploaded

**Raw data schema:** CompanyName, WeekNumber, productcode, description, TotalQty

---

## 9. Store Name Matching

- Store list has 160 stores (from `Store list and Box Ratios.xlsx`)
- Some store codes have "NEW" suffix (e.g., "GINOS002 NEW") — strip for matching
- Raw data store names should match after normalization
- Unmatched stores in raw data are auto-created with brand detected from prefix
- SAPUTO, SUNDRY entries are ignored during processing

---

## 10. Open Items

- **Cheese-to-boxes ratio:** James mentioned this as a metric DSMs use frequently. Details not yet received. Can be added post-launch.

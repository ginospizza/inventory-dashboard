/**
 * Excel parser for Gino's weekly order data.
 *
 * Handles both single-tab (weekly going forward) and multi-tab (historical) files.
 * Validates column structure and extracts raw order rows.
 */

import * as XLSX from "xlsx";
import type { RawOrderRow } from "@/lib/types";

const REQUIRED_COLUMNS = ["CompanyName", "WeekNumber", "productcode", "description", "TotalQty"];

// Some sheets have a "Products Sold" header row before the actual column headers
const SKIP_PREFIXES = ["Products Sold", "products sold"];

export interface ParseResult {
  rows: RawOrderRow[];
  sheets_processed: number;
  errors: string[];
}

/**
 * Parse an Excel file buffer into raw order rows.
 * Supports single-tab and multi-tab files.
 */
export function parseExcelFile(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });
  const allRows: RawOrderRow[] = [];
  const errors: string[] = [];
  let sheetsProcessed = 0;

  for (const sheetName of workbook.SheetNames) {
    // Skip known non-data sheets
    const lower = sheetName.toLowerCase();
    if (
      lower.includes("pivot") ||
      lower.includes("product sheet") ||
      lower.includes("exported list") ||
      lower.includes("values") ||
      lower === "dsm list" ||
      lower === "none"
    ) {
      continue;
    }

    // Skip DSM-named sheets (Vito, Paul, Brijesh, etc.)
    const dsmNames = ["vito", "paul", "brijesh", "michel", "jim", "raj", "vick"];
    if (dsmNames.includes(lower)) continue;

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    });

    if (jsonData.length === 0) continue;

    // Find the header row — may need to skip "Products Sold" prefix
    let dataRows = jsonData;
    const firstRow = jsonData[0];
    const firstKeys = Object.keys(firstRow);

    // Check if first row is a "Products Sold" label
    if (
      firstKeys.length > 0 &&
      SKIP_PREFIXES.some((p) =>
        String(firstRow[firstKeys[0]] ?? "").startsWith(p)
      )
    ) {
      // Re-parse with header at row 2
      const sheetWithSkip = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        sheet,
        { defval: null, raw: true, range: 1 }
      );
      dataRows = sheetWithSkip;
    }

    if (dataRows.length === 0) continue;

    // Validate columns exist
    const sampleRow = dataRows[0];
    const columns = Object.keys(sampleRow);
    const missingCols = REQUIRED_COLUMNS.filter(
      (c) => !columns.some((col) => col.trim() === c)
    );

    if (missingCols.length > 0) {
      // Try case-insensitive match
      const lowerCols = columns.map((c) => c.toLowerCase().trim());
      const stillMissing = REQUIRED_COLUMNS.filter(
        (c) => !lowerCols.includes(c.toLowerCase())
      );
      if (stillMissing.length > 0) {
        errors.push(
          `Sheet "${sheetName}": missing columns ${stillMissing.join(", ")}`
        );
        continue;
      }
    }

    // Extract rows
    for (const row of dataRows) {
      const companyName = findValue(row, "CompanyName");
      const weekNumber = findValue(row, "WeekNumber");
      const productCode = findValue(row, "productcode");
      const description = findValue(row, "description");
      const totalQty = findValue(row, "TotalQty");

      // Skip empty rows
      if (!companyName || !productCode) continue;

      const qty = Number(totalQty);
      if (isNaN(qty) || qty <= 0) continue;

      allRows.push({
        company_name: String(companyName).trim(),
        week_number: Number(weekNumber) || 0,
        product_code: String(productCode).trim(),
        description: String(description ?? "").trim(),
        total_qty: qty,
      });
    }

    sheetsProcessed++;
  }

  return {
    rows: allRows,
    sheets_processed: sheetsProcessed,
    errors,
  };
}

/**
 * Get a preview of the parsed data for the upload confirmation screen.
 */
export interface UploadPreview {
  total_rows: number;
  sheets_count: number;
  weeks: number[];
  stores: string[];
  sample_rows: RawOrderRow[];
  errors: string[];
}

export function getUploadPreview(result: ParseResult): UploadPreview {
  const weeks = [...new Set(result.rows.map((r) => r.week_number))].sort(
    (a, b) => a - b
  );
  const stores = [...new Set(result.rows.map((r) => r.company_name))].sort();

  return {
    total_rows: result.rows.length,
    sheets_count: result.sheets_processed,
    weeks,
    stores,
    sample_rows: result.rows.slice(0, 10),
    errors: result.errors,
  };
}

/**
 * Case-insensitive column value lookup.
 */
function findValue(
  row: Record<string, unknown>,
  columnName: string
): unknown {
  // Exact match first
  if (columnName in row) return row[columnName];

  // Case-insensitive
  const lower = columnName.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase().trim() === lower) return row[key];
  }

  return null;
}

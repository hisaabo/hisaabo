/**
 * PDF Table Extractor using PDF.js
 *
 * Extracts tabular data from PDF files by analyzing text item positions.
 * Groups text items into rows by Y-coordinate, then into columns by X-coordinate.
 * Outputs the same format as Papa Parse: { headers: string[], rows: Record<string, string>[] }
 */
import * as pdfjsLib from "pdfjs-dist";

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  metadata: Record<string, string>; // key-value pairs from the header area
}

/**
 * Extract tables from a PDF file.
 * Returns headers + rows, same shape as CSV parsing.
 */
export async function parsePdfTable(file: File): Promise<ParsedTable> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const allItems: TextItem[] = [];

  // Extract text items from all pages with positions
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;

      // Transform coordinates to page-space (top-left origin)
      const tx = item.transform;
      const x = tx[4];
      const y = viewport.height - tx[5]; // flip Y to top-down

      allItems.push({
        str: item.str.trim(),
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(item.width),
        height: Math.round(item.height ?? 12),
        page: pageNum,
      });
    }
  }

  if (allItems.length === 0) {
    return { headers: [], rows: [], metadata: {} };
  }

  // Group items into rows by Y-coordinate (items within 6px Y are same row)
  // 6px handles slight vertical misalignment in PDF table cells
  const rowGroups = groupByY(allItems, 6);

  // Extract metadata from header area (before the table)
  const metadata: Record<string, string> = {};
  let headerRowIdx = -1;

  // Find the header row — look for a row containing common table headers
  const tableHeaderPatterns = [
    ["date", "type"],
    ["invoice", "date"],
    ["name", "amount"],
    ["date", "party"],
    ["txn", "mode"],
  ];

  for (let i = 0; i < rowGroups.length; i++) {
    const rowText = rowGroups[i].map((item) => item.str.toLowerCase()).join(" ");
    for (const pattern of tableHeaderPatterns) {
      if (pattern.every((p) => rowText.includes(p))) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx >= 0) break;
  }

  // Extract metadata from rows before the header
  if (headerRowIdx > 0) {
    for (let i = 0; i < headerRowIdx; i++) {
      const rowText = rowGroups[i].map((item) => item.str).join(" ");

      // Try to extract key: value pairs
      const colonMatch = rowText.match(/^(.+?):\s*(.+)$/);
      if (colonMatch) {
        metadata[colonMatch[1].trim()] = colonMatch[2].trim();
      } else if (i === 0) {
        metadata["title"] = rowText;
      }
    }
  }

  if (headerRowIdx < 0) {
    // No table header found — return all text as metadata
    return { headers: [], rows: [], metadata };
  }

  // The header row defines column positions
  const headerItems = rowGroups[headerRowIdx];
  headerItems.sort((a, b) => a.x - b.x);

  const headers = headerItems.map((item) => item.str);
  const columnPositions = headerItems.map((item) => ({
    label: item.str,
    x: item.x,
    width: item.width,
  }));

  // Parse data rows (everything after header)
  const dataRows = rowGroups.slice(headerRowIdx + 1);
  const rows: Record<string, string>[] = [];

  // Helper: assign items in a row group to columns
  function assignToColumns(rowItems: TextItem[]): Record<string, string> {
    const row: Record<string, string> = {};
    for (const item of rowItems) {
      let bestCol = 0;
      let bestDist = Infinity;

      for (let c = 0; c < columnPositions.length; c++) {
        const colCenter = columnPositions[c].x + columnPositions[c].width / 2;
        const itemCenter = item.x + item.width / 2;
        const dist = Math.abs(itemCenter - colCenter);

        if (dist < bestDist) {
          bestDist = dist;
          bestCol = c;
        }
      }

      const header = headers[bestCol];
      row[header] = row[header] ? row[header] + " " + item.str : item.str;
    }
    return row;
  }

  // Helper: check if a row looks like a "real" data row (has values in multiple columns)
  // vs a continuation row (only has text in 1-2 columns, typically Party name overflow)
  function isNewDataRow(row: Record<string, string>): boolean {
    const filledColumns = Object.entries(row).filter(([, v]) => v && v.trim()).length;
    if (filledColumns <= 2) return false;
    // A real row typically has a Date column filled
    const firstHeader = headers[0]; // usually "Date"
    if (row[firstHeader] && /\d{2}\/\d{2}\/\d{4}/.test(row[firstHeader])) return true;
    // Or has numeric values in amount columns
    const hasNumber = Object.values(row).some((v) => v && /^\d+\.?\d*$/.test(v.trim()));
    return filledColumns >= 3 || hasNumber;
  }

  for (const rowItems of dataRows) {
    // Skip summary/footer rows
    const rowText = rowItems.map((i) => i.str).join(" ").toLowerCase();
    if (
      rowText.includes("total") ||
      rowText.includes("closing balance") ||
      rowText.includes("page ")
    ) {
      continue;
    }

    const row = assignToColumns(rowItems);

    if (!Object.values(row).some((v) => v && v.trim())) continue;

    if (isNewDataRow(row)) {
      // This is a new data row
      rows.push(row);
    } else if (rows.length > 0) {
      // This is a continuation of the previous row — merge text into matching columns
      const prevRow = rows[rows.length - 1];
      for (const [col, val] of Object.entries(row)) {
        if (val && val.trim()) {
          prevRow[col] = prevRow[col] ? prevRow[col] + " " + val.trim() : val.trim();
        }
      }
    }
  }

  return { headers, rows, metadata };
}

/**
 * Group text items into rows by Y-coordinate proximity.
 */
function groupByY(items: TextItem[], tolerance: number): TextItem[][] {
  // Sort by page first, then Y
  const sorted = [...items].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return a.y - b.y;
  });

  const groups: TextItem[][] = [];
  let currentGroup: TextItem[] = [sorted[0]];
  let currentY = sorted[0].y;
  let currentPage = sorted[0].page;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (item.page === currentPage && Math.abs(item.y - currentY) <= tolerance) {
      currentGroup.push(item);
    } else {
      groups.push(currentGroup);
      currentGroup = [item];
      currentY = item.y;
      currentPage = item.page;
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

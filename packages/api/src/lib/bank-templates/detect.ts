/**
 * detect.ts — Auto-detect which bank template matches a CSV upload.
 *
 * WHY THIS FILE EXISTS:
 * Users often don't know which bank template to select. This module scores
 * each available template against the uploaded CSV rows and returns the best
 * match above a confidence threshold. Hints (bank name, IFSC) from the bank
 * account record boost confidence significantly.
 */

import type { PreprocessRules } from "./preprocess.js";

// Re-export DetectionRules type for convenience
export interface DetectionRules {
  headerPatterns?: string[];
  columnCount?: { min: number; max: number };
  firstRowPatterns?: string[];
  ifscPrefix?: string;
}

export interface DetectionResult {
  templateId: string;
  bankSlug: string;
  bankDisplayName: string;
  version: number;
  confidence: number; // 0-1
  reason: string;
}

export interface DetectableTemplate {
  id: string;
  bankSlug: string;
  bankDisplayName: string;
  version: number;
  detectionRules: DetectionRules | null | undefined;
  columnMapping: {
    date: number;
    narration: number;
    debit?: number;
    credit?: number;
    amount?: number;
    type?: number;
    reference?: number;
    balance?: number;
    dateFormat: string;
    skipRows: number;
    amountSignConvention?: "debit_positive" | "credit_positive";
  };
  preprocessRules?: PreprocessRules | null;
}

const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Score a single template against the CSV content and hints.
 * Returns 0 if no signals match.
 */
function scoreTemplate(
  template: DetectableTemplate,
  headerText: string,
  sampleText: string,
  columnCount: number,
  hints?: { bankName?: string; ifsc?: string },
): { confidence: number; reasons: string[] } {
  const rules = template.detectionRules;
  let confidence = 0;
  const reasons: string[] = [];

  if (hints?.ifsc && rules?.ifscPrefix) {
    if (hints.ifsc.toUpperCase().startsWith(rules.ifscPrefix.toUpperCase())) {
      confidence += 0.4;
      reasons.push(`IFSC prefix ${rules.ifscPrefix}`);
    }
  }

  if (hints?.bankName) {
    const normalizedHint = hints.bankName.toLowerCase();
    const normalizedSlug = template.bankSlug.toLowerCase();
    const normalizedDisplay = template.bankDisplayName.toLowerCase();
    if (
      normalizedDisplay.includes(normalizedHint) ||
      normalizedHint.includes(normalizedSlug) ||
      normalizedSlug.includes(normalizedHint)
    ) {
      confidence += 0.3;
      reasons.push(`bank name "${hints.bankName}"`);
    }
  }

  if (rules?.headerPatterns && rules.headerPatterns.length > 0) {
    const matchedAll = rules.headerPatterns.every((pattern) => {
      try { return new RegExp(pattern, "i").test(headerText); }
      catch { return false; }
    });
    if (matchedAll) {
      confidence += 0.3;
      reasons.push("header patterns");
    }
  }

  if (rules?.columnCount) {
    const { min, max } = rules.columnCount;
    if (columnCount >= min && columnCount <= max) {
      confidence += 0.1;
      reasons.push(`column count ${columnCount}`);
    }
  }

  if (rules?.firstRowPatterns && rules.firstRowPatterns.length > 0) {
    const matchedAny = rules.firstRowPatterns.some((pattern) => {
      try { return new RegExp(pattern, "i").test(sampleText); }
      catch { return false; }
    });
    if (matchedAny) {
      confidence += 0.2;
      reasons.push("first-row patterns");
    }
  }

  return { confidence: Math.min(confidence, 1), reasons };
}

/**
 * Validate that a template's column mapping can actually parse the CSV.
 * Tries multiple candidate data rows (starting after headers) — if any
 * produces a valid date column and at least one amount column, the
 * template is considered viable.
 *
 * We try rows at several offsets because different templates may specify
 * different skipRows/extraHeaderRows, and the CSV may have fewer header
 * rows than the template expects (e.g., a bank changed their format).
 */
function validateTemplateAgainstData(
  rows: string[][],
  template: DetectableTemplate,
): boolean {
  // Try a few candidate first-data-row indices
  const candidates = new Set([
    1,  // Most CSVs: header at 0, data at 1
    template.columnMapping.skipRows,
    template.columnMapping.skipRows + (template.preprocessRules?.extraHeaderRows ?? 0),
  ]);

  for (const startIdx of candidates) {
    const dataRow = rows[startIdx];
    if (!dataRow) continue;

    // Check date column has a non-empty value
    const dateVal = dataRow[template.columnMapping.date];
    if (!dateVal || dateVal.trim() === "") continue;

    // Check at least one amount column references a valid index with data
    const hasDebit = template.columnMapping.debit !== undefined &&
      dataRow[template.columnMapping.debit] !== undefined;
    const hasCredit = template.columnMapping.credit !== undefined &&
      dataRow[template.columnMapping.credit] !== undefined;
    const hasAmount = template.columnMapping.amount !== undefined &&
      dataRow[template.columnMapping.amount] !== undefined;

    if (hasDebit || hasCredit || hasAmount) return true;
  }

  return false;
}

export interface DetectionWarning {
  type: "bank_mismatch";
  message: string;
  detectedBank: string;
  accountBank: string;
}

/**
 * Auto-detect which template matches a CSV by scoring each template.
 *
 * Strategy:
 * 1. Score all templates against the CSV + hints
 * 2. Group by bankSlug, sort versions descending within each bank
 * 3. For the best-scoring bank, try highest version first
 * 4. If that version's mapping fails data validation, degrade to lower versions
 * 5. If no version works for the best bank, try next best bank
 * 6. If the detected bank differs from the account's bank, return a warning
 *
 * Returns null if no template matches above the confidence threshold.
 */
export function detectBankTemplate(
  rows: string[][],
  templates: DetectableTemplate[],
  hints?: { bankName?: string; ifsc?: string },
): { result: DetectionResult; warning?: DetectionWarning } | null {
  if (rows.length === 0 || templates.length === 0) return null;

  const headerRow = rows[0] ?? [];
  const headerText = headerRow.join(" ").toLowerCase();
  const sampleRows = rows.slice(0, 5);
  const sampleText = sampleRows.map((r) => r.join(" ")).join("\n").toLowerCase();
  const columnCount = headerRow.length;

  // Score all templates
  const scored: Array<{
    template: DetectableTemplate;
    confidence: number;
    reason: string;
  }> = [];

  for (const template of templates) {
    const { confidence, reasons } = scoreTemplate(
      template, headerText, sampleText, columnCount, hints,
    );
    if (confidence > 0) {
      scored.push({ template, confidence, reason: reasons.join(", ") });
    }
  }

  // Filter to above threshold
  const candidates = scored.filter((s) => s.confidence >= CONFIDENCE_THRESHOLD);
  if (candidates.length === 0) return null;

  // Group by bankSlug, keeping all versions per bank
  const byBank = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const slug = c.template.bankSlug;
    const existing = byBank.get(slug) ?? [];
    existing.push(c);
    byBank.set(slug, existing);
  }

  // Sort banks by best confidence (max confidence within each group)
  const bankOrder = [...byBank.entries()]
    .map(([slug, entries]) => ({
      slug,
      entries,
      bestConfidence: Math.max(...entries.map((e) => e.confidence)),
    }))
    .sort((a, b) => b.bestConfidence - a.bestConfidence);

  // For each bank (best-scoring first), try versions high→low with data validation
  for (const bank of bankOrder) {
    // Sort versions within this bank: highest first
    bank.entries.sort((a, b) => b.template.version - a.template.version);

    for (const entry of bank.entries) {
      if (validateTemplateAgainstData(rows, entry.template)) {
        const result: DetectionResult = {
          templateId: entry.template.id,
          bankSlug: entry.template.bankSlug,
          bankDisplayName: entry.template.bankDisplayName,
          version: entry.template.version,
          confidence: entry.confidence,
          reason: entry.reason,
        };

        // Check for bank mismatch warning
        let warning: DetectionWarning | undefined;
        if (hints?.bankName) {
          const detectedSlug = entry.template.bankSlug.toLowerCase();
          const accountBank = hints.bankName.toLowerCase();
          const detectedName = entry.template.bankDisplayName.toLowerCase();
          const isMatch =
            accountBank.includes(detectedSlug) ||
            detectedSlug.includes(accountBank) ||
            accountBank.includes(detectedName) ||
            detectedName.includes(accountBank);

          if (!isMatch) {
            warning = {
              type: "bank_mismatch",
              message: `This CSV appears to be from ${entry.template.bankDisplayName}, but the selected bank account is "${hints.bankName}". Please verify you're importing into the correct account.`,
              detectedBank: entry.template.bankDisplayName,
              accountBank: hints.bankName,
            };
          }
        }

        return { result, warning };
      }
    }
  }

  return null;
}

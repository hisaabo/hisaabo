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
 * Auto-detect which template matches a CSV by scoring each template.
 *
 * Scoring:
 *   +0.4 if IFSC prefix matches hints.ifsc
 *   +0.3 if bankName hint matches bankDisplayName/bankSlug
 *   +0.3 if headerPatterns match CSV headers
 *   +0.1 if columnCount is within range
 *   +0.2 if firstRowPatterns match first 5 rows
 *
 * Returns highest-scoring template above threshold 0.5.
 * For ties, prefers highest version number.
 */
export function detectBankTemplate(
  rows: string[][],
  templates: DetectableTemplate[],
  hints?: { bankName?: string; ifsc?: string },
): DetectionResult | null {
  if (rows.length === 0 || templates.length === 0) return null;

  // Extract header row text for matching
  const headerRow = rows[0] ?? [];
  const headerText = headerRow.join(" ").toLowerCase();

  // Collect first 5 data rows for firstRowPatterns
  const sampleRows = rows.slice(0, 5);
  const sampleText = sampleRows.map((r) => r.join(" ")).join("\n").toLowerCase();

  const columnCount = headerRow.length;

  const scored: Array<{ template: DetectableTemplate; confidence: number; reason: string }> = [];

  for (const template of templates) {
    const rules = template.detectionRules;
    let confidence = 0;
    const reasons: string[] = [];

    // +0.4 for IFSC prefix match
    if (hints?.ifsc && rules?.ifscPrefix) {
      if (hints.ifsc.toUpperCase().startsWith(rules.ifscPrefix.toUpperCase())) {
        confidence += 0.4;
        reasons.push(`IFSC prefix ${rules.ifscPrefix}`);
      }
    }

    // +0.3 for bank name hint
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

    // +0.3 if headerPatterns match
    if (rules?.headerPatterns && rules.headerPatterns.length > 0) {
      const matchedAll = rules.headerPatterns.every((pattern) => {
        try {
          return new RegExp(pattern, "i").test(headerText);
        } catch {
          return false;
        }
      });
      if (matchedAll) {
        confidence += 0.3;
        reasons.push("header patterns");
      }
    }

    // +0.1 if column count within range
    if (rules?.columnCount) {
      const { min, max } = rules.columnCount;
      if (columnCount >= min && columnCount <= max) {
        confidence += 0.1;
        reasons.push(`column count ${columnCount}`);
      }
    }

    // +0.2 if firstRowPatterns match first 5 rows
    if (rules?.firstRowPatterns && rules.firstRowPatterns.length > 0) {
      const matchedAny = rules.firstRowPatterns.some((pattern) => {
        try {
          return new RegExp(pattern, "i").test(sampleText);
        } catch {
          return false;
        }
      });
      if (matchedAny) {
        confidence += 0.2;
        reasons.push("first-row patterns");
      }
    }

    if (confidence > 0) {
      scored.push({
        template,
        confidence: Math.min(confidence, 1),
        reason: reasons.join(", "),
      });
    }
  }

  // Filter to above threshold
  const candidates = scored.filter((s) => s.confidence >= CONFIDENCE_THRESHOLD);
  if (candidates.length === 0) return null;

  // Sort by confidence desc, then version desc for ties
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.template.version - a.template.version;
  });

  const best = candidates[0]!;
  return {
    templateId: best.template.id,
    bankSlug: best.template.bankSlug,
    bankDisplayName: best.template.bankDisplayName,
    version: best.template.version,
    confidence: best.confidence,
    reason: best.reason,
  };
}

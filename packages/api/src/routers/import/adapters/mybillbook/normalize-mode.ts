import type { PaymentMode } from "../../types.js";

// Normalize MyBillBook payment mode strings to canonical modes.
// Handles: "GPay", "PhonePe", "Paytm", "NEFT", "RTGS", "IMPS", etc.
export function normalizeMode(raw: string): PaymentMode {
  const s = (raw || "").toLowerCase().trim();
  if (s === "cash") return "cash";
  if (
    s === "credit" ||
    s === "bank" ||
    s.includes("bank transfer") ||
    s === "neft" ||
    s === "rtgs" ||
    s === "imps"
  ) return "bank";
  if (
    s === "upi" ||
    s.includes("gpay") ||
    s.includes("phonepe") ||
    s.includes("paytm")
  ) return "upi";
  if (s === "cheque" || s === "check") return "cheque";
  return "other";
}

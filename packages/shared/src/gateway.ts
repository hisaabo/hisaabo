/**
 * Payment gateway charge calculation.
 *
 * Charge rates are inclusive (user enters total effective rate including GST).
 * All money values are strings — never JS floating point.
 */

import { money } from "./money.js";

export interface GatewayChargeRate {
  type: "percentage" | "flat";
  value: string; // e.g., "2" for 2% or "20.00" for flat ₹20
}

export type GatewayChargeConfig = {
  credit_card?: GatewayChargeRate;
  debit_card?: GatewayChargeRate;
  upi?: GatewayChargeRate;
  net_banking?: GatewayChargeRate;
  wallet?: GatewayChargeRate;
  default?: GatewayChargeRate;
};

export interface GatewayChargeResult {
  chargeAmount: string;
  netSettlement: string;
}

/**
 * Calculate the gateway charge and net settlement for a payment.
 *
 * @param paymentAmount — total payment amount (string, e.g., "1000.00")
 * @param chargeConfig — per-mode charge rates from the gateway config
 * @param mode — the payment mode used (e.g., "credit_card")
 * @returns { chargeAmount, netSettlement } both as money strings
 */
export function calculateGatewayCharge(
  paymentAmount: string,
  chargeConfig: GatewayChargeConfig,
  mode: string,
): GatewayChargeResult {
  const rate = (chargeConfig as Record<string, GatewayChargeRate | undefined>)[mode]
    ?? chargeConfig.default
    ?? { type: "percentage" as const, value: "0" };

  let chargeAmount: string;
  if (rate.type === "percentage") {
    chargeAmount = money.percent(paymentAmount, rate.value);
  } else {
    chargeAmount = rate.value;
  }

  // Never negative
  chargeAmount = money.max0(chargeAmount);

  // Charge cannot exceed payment amount
  if (money.compare(chargeAmount, paymentAmount) > 0) {
    chargeAmount = paymentAmount;
  }

  const netSettlement = money.max0(money.sub(paymentAmount, chargeAmount));

  return { chargeAmount, netSettlement };
}

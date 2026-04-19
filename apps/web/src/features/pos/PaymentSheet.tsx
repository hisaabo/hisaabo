import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import type { POSCart } from "./state";
import { computeCartTotals } from "./state";

interface Props {
  open: boolean;
  cart: POSCart;
  onClose: () => void;
  onFinalized: (invoiceId: string) => void;
}

type Mode = "cash" | "upi";

/**
 * Bottom payment sheet. Two mode tiles (Cash / UPI), shows the total,
 * confirms, creates an invoice + payment, and hands back the invoice id
 * for receipt printing.
 *
 * Failure mode: if invoice creates but payment fails, we surface the error
 * and DON'T clear the cart. The user can retry payment via the normal flow.
 * The invoice lives as an unpaid "sent" sale.
 */
export function PaymentSheet({ open, cart, onClose, onFinalized }: Props) {
  const [mode, setMode] = useState<Mode>("cash");
  const [phase, setPhase] = useState<"idle" | "creating" | "paying">("idle");

  useEffect(() => {
    if (!open) setPhase("idle");
  }, [open]);

  const createInvoice = trpc.invoice.create.useMutation();
  const createPayment = trpc.payment.create.useMutation();

  const totals = computeCartTotals(cart.lineItems);

  async function handleConfirm() {
    if (cart.lineItems.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    setPhase("creating");
    let invoiceId: string | undefined;
    let invoiceTotal: string | undefined;
    try {
      const inv = await createInvoice.mutateAsync({
        partyId: cart.partyId,
        type: "sale",
        documentType: "invoice",
        // Tag this invoice as originating from the POS register so reports
        // and the invoice list can attribute revenue by channel.
        source: "pos",
        // Every POS sale is "just another invoice" — the server is the
        // single source of truth for numbering, stock, GST, and audit.
        // selectedUnit + conversionFactor + variantId are what let the
        // existing stock-decrement path work correctly for alt_units and
        // variants without any POS-specific server logic.
        lineItems: cart.lineItems.map((li) => ({
          itemId: li.itemId ?? undefined,
          variantId: li.variantId ?? undefined,
          itemName: li.itemName,
          quantity: li.quantity,
          selectedUnit: li.unit,
          conversionFactor: li.conversionFactor,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          discountPercent: li.discountPercent,
        })),
        additionalCharges: "0",
        invoiceDiscount: "0",
        invoiceDiscountType: "amount",
        roundOff: "0",
        isReverseCharge: false,
        deliveryMethod: "self_pickup",
      });
      invoiceId = inv.id;
      invoiceTotal = inv.totalAmount;
    } catch (err) {
      setPhase("idle");
      toast.error("Could not create sale", err instanceof Error ? err.message : String(err));
      return;
    }

    setPhase("paying");
    try {
      await createPayment.mutateAsync({
        invoiceId,
        partyId: cart.partyId,
        amount: invoiceTotal!,
        mode,
        paymentDate: new Date().toISOString(),
      });
    } catch (err) {
      setPhase("idle");
      toast.error(
        "Sale saved but payment step failed",
        `Invoice created. Settle payment via the normal flow. ${err instanceof Error ? err.message : ""}`,
      );
      // Still advance — the invoice exists and the cashier can reprint later.
      onFinalized(invoiceId);
      return;
    }

    setPhase("idle");
    onFinalized(invoiceId);
  }

  if (!open) return null;

  const busy = phase !== "idle";

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-end justify-center"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-lg bg-surface-1 border border-border rounded-t-2xl shadow-xl p-6 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Take Payment</h2>
          <div className="text-3xl font-bold tabular-nums">
            ₹{totals.total.toFixed(2)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <PayModeTile active={mode === "cash"} onClick={() => setMode("cash")} label="Cash" hint="F9" />
          <PayModeTile active={mode === "upi"} onClick={() => setMode("upi")} label="UPI" hint="F10" />
        </div>

        <div className="flex gap-3 pt-2">
          <button className="btn-secondary flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-primary flex-1 text-base py-3"
            onClick={handleConfirm}
            disabled={busy}
          >
            {phase === "creating"
              ? "Saving sale…"
              : phase === "paying"
                ? "Recording payment…"
                : `Confirm ${mode === "cash" ? "Cash" : "UPI"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PayModeTile({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-6 rounded-lg border text-center transition-colors ${
        active
          ? "border-brand-600 bg-brand-600/10 ring-2 ring-brand-600"
          : "border-border bg-surface-2 hover:bg-surface-3"
      }`}
    >
      <div className="text-lg font-semibold">{label}</div>
      <div className="text-xs text-text-tertiary mt-1">{hint}</div>
    </button>
  );
}

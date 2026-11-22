import { useCallback, useRef, useState } from "react";
import {
  proposePriceUpdates,
  proposalToUpdate,
  supportsPricePropagation,
  type PriceLineInput,
  type PriceSide,
  type PriceUpdateProposal,
  type PriceUpdateSkip,
  type PricingCatalogItem,
} from "@hisaabo/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { useCan } from "@/hooks/useCan";
import { PriceUpdateDialog } from "@/components/PriceUpdateDialog";

/** What the user chose in the dialog: save the bill and these prices, just the bill, or go back. */
export type PriceDecision = { kind: "back" } | { kind: "save"; accepted: PriceUpdateProposal[] };

interface Prompt {
  proposals: PriceUpdateProposal[];
  skipped: PriceUpdateSkip[];
  resolve: (d: PriceDecision) => void;
}

/**
 * "Update saved prices?" for the document form.
 *
 *   const pricing = usePricePropagation("invoice", "sale");
 *   const decision = await pricing.decide(lines);   // before saving the bill
 *   ... save the bill ...
 *   void pricing.apply(savedBill.id, decision.accepted);   // after it saved
 *   {pricing.dialog}
 *
 * Nothing here can block the bill: a lookup that fails means "no prompt", and
 * `apply` runs after the bill is saved and only ever toasts on failure. Users
 * without Item:update, and documents that are not invoices, never see a prompt.
 */
export function usePricePropagation(documentType: string, side: PriceSide) {
  const canUpdateItems = useCan("update", "Item");
  const enabled = canUpdateItems && supportsPricePropagation(documentType);
  const utils = trpc.useUtils();
  const updatePrices = trpc.item.updatePricesFromDocument.useMutation();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [checking, setChecking] = useState(false);
  // The dialog is a promise the form awaits; a ref keeps the latest resolver reachable from the handlers.
  const promptRef = useRef<Prompt | null>(null);

  const settle = useCallback((d: PriceDecision) => {
    const p = promptRef.current;
    promptRef.current = null;
    setPrompt(null);
    p?.resolve(d);
  }, []);

  /** Compare the edited rates with the live catalog; ask once if anything differs. */
  const decide = useCallback(
    async (lines: readonly PriceLineInput[]): Promise<PriceDecision> => {
      if (!enabled) return { kind: "save", accepted: [] };

      // Only lines whose rate was edited need a catalog lookup.
      const edited = lines.filter(
        (l) => l.itemId && !(l.originalUnitPrice != null && Number(l.originalUnitPrice) === Number(l.unitPrice)),
      );
      const itemIds = [...new Set(edited.map((l) => l.itemId as string))];
      if (itemIds.length === 0) return { kind: "save", accepted: [] };

      setChecking(true);
      let proposals: PriceUpdateProposal[] = [];
      let skipped: PriceUpdateSkip[] = [];
      try {
        // Always the live prices, never a cached list: the question is "does the catalog still say this?"
        const fetched = await Promise.all(
          itemIds.map((id) => utils.item.getById.fetch({ id }, { staleTime: 0 }).catch(() => null)),
        );
        const items = fetched.filter((i): i is NonNullable<typeof i> => !!i) as unknown as PricingCatalogItem[];
        ({ proposals, skipped } = proposePriceUpdates({ side, lines, items }));
      } catch {
        proposals = [];
      } finally {
        setChecking(false);
      }

      if (proposals.length === 0) return { kind: "save", accepted: [] };

      return new Promise<PriceDecision>((resolve) => {
        const p: Prompt = { proposals, skipped, resolve };
        promptRef.current = p;
        setPrompt(p);
      });
    },
    [enabled, side, utils],
  );

  /** After the bill is saved: write the accepted prices. A failure is a toast, never an error for the bill. */
  const apply = useCallback(
    async (documentId: string | undefined, accepted: readonly PriceUpdateProposal[]) => {
      if (accepted.length === 0) return;
      try {
        // mutateAsync keeps running if the form closes meanwhile (a mutation outlives its component)
        const res = await updatePrices.mutateAsync({
          ...(documentId ? { documentId } : {}),
          updates: accepted.map(proposalToUpdate),
        });
        const n = res.updated.length;
        toast.success(n === 1 ? "Updated 1 item price" : `Updated ${n} item prices`);
        void utils.item.list.invalidate();
        void utils.item.getById.invalidate();
      } catch (err) {
        toast.error(
          "Bill saved, but item prices were not updated",
          err instanceof Error ? err.message : "Update them from the item page.",
        );
      }
    },
    [utils, updatePrices.mutateAsync],
  );

  const dialog = (
    <PriceUpdateDialog
      open={prompt !== null}
      side={side}
      proposals={prompt?.proposals ?? []}
      skipped={prompt?.skipped}
      onUpdate={(accepted) => settle({ kind: "save", accepted })}
      onJustThisBill={() => settle({ kind: "save", accepted: [] })}
      onBack={() => settle({ kind: "back" })}
    />
  );

  return { enabled, checking, decide, apply, dialog };
}

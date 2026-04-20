import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";

interface POSTabProps {
  biz: { id: string; posEnabled?: boolean };
}

/**
 * Settings → Point-of-Sale tab.
 *
 * Single toggle that flips `pos_enabled` on the current business. When on:
 *   - The /pos fullscreen register route becomes reachable (including in
 *     extra browser tabs, which act as independent terminals).
 *   - A "Switch to POS" entry button appears on the invoice create page.
 *
 * No per-terminal config yet (printer name, drawer kick, etc.) — that lands
 * with the Tauri native-print work in v2.
 */
export function POSTab({ biz }: POSTabProps) {
  const utils = trpc.useUtils();
  const enabled = !!biz.posEnabled;

  const mutation = trpc.business.setPosEnabled.useMutation({
    onSuccess: (row) => {
      toast.success(row.posEnabled ? "POS mode enabled" : "POS mode disabled");
      utils.business.list.invalidate();
      utils.business.getById.invalidate();
    },
    onError: (err) => {
      toast.error("Could not update POS setting", err.message);
    },
  });

  function handleToggle() {
    mutation.mutate({ id: biz.id, enabled: !enabled });
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-text-primary">
              Point-of-Sale mode
            </h3>
            <p className="text-sm text-text-secondary mt-1 leading-relaxed">
              Switch on a cashier-optimised fullscreen register at{" "}
              <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">/pos</code>{" "}
              with item grid, parked sales, thermal receipt printing, and
              barcode-scanner support. Built for retail counters.
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={mutation.isPending}
            role="switch"
            aria-checked={enabled}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
              enabled ? "bg-brand-600" : "bg-surface-3"
            } ${mutation.isPending ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {enabled && (
        <div className="card p-6 space-y-4">
          <h4 className="text-sm font-semibold text-text-primary">
            Using POS mode
          </h4>
          <ul className="text-sm text-text-secondary space-y-2 list-disc pl-5">
            <li>
              Open <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">/pos</code>{" "}
              in one or more browser tabs — each tab is an independent
              terminal.{" "}
              <a
                href="/pos"
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 hover:underline"
              >
                Open POS in a new tab →
              </a>
            </li>
            <li>
              Anonymous sales are attached to a "Walk-in Customer" party. Look
              up returning customers by phone or name inline.
            </li>
            <li>
              Keyboard shortcuts: <kbd>F2</kbd> search, <kbd>F3</kbd> customer,{" "}
              <kbd>F9</kbd> pay, <kbd>Esc</kbd> close modal,{" "}
              <kbd>Alt+1..5</kbd> switch parked carts.
            </li>
            <li>
              Hardware barcode scanners work out of the box — focus doesn't
              matter, the POS shell detects rapid keystrokes as a scan.
            </li>
            <li>
              Thermal receipts print via your system's default printer. First
              print of each session shows the dialog; repeat prints reuse the
              choice.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

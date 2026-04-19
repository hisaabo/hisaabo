import { useEffect, useRef } from "react";
import { getBusinessId } from "@/lib/trpc";

interface Props {
  /** Invoice to print; null means "nothing to print right now". */
  invoiceId: string | null;
  onDone: () => void;
}

/**
 * Fire-and-forget thermal receipt printer.
 *
 * Renders a hidden iframe whose src is the existing
 * `/api/invoices/:id/pdf?format=thermal` endpoint (PDF blob). On iframe
 * load, calls `contentWindow.print()` which shows the browser print dialog
 * the first time and reuses the user's choice on subsequent prints.
 *
 * Why not `window.print()` on the page itself? Because that prints the
 * whole app, not just the receipt. An iframe isolates the print context.
 *
 * x-business-id must be in the URL because iframes can't send custom
 * request headers. The server's /api/invoices/:id/pdf accepts the business
 * id via cookie or header only — so we use a cookie-setting fetch first to
 * ensure business context is on the request. Actually, looking at the
 * server: it reads x-business-id from the request HEADER, not query string,
 * so we have to fetch the PDF blob ourselves and point the iframe at a
 * blob: URL.
 */
export function ReceiptPrinter({ invoiceId, onDone }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/invoices/${invoiceId}/pdf?format=thermal`,
          {
            credentials: "include",
            headers: { "x-business-id": getBusinessId() || "" },
          },
        );
        if (!res.ok) throw new Error(`PDF fetch failed (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;

        // Clean up any prior blob URL before assigning a new one so memory
        // doesn't leak on rapid successive prints.
        if (currentBlobUrlRef.current) {
          URL.revokeObjectURL(currentBlobUrlRef.current);
        }
        const url = URL.createObjectURL(blob);
        currentBlobUrlRef.current = url;

        const iframe = iframeRef.current;
        if (!iframe) return;

        const onLoad = () => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch {
            // Rare: cross-origin weirdness or a user-blocked print.
            // Onboarding/permissions copy should explain the first-print
            // dialog; the print itself is best-effort.
          }
          iframe.removeEventListener("load", onLoad);
          onDone();
        };
        iframe.addEventListener("load", onLoad);
        iframe.src = url;
      } catch (err) {
        console.error("Receipt print failed:", err);
        onDone();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invoiceId, onDone]);

  useEffect(() => {
    return () => {
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
      }
    };
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title="thermal-receipt"
      style={{ display: "none" }}
      aria-hidden="true"
    />
  );
}

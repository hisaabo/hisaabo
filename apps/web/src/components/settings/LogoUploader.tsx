import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";

// Matches the A4 invoice slot (80×56pt) visually so users see how the logo
// will fit before they save. PDFKit preserves the original aspect ratio via
// its `fit` option — no stretching, no cropping. Tall logos pin to height,
// wide logos pin to width.
const PREVIEW_W = 160; // px, 2× the A4 slot for crisp rendering
const PREVIEW_H = 112;

// Client-side downscale cap. Matches server upload cap (1MB decoded) and
// keeps the PDF worker fast. 800px is overkill for an invoice slot.
const MAX_PX = 800;
const MAX_BYTES = 1_048_576;

interface Props {
  businessId: string;
  // Pass from business.list row; used for cache-busting.
  logoUpdatedAt?: string | Date | null;
  hasLogo?: boolean;
}

/**
 * Browser-side logo uploader:
 *   1. Accept PNG / JPEG / SVG via <input type="file">.
 *   2. Draw into a canvas, scaling so max(w, h) ≤ 800px.
 *   3. Export as PNG (lossless, avoids JPEG compression artifacts on flat
 *      logos). SVGs get rasterized here — the server never sees SVG bytes.
 *   4. POST the data URL via the business.uploadLogo tRPC mutation.
 *
 * The server re-validates magic bytes and size; this client code is not a
 * security boundary.
 */
export function LogoUploader({ businessId, logoUpdatedAt, hasLogo }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null);

  const utils = trpc.useUtils();

  const uploadMutation = trpc.business.uploadLogo.useMutation({
    onSuccess: () => {
      toast.success("Logo updated");
      setPreviewDataUrl(null);
      setPreviewDims(null);
      utils.business.list.invalidate();
      utils.business.getById.invalidate();
    },
    onError: (err) => {
      toast.error("Logo upload failed", err.message);
    },
  });

  const deleteMutation = trpc.business.deleteLogo.useMutation({
    onSuccess: () => {
      toast.success("Logo removed");
      utils.business.list.invalidate();
      utils.business.getById.invalidate();
    },
    onError: (err) => {
      toast.error("Could not remove logo", err.message);
    },
  });

  const cacheBuster = typeof logoUpdatedAt === "string"
    ? Date.parse(logoUpdatedAt)
    : logoUpdatedAt?.getTime?.() ?? 0;
  const existingLogoUrl = hasLogo
    ? `/api/businesses/${businessId}/logo?v=${cacheBuster}`
    : null;

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    const allowed = ["image/png", "image/jpeg", "image/svg+xml"];
    if (!allowed.includes(file.type)) {
      toast.error("Unsupported file", "Use PNG, JPEG, or SVG");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large", "Source file must be under 5 MB");
      return;
    }

    setProcessing(true);
    try {
      const { dataUrl, width, height } = await rasterizeAndCompress(file);
      if (dataUrl.length > MAX_BYTES * 1.4) {
        toast.error("Compressed logo too large", "Try a simpler image");
        return;
      }
      setPreviewDataUrl(dataUrl);
      setPreviewDims({ w: width, h: height });
    } catch (err) {
      toast.error("Could not process image", err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
    }
  }

  function handleSave() {
    if (!previewDataUrl || !previewDims) return;
    uploadMutation.mutate({
      id: businessId,
      data: { dataUrl: previewDataUrl, width: previewDims.w, height: previewDims.h },
    });
  }

  function handleRemove() {
    if (!confirm("Remove the business logo?")) return;
    deleteMutation.mutate({ id: businessId });
  }

  const isPending = uploadMutation.isPending || deleteMutation.isPending || processing;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-text-primary">Business Logo</h3>
          <p className="text-xs text-text-tertiary mt-1">
            Appears on invoices and your storefront. PNG, JPEG, or SVG.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-6">
        {/* Preview slot — matches the A4 invoice slot visually so users see
            exactly how the aspect ratio will render on invoices. */}
        <div
          className="flex-shrink-0 border border-dashed border-border rounded bg-background-secondary flex items-center justify-center overflow-hidden"
          style={{ width: PREVIEW_W, height: PREVIEW_H }}
          aria-label="Logo preview"
        >
          {previewDataUrl ? (
            <img
              src={previewDataUrl}
              alt="Pending logo preview"
              className="max-w-full max-h-full object-contain"
            />
          ) : existingLogoUrl ? (
            <img
              src={existingLogoUrl}
              alt="Current business logo"
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <span className="text-xs text-text-tertiary">No logo</span>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            className="hidden"
            onChange={onFileChange}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isPending}
            >
              {previewDataUrl ? "Pick a different file" : "Choose file"}
            </button>
            {previewDataUrl && (
              <button
                type="button"
                className="btn-primary"
                onClick={handleSave}
                disabled={isPending}
              >
                {uploadMutation.isPending ? "Uploading…" : "Save Logo"}
              </button>
            )}
            {hasLogo && !previewDataUrl && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRemove}
                disabled={isPending}
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-text-tertiary leading-relaxed">
            Max 5 MB source file · Auto-resized to 800 px · Aspect ratio
            preserved on invoices and storefront. SVGs are rasterized in your
            browser before upload.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── File → canvas → PNG data URL ────────────────────────────────────────────

async function rasterizeAndCompress(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  // SVGs need a separate path because <img> with `src` draws them, but the
  // Image load gives us the intrinsic size from the SVG viewBox.
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) throw new Error("Could not read image dimensions");

    // Scale so max(w, h) ≤ MAX_PX, preserve aspect.
    const scale = Math.min(1, MAX_PX / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    // Transparent background — PNG preserves alpha. Explicit clearRect is a
    // defensive reset; canvases start transparent but mobile Safari has had
    // quirks in the past.
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(img, 0, 0, outW, outH);

    // Export PNG. JPEG would compress photos better, but logos are line art —
    // PNG avoids JPEG blocking artifacts around sharp edges.
    const dataUrl = canvas.toDataURL("image/png");
    return { dataUrl, width: outW, height: outH };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

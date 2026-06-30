import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { apiUrl } from "@/lib/api-url";
import { toast } from "@/hooks/useToast";

// Product photos can be richer than logos: allow up to 1600px and ~3MB decoded
// (matches the server cap in validate-image.ts).
const MAX_PX = 1600;
const MAX_DECODED_BYTES = 3 * 1024 * 1024;

interface VariantLite {
  id: string;
  attributeValues: Record<string, string>;
}

interface Props {
  itemId: string;
  /** Variants for this item (variants-mode only); enables per-image tagging. */
  variants?: VariantLite[];
}

/**
 * Manage an item's image gallery from the admin app: upload, reorder, set the
 * primary (thumbnail/share) image, tag images to a specific variant, edit alt
 * text, and delete. Bytes are downscaled in the browser, then sent as a data
 * URL; the server re-validates magic bytes + size and stores them in object
 * storage. This client is not a security boundary.
 */
export function ItemImageManager({ itemId, variants = [] }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const utils = trpc.useUtils();

  const { data: images = [], isLoading } = trpc.itemImage.list.useQuery({ itemId });

  const invalidate = () => utils.itemImage.list.invalidate({ itemId });

  const uploadMutation = trpc.itemImage.upload.useMutation({
    onSuccess: () => { invalidate(); },
    onError: (err) => toast.error("Upload failed", err.message),
  });
  const deleteMutation = trpc.itemImage.delete.useMutation({
    onSuccess: () => { invalidate(); toast.success("Image removed"); },
    onError: (err) => toast.error("Could not remove image", err.message),
  });
  const setPrimaryMutation = trpc.itemImage.setPrimary.useMutation({
    onSuccess: () => { invalidate(); },
    onError: (err) => toast.error("Could not set primary", err.message),
  });
  const updateMutation = trpc.itemImage.update.useMutation({
    onSuccess: () => { invalidate(); },
    onError: (err) => toast.error("Could not update image", err.message),
  });
  const reorderMutation = trpc.itemImage.reorder.useMutation({
    onSuccess: () => { invalidate(); },
    onError: (err) => toast.error("Could not reorder", err.message),
  });

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file(s)
    if (files.length === 0) return;

    setUploading(true);
    try {
      // Upload sequentially so sortOrder stays stable and we don't blow the
      // per-item cap with parallel races.
      for (const file of files) {
        const allowed = ["image/png", "image/jpeg", "image/webp"];
        if (!allowed.includes(file.type)) {
          toast.error("Unsupported file", `${file.name}: use PNG, JPEG, or WebP`);
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          toast.error("File too large", `${file.name}: source must be under 10 MB`);
          continue;
        }
        const { dataUrl, width, height } = await rasterize(file);
        if (dataUrl.length > MAX_DECODED_BYTES * 1.4) {
          toast.error("Image too large", `${file.name}: try a smaller image`);
          continue;
        }
        await uploadMutation.mutateAsync({ itemId, dataUrl, width, height });
      }
    } catch (err) {
      toast.error("Could not process image", err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...images];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    reorderMutation.mutate({ itemId, orderedImageIds: next.map((im) => im.id) });
  }

  const busy = uploading || uploadMutation.isPending;

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={onFileChange}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Uploading…" : "Add images"}
        </button>
        <p className="text-[11px] text-text-tertiary">
          PNG, JPEG, or WebP · auto-resized to {MAX_PX}px · up to 12 per item
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-text-tertiary">Loading images…</p>
      ) : images.length === 0 ? (
        <p className="text-xs text-text-tertiary">
          No images yet. The first image you add becomes the storefront thumbnail.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {images.map((img, idx) => (
            <div key={img.id} className="rounded-lg border border-border-light overflow-hidden">
              <div className="relative aspect-square bg-background-secondary">
                <img
                  src={apiUrl(`/api/items/${itemId}/images/${img.id}?v=${new Date(img.updatedAt).getTime()}`)}
                  alt={img.alt ?? ""}
                  className="w-full h-full object-cover"
                />
                {img.isPrimary && (
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold text-white bg-brand-600">
                    Primary
                  </span>
                )}
              </div>

              <div className="p-2 space-y-1.5">
                {/* Reorder + primary + delete */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="w-6 h-6 flex items-center justify-center rounded border border-border-light text-xs text-text-secondary hover:bg-surface-1 disabled:opacity-30"
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0 || reorderMutation.isPending}
                      aria-label="Move left"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="w-6 h-6 flex items-center justify-center rounded border border-border-light text-xs text-text-secondary hover:bg-surface-1 disabled:opacity-30"
                      onClick={() => move(idx, 1)}
                      disabled={idx === images.length - 1 || reorderMutation.isPending}
                      aria-label="Move right"
                    >
                      →
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    {!img.isPrimary && (
                      <button
                        type="button"
                        className="text-[11px] text-brand-600 font-medium"
                        onClick={() => setPrimaryMutation.mutate({ imageId: img.id })}
                      >
                        Set primary
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-[11px] text-red-500"
                      onClick={() => {
                        if (confirm("Remove this image?")) deleteMutation.mutate({ imageId: img.id });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Variant tag (variants-mode items only) */}
                {variants.length > 0 && (
                  <select
                    className="input-field text-[11px] w-full"
                    value={img.variantId ?? ""}
                    onChange={(e) =>
                      updateMutation.mutate({
                        imageId: img.id,
                        variantId: e.target.value === "" ? null : e.target.value,
                      })
                    }
                  >
                    <option value="">All variants (shared)</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {variantLabel(v)}
                      </option>
                    ))}
                  </select>
                )}

                {/* Alt text — saved on blur to avoid a mutation per keystroke */}
                <input
                  className="input-field text-[11px] w-full"
                  placeholder="Alt text (optional)"
                  defaultValue={img.alt ?? ""}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value !== (img.alt ?? "")) {
                      updateMutation.mutate({ imageId: img.id, alt: value || null });
                    }
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function variantLabel(v: VariantLite): string {
  const parts = Object.entries(v.attributeValues).map(([k, val]) => `${k}: ${val}`);
  return parts.length > 0 ? parts.join(" · ") : "Variant";
}

// ── File → canvas → compressed data URL ─────────────────────────────────────
async function rasterize(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) throw new Error("Could not read image dimensions");

    const scale = Math.min(1, MAX_PX / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(img, 0, 0, outW, outH);

    // Preserve alpha for PNG sources; otherwise prefer WebP (smaller) and fall
    // back to JPEG when the browser can't encode WebP.
    let dataUrl: string;
    if (file.type === "image/png") {
      dataUrl = canvas.toDataURL("image/png");
    } else {
      dataUrl = canvas.toDataURL("image/webp", 0.85);
      if (!dataUrl.startsWith("data:image/webp")) {
        dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      }
    }
    return { dataUrl, width: outW, height: outH };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image"));
    image.src = src;
  });
}

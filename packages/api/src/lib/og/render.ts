import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { loadOgFonts, OG_FONT_FAMILY } from "./fonts.js";
import type { OgModel } from "./types.js";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** satori accepts React-element-like plain objects, so we avoid a React dep. */
type El = { type: string; props: Record<string, unknown> };
function h(type: string, style: Record<string, unknown>, children?: unknown): El {
  return { type, props: { style, ...(children !== undefined ? { children } : {}) } };
}

// ── resvg wasm: initialise exactly once ────────────────────────
let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
    wasmReady = initWasm(readFileSync(wasmPath));
  }
  return wasmReady;
}

/** Readable contrast colour for text sitting on the accent background. */
function onAccentText(): string {
  return "#ffffff";
}

function thumb(seller: OgModel["sellers"][number], accent: string): El {
  const img: El = seller.imageDataUri
    ? {
        type: "img",
        props: {
          src: seller.imageDataUri,
          width: 232,
          height: 168,
          style: { width: 232, height: 168, objectFit: "cover", borderRadius: 12 },
        },
      }
    : h(
        "div",
        {
          width: 232,
          height: 168,
          borderRadius: 12,
          background: "#f1f1f4",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 56,
          fontWeight: 700,
          color: accent,
        },
        (seller.name[0] ?? "•").toUpperCase(),
      );

  return h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: 232,
      background: "#ffffff",
      borderRadius: 16,
      padding: 12,
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
    },
    [
      img,
      h(
        "div",
        {
          marginTop: 10,
          fontSize: 22,
          fontWeight: 700,
          color: "#1a1a2e",
          // satori needs explicit clamping; keep to one line.
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          maxWidth: 208,
        },
        seller.name,
      ),
      seller.price
        ? h(
            "div",
            { marginTop: 4, fontSize: 22, fontWeight: 700, color: accent },
            seller.price,
          )
        : h("div", { marginTop: 4, fontSize: 22, color: "#9ca3af" }, " "),
    ],
  );
}

/** Build the satori element tree for a store's OG card. */
function buildCard(model: OgModel): El {
  const accent = model.accentColor;
  const fg = onAccentText();

  const logo: El = model.logoDataUri
    ? {
        type: "img",
        props: {
          src: model.logoDataUri,
          width: 96,
          height: 96,
          style: { width: 96, height: 96, borderRadius: 20, background: "#fff", objectFit: "contain" },
        },
      }
    : h(
        "div",
        {
          width: 96,
          height: 96,
          borderRadius: 20,
          background: "rgba(255,255,255,0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 48,
          fontWeight: 700,
          color: fg,
        },
        (model.storeName[0] ?? "H").toUpperCase(),
      );

  const header = h(
    "div",
    { display: "flex", alignItems: "center", gap: 24 },
    [
      logo,
      h(
        "div",
        { display: "flex", flexDirection: "column", maxWidth: 920 },
        [
          h(
            "div",
            {
              fontSize: 56,
              fontWeight: 700,
              color: fg,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              maxWidth: 920,
            },
            model.storeName,
          ),
          model.tagline
            ? h(
                "div",
                {
                  fontSize: 28,
                  color: fg,
                  opacity: 0.85,
                  marginTop: 4,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  maxWidth: 920,
                },
                model.tagline,
              )
            : h("div", {}, ""),
        ],
      ),
    ],
  );

  const sellersRow =
    model.sellers.length > 0
      ? h(
          "div",
          { display: "flex", gap: 20 },
          model.sellers.map((s) => thumb(s, accent)),
        )
      : h(
          "div",
          { fontSize: 30, color: fg, opacity: 0.85, display: "flex" },
          "Browse the catalogue →",
        );

  const footer = h(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      color: fg,
      fontSize: 24,
    },
    [
      h("div", { display: "flex", opacity: 0.95, fontWeight: 700 }, model.storeUrl),
      h("div", { display: "flex", opacity: 0.8 }, "Powered by Hisaabo"),
    ],
  );

  return h(
    "div",
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: 60,
      background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
      fontFamily: OG_FONT_FAMILY,
    },
    [header, sellersRow, footer],
  );
}

/** Render a store's OG card to a PNG buffer (1200×630). */
export async function renderOgPng(model: OgModel): Promise<Buffer> {
  await ensureWasm();
  const fonts = loadOgFonts();
  const svg = await satori(buildCard(model) as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
  });
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: OG_WIDTH },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}

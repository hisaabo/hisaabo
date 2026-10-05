import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";

/**
 * Fonts for the dynamic OG image. satori does per-glyph fallback across the
 * fonts we hand it, so we ship:
 *   - Noto Sans (Latin) — store names/taglines in English + ₹ digits.
 *   - Noto Sans Devanagari — Hindi/Marathi etc. Without it those glyphs render
 *     as tofu (▢) boxes. en_IN is the primary market, so this is bundled.
 *
 * The .ttf/.woff bytes live in packages/api/fonts/ and are copied into the
 * Docker image (see Dockerfile `COPY packages/api/fonts/`). satori accepts
 * ttf/otf/woff (NOT woff2).
 */
export interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

let cached: OgFont[] | null = null;

/**
 * Locate the bundled fonts directory. This module is inlined into
 * dist/server.js by tsup in production and run from src/ in dev, so the
 * relative depth differs — probe a few candidates and allow an env override.
 */
function resolveFontDir(): string {
  const override = process.env.OG_FONT_DIR;
  if (override && existsSync(override)) return override;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "fonts"), // dist/fonts (if ever colocated)
    join(here, "..", "fonts"), // dist/server.js → packages/api/fonts (prod)
    join(here, "..", "..", "fonts"),
    join(here, "..", "..", "..", "fonts"), // src/lib/og → packages/api/fonts (dev)
    join(here, "..", "..", "..", "..", "fonts"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "NotoSans-Regular.ttf"))) return dir;
  }
  // Last resort — return the most likely prod path; load() will surface a
  // clear error if the files really are missing.
  return join(here, "..", "fonts");
}

/** Load + cache the OG font set. Throws if the Latin base font is missing. */
export function loadOgFonts(): OgFont[] {
  if (cached) return cached;

  const dir = resolveFontDir();
  const read = (file: string): Buffer | null => {
    const path = join(dir, file);
    return existsSync(path) ? readFileSync(path) : null;
  };

  const latinRegular = read("NotoSans-Regular.ttf");
  const latinBold = read("NotoSans-Bold.ttf");
  if (!latinRegular || !latinBold) {
    throw new Error(
      `OG fonts not found in ${dir} (expected NotoSans-Regular.ttf / NotoSans-Bold.ttf). ` +
        `Set OG_FONT_DIR to override.`,
    );
  }

  const fonts: OgFont[] = [
    { name: "Noto Sans", data: latinRegular, weight: 400, style: "normal" },
    { name: "Noto Sans", data: latinBold, weight: 700, style: "normal" },
  ];

  // Devanagari is best-effort — if the files are absent the card still renders,
  // just with tofu for non-Latin scripts. Log once so it's diagnosable.
  const devaRegular = read("NotoSansDevanagari-Regular.woff");
  const devaBold = read("NotoSansDevanagari-Bold.woff");
  if (devaRegular && devaBold) {
    fonts.push(
      { name: "Noto Sans Devanagari", data: devaRegular, weight: 400, style: "normal" },
      { name: "Noto Sans Devanagari", data: devaBold, weight: 700, style: "normal" },
    );
  } else {
    logger.warn({ dir }, "OG Devanagari fonts missing — non-Latin glyphs will not render");
  }

  cached = fonts;
  return fonts;
}

/** The font-family stack to set on OG card text. */
export const OG_FONT_FAMILY = "Noto Sans, Noto Sans Devanagari";

/** Test-only: drop the cache. */
export function __resetOgFontsForTests(): void {
  cached = null;
}

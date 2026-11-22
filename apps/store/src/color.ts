/**
 * Accent colour helpers. Each store picks its own accent, so the storefront
 * cannot assume white text on it, or the accent as text on white, is legible:
 * these derive tokens that meet WCAG AA (4.5:1 for text) for any accent.
 */

export type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
/** The darkest neutral surface the accent is ever used as text on (`--store-bg-alt`). */
const DARKEST_SURFACE: Rgb = [235, 235, 230];
const INK: Rgb = [24, 24, 27];

export function parseHex(hex: string | null | undefined): Rgb | null {
  if (!hex) return null;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) return [short[1], short[2], short[3]].map((c) => parseInt(c + c, 16)) as Rgb;
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (long) return [long[1], long[2], long[3]].map((c) => parseInt(c, 16)) as Rgb;
  return null;
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix toward black (amount > 0) or white (amount < 0). */
function shade(rgb: Rgb, amount: number): Rgb {
  const target = amount >= 0 ? 0 : 255;
  const t = Math.abs(amount);
  return rgb.map((v) => v + (target - v) * t) as Rgb;
}

/** Text colour for use on the accent: white or near-black, whichever reads better. */
export function textOnAccent(accent: Rgb): string {
  return contrastRatio(accent, WHITE) >= contrastRatio(accent, INK) ? "#ffffff" : toHex(INK);
}

/**
 * The accent, darkened only as far as needed to read as text (>= 4.5:1) on every
 * neutral surface of the store, the darkest of which is a little darker than white.
 */
export function accentInk(accent: Rgb): string {
  let rgb = accent;
  // Each pass mixes 8% more black in; 40 passes is far past what any hue needs.
  for (let pass = 0; pass < 40 && contrastRatio(rgb, DARKEST_SURFACE) < 4.5; pass++) rgb = shade(rgb, 0.08);
  return toHex(rgb);
}

export interface AccentTokens {
  accent: string;
  hover: string;
  light: string;
  text: string;
  ink: string;
}

/** CSS custom-property values for a store's accent colour, or null if it is not a hex colour. */
export function accentTokens(hex: string | null | undefined): AccentTokens | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return {
    accent: toHex(rgb),
    hover: toHex(shade(rgb, 0.12)),
    light: toHex(shade(rgb, -0.9)),
    text: textOnAccent(rgb),
    ink: accentInk(rgb),
  };
}

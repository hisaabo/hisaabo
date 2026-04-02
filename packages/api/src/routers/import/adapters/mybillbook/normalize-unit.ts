import { units } from "@hisaabo/shared";
import type { Unit } from "@hisaabo/shared";

// Map MyBillBook (and common variant) unit codes to our canonical units
const mapping: Record<string, Unit> = {
  "BAG": "bag", "BAGS": "bag",
  "BOX": "box", "BOXES": "box",
  "BTL": "btl", "BOTTLE": "btl", "BOTTLES": "btl",
  "BUN": "bun", "BUNCH": "bun", "BUNCHES": "bun",
  "EACH": "pcs",
  "JAR": "jar", "JARS": "jar",
  "KG": "kg", "KGS": "kg", "KILOGRAM": "kg", "KILOGRAMS": "kg",
  "LTR": "l", "L": "l", "LITRE": "l", "LITRES": "l", "LITER": "l",
  "ML": "ml", "MILLILITRE": "ml",
  "M": "m", "METER": "m", "METRE": "m",
  "CM": "cm", "CENTIMETER": "cm",
  "FT": "ft", "FEET": "ft", "FOOT": "ft",
  "IN": "in", "INCH": "in", "INCHES": "in",
  "PAC": "pack", "PACK": "pack", "PACKS": "pack",
  "PCS": "pcs", "PIECE": "pcs", "PIECES": "pcs", "NOS": "pcs", "NUMBERS": "pcs",
  "PERSON": "person", "PERSONS": "person",
  "PET": "pet",
  "PKT": "pkt", "PACKET": "pkt", "PACKETS": "pkt",
  "POCH": "pouch", "POUCH": "pouch", "POUCHES": "pouch",
  "TON": "ton", "TONS": "ton", "TONNE": "ton",
  "DOZEN": "dozen", "DZ": "dozen",
  "PAIR": "pair", "PAIRS": "pair",
  "SET": "set", "SETS": "set",
  "G": "g", "GM": "g", "GMS": "g", "GRAM": "g", "GRAMS": "g",
};

export function normalizeUnit(raw: string): Unit {
  const upper = (raw || "").trim().toUpperCase();
  // Check explicit mapping first
  if (mapping[upper]) return mapping[upper];
  // Fall back to direct match against valid unit list
  if ((units as readonly string[]).includes(upper.toLowerCase())) {
    return upper.toLowerCase() as Unit;
  }
  return "other";
}

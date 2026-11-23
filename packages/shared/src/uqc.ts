/**
 * uqc.ts — Hisaabo unit -> GST UQC (unit quantity code), the ONE map the GSTR-1 HSN summary (Table 12),
 * the e-invoice (IRP) and the e-way bill (NIC) share. They each had their own, and the IRP / NIC ones
 * sent codes that are not on the GST UQC list ("CMT", "FT", "INH", "DZN", "PAR", "JAR", "TNE", "PKT"),
 * which are rejected as an invalid unit; the e-way bill sent "BDL" (bundles) for a bunch.
 *
 * The list below is the GST portal's UQC master as known to the authors; it was NOT re-fetched against
 * the portal when this file was written (UNVERIFIED, see docs/compliance-audit.md item 36). There is
 * no UQC for feet, inches, jars or pouches: those are "OTH". "NA" is the UQC of a service.
 */

/** The UQC list. */
export const UQC_CODES = [
  "BAG", "BAL", "BDL", "BKL", "BOU", "BOX", "BTL", "BUN", "CAN", "CBM", "CCM", "CMS", "CTN", "DOZ", "DRM",
  "GGK", "GMS", "GRS", "GYD", "KGS", "KLR", "KME", "LTR", "MLT", "MTR", "MTS", "NOS", "OTH", "PAC", "PCS",
  "PRS", "QTL", "ROL", "SET", "SQF", "SQM", "SQY", "TBS", "TGM", "THD", "TON", "TUB", "UGS", "UNT", "YDS",
] as const;

/** The UQC of a service (a SAC line): "NA", with a quantity of 0. */
export const UQC_SERVICE = "NA";

const UNIT_TO_UQC: Readonly<Record<string, string>> = {
  // Hisaabo's own unit keys (the `units` list in validators.ts)
  pcs: "NOS", kg: "KGS", g: "GMS", l: "LTR", ml: "MLT", m: "MTR", cm: "CMS",
  ft: "OTH", in: "OTH", // no UQC for feet or inches
  box: "BOX", dozen: "DOZ", pair: "PRS", set: "SET", pkt: "PAC",
  bun: "BUN", // "Bunch (BUN)" in the item form: bunches, not bundles (BDL)
  pouch: "OTH", jar: "OTH", btl: "BTL", bag: "BAG", ton: "TON", pack: "PAC",
  pet: "NOS", person: "NOS", other: "OTH",
  // spellings that arrive through imports
  nos: "NOS", piece: "NOS", pieces: "NOS", unit: "NOS", units: "NOS", number: "NOS",
  kgs: "KGS", kilogram: "KGS", kilograms: "KGS",
  gm: "GMS", gms: "GMS", gram: "GMS", grams: "GMS",
  ltr: "LTR", lts: "LTR", litre: "LTR", litres: "LTR", liter: "LTR",
  mtr: "MTR", meter: "MTR", meters: "MTR", metre: "MTR",
  sqm: "SQM", sqmtr: "SQM", sqf: "SQF", sqft: "SQF", cbm: "CBM",
  doz: "DOZ", boxes: "BOX", bags: "BAG", sets: "SET",
  pk: "PAC", pac: "PAC", packs: "PAC",
  rol: "ROL", roll: "ROL", rolls: "ROL", tub: "TUB", tube: "TUB",
  tonne: "TON", tonnes: "TON",
  mlt: "MLT", millilitre: "MLT", milliliter: "MLT",
  bunch: "BUN", bunches: "BUN", bundle: "BDL", bundles: "BDL",
};

/** The UQC of a unit name (case-insensitive), or null when the unit has no mapping. Callers pick their own fallback ("NOS" / "OTH"). */
export function unitToUqc(unit: string | null | undefined): string | null {
  if (!unit) return null;
  return UNIT_TO_UQC[unit.trim().toLowerCase()] ?? null;
}

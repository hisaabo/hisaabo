// Notification channels — single source of truth for API, web, desktop, mobile,
// CLI and MCP. See docs/architecture/notifications.md §2.
//
// Channel IDs map 1:1 to Android notification channels. Android fixes a
// channel's importance once it is created on a device, so these IDs are FROZEN
// from the first push-enabled release: add new channels, never rename or reuse
// one. Display names are localised and may change freely.

export const CHANNEL_IDS = [
  "money_in",
  "collections",
  "sales",
  "store",
  "payables",
  "banking",
  "compliance",
  "inventory",
  "targets",
  "security",
  "digest",
  "general",
  "promotions",
] as const;

export type ChannelId = (typeof CHANNEL_IDS)[number];

/** Android channel importance. */
export type AndroidImportance = "high" | "default" | "low" | "min";

/** iOS 15+ interruption level used for normal events on this channel. */
export type IosInterruptionLevel = "active" | "passive" | "time-sensitive";

export type Locale = "en" | "hi";
export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "hi"];
export const DEFAULT_LOCALE: Locale = "en";

export interface ChannelDef {
  id: ChannelId;
  name: Record<Locale, string>;
  description: Record<Locale, string>;
  android: AndroidImportance;
  ios: IosInterruptionLevel;
  /** Records on this channel have an owner, so "Only mine" is meaningful. */
  scopeable: boolean;
  /** An amount threshold ("only above ₹X") is meaningful. */
  thresholdable: boolean;
  /** Shown on the lock screen when the user has lock-screen privacy on. */
  privateTitle: Record<Locale, string>;
}

export const CHANNELS: Record<ChannelId, ChannelDef> = {
  money_in: {
    id: "money_in",
    name: { en: "Money received", hi: "प्राप्त भुगतान" },
    description: {
      en: "Payments received and invoices paid in full",
      hi: "प्राप्त भुगतान और पूरी तरह चुकाए गए बिल",
    },
    android: "high",
    ios: "active",
    scopeable: true,
    thresholdable: true,
    privateTitle: { en: "Payment received", hi: "भुगतान प्राप्त हुआ" },
  },
  collections: {
    id: "collections",
    name: { en: "Collections", hi: "वसूली" },
    description: {
      en: "Invoices due today and overdue invoices",
      hi: "आज देय और बकाया बिल",
    },
    android: "high",
    ios: "active",
    scopeable: true,
    thresholdable: false,
    privateTitle: { en: "Payment reminder", hi: "भुगतान अनुस्मारक" },
  },
  sales: {
    id: "sales",
    name: { en: "Sales activity", hi: "बिक्री गतिविधि" },
    description: {
      en: "Invoices and quotations created by your team",
      hi: "आपकी टीम द्वारा बनाए गए बिल और कोटेशन",
    },
    android: "low",
    ios: "passive",
    scopeable: true,
    thresholdable: true,
    privateTitle: { en: "New sales activity", hi: "नई बिक्री गतिविधि" },
  },
  store: {
    id: "store",
    name: { en: "Online store & shipping", hi: "ऑनलाइन स्टोर और शिपिंग" },
    description: {
      en: "New store orders and shipment updates",
      hi: "नए स्टोर ऑर्डर और शिपमेंट अपडेट",
    },
    android: "high",
    ios: "active",
    scopeable: false,
    thresholdable: false,
    privateTitle: { en: "New store order", hi: "नया स्टोर ऑर्डर" },
  },
  payables: {
    id: "payables",
    name: { en: "Payables & expenses", hi: "देय और खर्च" },
    description: {
      en: "Supplier payments, bills due and large expenses",
      hi: "सप्लायर भुगतान, देय बिल और बड़े खर्च",
    },
    android: "default",
    ios: "active",
    scopeable: false,
    thresholdable: true,
    privateTitle: { en: "Payables update", hi: "देय अपडेट" },
  },
  banking: {
    id: "banking",
    name: { en: "Banking & reconciliation", hi: "बैंकिंग और मिलान" },
    description: {
      en: "Statement imports, unmatched transactions and low balances",
      hi: "स्टेटमेंट इम्पोर्ट, बिना मिलान वाले लेन-देन और कम बैलेंस",
    },
    android: "default",
    ios: "active",
    scopeable: false,
    thresholdable: false,
    privateTitle: { en: "Banking update", hi: "बैंकिंग अपडेट" },
  },
  compliance: {
    id: "compliance",
    name: { en: "GST & compliance", hi: "GST और अनुपालन" },
    description: {
      en: "GST due dates, ITC deadlines, e-invoice and e-way bill failures",
      hi: "GST देय तिथियाँ, ITC समय-सीमा, ई-इनवॉइस और ई-वे बिल विफलताएँ",
    },
    android: "high",
    ios: "time-sensitive",
    scopeable: false,
    thresholdable: false,
    privateTitle: { en: "Compliance alert", hi: "अनुपालन अलर्ट" },
  },
  inventory: {
    id: "inventory",
    name: { en: "Inventory", hi: "इन्वेंटरी" },
    description: {
      en: "Low stock and out-of-stock items",
      hi: "कम स्टॉक और स्टॉक में नहीं वाले आइटम",
    },
    android: "default",
    ios: "passive",
    scopeable: false,
    thresholdable: false,
    privateTitle: { en: "Inventory alert", hi: "इन्वेंटरी अलर्ट" },
  },
  targets: {
    id: "targets",
    name: { en: "Targets & performance", hi: "लक्ष्य और प्रदर्शन" },
    description: {
      en: "Progress on your sales targets",
      hi: "आपके बिक्री लक्ष्यों की प्रगति",
    },
    android: "low",
    ios: "passive",
    scopeable: true,
    thresholdable: false,
    privateTitle: { en: "Target update", hi: "लक्ष्य अपडेट" },
  },
  security: {
    id: "security",
    name: { en: "Team & security", hi: "टीम और सुरक्षा" },
    description: {
      en: "Team changes, API keys and account security",
      hi: "टीम में बदलाव, API कुंजियाँ और खाते की सुरक्षा",
    },
    android: "high",
    ios: "time-sensitive",
    scopeable: false,
    thresholdable: false,
    privateTitle: { en: "Security alert", hi: "सुरक्षा अलर्ट" },
  },
  digest: {
    id: "digest",
    name: { en: "Summaries", hi: "सारांश" },
    description: {
      en: "Daily and weekly business summaries",
      hi: "दैनिक और साप्ताहिक व्यापार सारांश",
    },
    android: "default",
    ios: "passive",
    scopeable: false,
    thresholdable: false,
    privateTitle: { en: "Your summary is ready", hi: "आपका सारांश तैयार है" },
  },
  general: {
    id: "general",
    name: { en: "General", hi: "सामान्य" },
    description: {
      en: "Service notices, new features and app updates from Hisaabo",
      hi: "Hisaabo से सेवा सूचनाएँ, नई सुविधाएँ और ऐप अपडेट",
    },
    android: "low",
    ios: "passive",
    scopeable: false,
    thresholdable: false,
    privateTitle: { en: "Update from Hisaabo", hi: "Hisaabo से अपडेट" },
  },
  promotions: {
    id: "promotions",
    name: { en: "Offers & tips", hi: "ऑफ़र और सुझाव" },
    description: {
      en: "Offers, plan upgrades and tips. Only sent if you opt in.",
      hi: "ऑफ़र, प्लान अपग्रेड और सुझाव। केवल आपकी सहमति पर भेजे जाते हैं।",
    },
    android: "min",
    ios: "passive",
    scopeable: false,
    thresholdable: false,
    privateTitle: { en: "Offer from Hisaabo", hi: "Hisaabo से ऑफ़र" },
  },
};

export function isChannelId(value: string): value is ChannelId {
  return (CHANNEL_IDS as readonly string[]).includes(value);
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "hi";
}

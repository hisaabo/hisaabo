// Notification copy in every launch locale (en, hi). Rendered at dispatch time.
// A unit test asserts every event type renders non-empty text in every locale.

import { mapDbRole } from "../permissions.js";
import { CHANNELS, DEFAULT_LOCALE, type Locale } from "./channels.js";
import { EVENTS, type EventPayloads, type EventType } from "./events.js";

export interface RenderedNotification {
  title: string;
  body: string;
}

/** ₹1,20,000 / ₹1,20,000.50 — Indian digit grouping in both locales. */
export function formatInr(amount: string | number, locale: Locale = DEFAULT_LOCALE): string {
  const n = typeof amount === "number" ? amount : Number.parseFloat(amount);
  const value = Number.isFinite(n) ? n : 0;
  const fractional = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: fractional ? 2 : 0,
    maximumFractionDigits: 2,
    numberingSystem: "latn",
  }).format(value);
}

const ROLE_LABELS: Record<string, Record<Locale, string>> = {
  superadmin: { en: "Owner", hi: "मालिक" },
  admin: { en: "Admin", hi: "एडमिन" },
  seller_manager: { en: "Sales manager", hi: "सेल्स मैनेजर" },
  seller: { en: "Seller", hi: "विक्रेता" },
  accountant: { en: "Accountant", hi: "अकाउंटेंट" },
};

export function roleLabel(rawRole: string, locale: Locale): string {
  const role = mapDbRole(rawRole);
  return (role && ROLE_LABELS[role]?.[locale]) || rawRole;
}

type Renderer<T extends EventType> = (p: EventPayloads[T], locale: Locale) => RenderedNotification;

const TEMPLATES: { [T in EventType]: Record<Locale, Renderer<T>> } = {
  "payment.received": {
    en: (p, l) => ({
      title: `${formatInr(p.amount, l)} received from ${p.partyName}`,
      body: p.invoiceNumber
        ? p.invoiceFullyPaid
          ? `Invoice ${p.invoiceNumber} is now fully paid.`
          : `Payment recorded against invoice ${p.invoiceNumber}.`
        : p.paymentNumber ? `Payment ${p.paymentNumber} recorded.` : "Payment recorded.",
    }),
    hi: (p, l) => ({
      title: `${p.partyName} से ${formatInr(p.amount, l)} प्राप्त हुए`,
      body: p.invoiceNumber
        ? p.invoiceFullyPaid
          ? `बिल ${p.invoiceNumber} का पूरा भुगतान हो गया है।`
          : `बिल ${p.invoiceNumber} के लिए भुगतान दर्ज किया गया।`
        : p.paymentNumber ? `भुगतान ${p.paymentNumber} दर्ज किया गया।` : "भुगतान दर्ज किया गया।",
    }),
  },
  "payment.made": {
    en: (p, l) => ({
      title: `${formatInr(p.amount, l)} paid to ${p.partyName}`,
      body: p.paymentNumber ? `Payment ${p.paymentNumber} recorded.` : "Payment recorded.",
    }),
    hi: (p, l) => ({
      title: `${p.partyName} को ${formatInr(p.amount, l)} का भुगतान किया गया`,
      body: p.paymentNumber ? `भुगतान ${p.paymentNumber} दर्ज किया गया।` : "भुगतान दर्ज किया गया।",
    }),
  },
  "invoice.due_today": {
    en: (p, l) => ({
      title: `${p.partyName}: ${formatInr(p.amountDue, l)} due today`,
      body: `Invoice ${p.invoiceNumber} is due today. Send a reminder?`,
    }),
    hi: (p, l) => ({
      title: `${p.partyName}: ${formatInr(p.amountDue, l)} आज देय`,
      body: `बिल ${p.invoiceNumber} आज देय है। रिमाइंडर भेजें?`,
    }),
  },
  "invoice.overdue": {
    en: (p, l) => ({
      title: `${p.partyName}: ${formatInr(p.amountDue, l)} overdue`,
      body: `Invoice ${p.invoiceNumber} is ${p.daysOverdue} days overdue.`,
    }),
    hi: (p, l) => ({
      title: `${p.partyName}: ${formatInr(p.amountDue, l)} बकाया`,
      body: `बिल ${p.invoiceNumber} ${p.daysOverdue} दिन से बकाया है।`,
    }),
  },
  "store.order_placed": {
    en: (p, l) => ({
      title: `New order ${p.orderNumber}: ${formatInr(p.totalAmount, l)}`,
      body: `${p.customerName} ordered ${p.itemCount} ${p.itemCount === 1 ? "item" : "items"}. Confirm the order.`,
    }),
    hi: (p, l) => ({
      title: `नया ऑर्डर ${p.orderNumber}: ${formatInr(p.totalAmount, l)}`,
      body: `${p.customerName} ने ${p.itemCount} आइटम ऑर्डर किए। ऑर्डर की पुष्टि करें।`,
    }),
  },
  "einvoice.failed": {
    en: (p) => ({
      title: `E-invoice failed for ${p.invoiceNumber}`,
      body: `IRN could not be generated: ${p.error}. Fix and retry before sharing the invoice.`,
    }),
    hi: (p) => ({
      title: `${p.invoiceNumber} का ई-इनवॉइस विफल`,
      body: `IRN नहीं बन सका: ${p.error}। बिल भेजने से पहले सुधारकर दोबारा प्रयास करें।`,
    }),
  },
  "team.member_joined": {
    en: (p, l) => ({
      title: `${p.memberName} joined your team`,
      body: `Role: ${roleLabel(p.role, l)}.`,
    }),
    hi: (p, l) => ({
      title: `${p.memberName} आपकी टीम में शामिल हुए`,
      body: `भूमिका: ${roleLabel(p.role, l)}।`,
    }),
  },
  "team.role_changed": {
    en: (p, l) => ({
      title: `Role changed for ${p.memberName}`,
      body: `${roleLabel(p.fromRole, l)} → ${roleLabel(p.toRole, l)}.`,
    }),
    hi: (p, l) => ({
      title: `${p.memberName} की भूमिका बदली गई`,
      body: `${roleLabel(p.fromRole, l)} → ${roleLabel(p.toRole, l)}।`,
    }),
  },
  "api_key.created": {
    en: (p) => ({
      title: `New API key "${p.keyName}" created`,
      body: `${p.createdByName} created key ${p.keyPrefix}…. If this wasn't expected, revoke it now.`,
    }),
    hi: (p) => ({
      title: `नई API कुंजी "${p.keyName}" बनाई गई`,
      body: `${p.createdByName} ने कुंजी ${p.keyPrefix}… बनाई। अगर यह अपेक्षित नहीं था, तो इसे अभी रद्द करें।`,
    }),
  },
  "general.announcement": {
    en: (p) => ({ title: p.title.en, body: p.body.en }),
    hi: (p) => ({ title: p.title.hi || p.title.en, body: p.body.hi || p.body.en }),
  },
};

export function renderNotification<T extends EventType>(
  type: T,
  payload: EventPayloads[T],
  locale: Locale = DEFAULT_LOCALE,
): RenderedNotification {
  const byLocale = TEMPLATES[type] as Record<Locale, Renderer<T>>;
  const render = byLocale[locale] ?? byLocale[DEFAULT_LOCALE];
  return render(payload, locale);
}

/** Lock-screen-safe text: no amounts, no party names. */
export function renderPrivate(type: EventType, locale: Locale = DEFAULT_LOCALE): RenderedNotification {
  const channel = CHANNELS[EVENTS[type].channel];
  return { title: channel.privateTitle[locale], body: "Hisaabo" };
}

export const TEMPLATE_LOCALES = TEMPLATES;

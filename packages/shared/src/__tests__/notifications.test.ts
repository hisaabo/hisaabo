import { describe, it, expect } from "vitest";
import {
  CHANNEL_IDS,
  CHANNELS,
  EVENTS,
  EVENT_TYPES,
  SUPPORTED_LOCALES,
  ROLE_DEFAULTS,
  decideDelivery,
  formatInr,
  isChannelLockedFor,
  isEligible,
  isWithinQuietHours,
  renderNotification,
  renderPrivate,
  resolvePreference,
  type EventContext,
  type EventPayloads,
  type EventType,
  type RecipientContext,
} from "../notifications/index.js";

const SAMPLE: { [T in EventType]: EventPayloads[T] } = {
  "payment.received": {
    paymentId: "p1", paymentNumber: "PAY-00001", amount: "120000", partyName: "Sharma Traders",
    invoiceId: "i1", invoiceNumber: "INV-104", invoiceFullyPaid: true,
  },
  "payment.made": { paymentId: "p2", paymentNumber: null, amount: "5000.5", partyName: "Gupta Supplies" },
  "invoice.due_today": { invoiceId: "i1", invoiceNumber: "INV-104", partyName: "Sharma Traders", amountDue: "48500" },
  "invoice.overdue": { invoiceId: "i1", invoiceNumber: "INV-104", partyName: "Sharma Traders", amountDue: "48500", daysOverdue: 30 },
  "store.order_placed": { orderId: "o1", orderNumber: "ORD-7", customerName: "Asha", totalAmount: "999", itemCount: 1 },
  "einvoice.failed": { invoiceId: "i1", invoiceNumber: "INV-104", error: "Invalid GSTIN" },
  "team.member_joined": { memberUserId: "u2", memberName: "Ravi", role: "seller" },
  "team.role_changed": { memberUserId: "u2", memberName: "Ravi", fromRole: "seller", toRole: "seller_manager" },
  "api_key.created": { keyName: "CLI", keyPrefix: "hisaabo_key_abcd", createdByName: "Meera" },
  "general.announcement": { title: { en: "New", hi: "नया" }, body: { en: "Feature", hi: "सुविधा" } },
};

const NOW_DAY = new Date("2026-10-10T06:30:00Z"); // 12:00 IST
const NOW_NIGHT = new Date("2026-10-10T18:30:00Z"); // 00:00 IST

function event(type: EventType, extra: Partial<EventContext> = {}): EventContext {
  return { type, actorUserId: "actor", ownerUserId: "owner", subjectUserId: null, amountPaise: 100_00, now: NOW_DAY, ...extra };
}
function recipient(role: string, extra: Partial<RecipientContext> = {}): RecipientContext {
  return { userId: "me", role, ...extra };
}

describe("catalog", () => {
  it("every event maps to a known channel", () => {
    for (const t of EVENT_TYPES) expect(CHANNEL_IDS).toContain(EVENTS[t].channel);
  });

  it("every channel has names, descriptions and private titles in every locale", () => {
    for (const id of CHANNEL_IDS) {
      for (const l of SUPPORTED_LOCALES) {
        expect(CHANNELS[id].name[l]).toBeTruthy();
        expect(CHANNELS[id].description[l]).toBeTruthy();
        expect(CHANNELS[id].privateTitle[l]).toBeTruthy();
      }
    }
  });

  it("every role has a default for every channel; promotions never pushes by default", () => {
    for (const defaults of Object.values(ROLE_DEFAULTS)) {
      for (const id of CHANNEL_IDS) expect(defaults[id]).toBeDefined();
      expect(defaults.promotions.delivery).not.toBe("push");
    }
  });
});

describe("templates", () => {
  it("every event type renders non-empty en and hi text", () => {
    for (const t of EVENT_TYPES) {
      for (const l of SUPPORTED_LOCALES) {
        const r = renderNotification(t, SAMPLE[t] as never, l);
        expect(r.title.trim(), `${t}/${l} title`).not.toBe("");
        expect(r.body.trim(), `${t}/${l} body`).not.toBe("");
        expect(r.title + r.body).not.toMatch(/undefined|null|NaN|\s{2}/);
      }
    }
  });

  it("hindi copy is actually hindi", () => {
    expect(renderNotification("payment.received", SAMPLE["payment.received"], "hi").title).toMatch(/[ऀ-ॿ]/);
  });

  it("formats amounts with Indian grouping and latin digits in both locales", () => {
    expect(formatInr("120000", "en")).toBe("₹1,20,000");
    expect(formatInr("120000.5", "en")).toBe("₹1,20,000.50");
    expect(formatInr("120000", "hi")).toContain("1,20,000");
  });

  it("private rendering carries no amount or party", () => {
    const r = renderPrivate("payment.received", "en");
    expect(r.title).toBe("Payment received");
    expect(r.title + r.body).not.toMatch(/₹|Sharma/);
  });
});

describe("eligibility", () => {
  it("sellers never receive banking/compliance/payables events", () => {
    expect(isEligible(EVENTS["einvoice.failed"], "seller")).toBe(false);
    expect(isEligible(EVENTS["payment.made"], "seller")).toBe(false);
    expect(isEligible(EVENTS["payment.received"], "seller")).toBe(true);
  });

  it("seller managers can receive collections", () => {
    expect(isEligible(EVENTS["invoice.overdue"], "seller_manager")).toBe(true);
  });

  it("unknown roles receive nothing", () => {
    expect(isEligible(EVENTS["general.announcement"], "hacker")).toBe(false);
  });

  it("compliance is locked for owners, admins and accountants; security for everyone", () => {
    expect(isChannelLockedFor("compliance", "superadmin")).toBe(true);
    expect(isChannelLockedFor("compliance", "owner")).toBe(true);
    expect(isChannelLockedFor("compliance", "accountant")).toBe(true);
    expect(isChannelLockedFor("compliance", "seller_manager")).toBe(false);
    expect(isChannelLockedFor("security", "seller")).toBe(true);
    expect(isChannelLockedFor("money_in", "superadmin")).toBe(false);
  });
});

describe("resolvePreference", () => {
  it("business beats tenant beats role default", () => {
    expect(resolvePreference("superadmin", "sales").preference.delivery).toBe("digest");
    const t = resolvePreference("superadmin", "sales", { delivery: "inbox" });
    expect(t).toMatchObject({ preference: { delivery: "inbox" }, source: "tenant" });
    const b = resolvePreference("superadmin", "sales", { delivery: "inbox" }, { delivery: "push" });
    expect(b).toMatchObject({ preference: { delivery: "push" }, source: "business" });
  });

  it("null override fields fall through", () => {
    const r = resolvePreference("seller", "money_in", { delivery: null, scope: "everyone" }, { delivery: "inbox" });
    expect(r.preference).toMatchObject({ delivery: "inbox", scope: "everyone" });
  });

  it("scope and threshold are ignored on channels where they mean nothing", () => {
    const r = resolvePreference("superadmin", "store", { scope: "mine", thresholdPaise: 500 });
    expect(r.preference.scope).toBe("everyone");
    expect(r.preference.thresholdPaise).toBeNull();
  });
});

describe("decideDelivery", () => {
  it("owner gets a push for a payment", () => {
    const d = decideDelivery(event("payment.received"), recipient("superadmin"));
    expect(d).toMatchObject({ inbox: true, push: true, skip: null });
  });

  it("seller only gets payments on their own invoices", () => {
    expect(decideDelivery(event("payment.received", { ownerUserId: "someone" }), recipient("seller")).skip).toBe("not_mine");
    expect(decideDelivery(event("payment.received", { ownerUserId: "me" }), recipient("seller")).push).toBe(true);
    // ...unless they widen their scope
    const wide = recipient("seller", { tenantOverride: { scope: "everyone" } });
    expect(decideDelivery(event("payment.received", { ownerUserId: "someone" }), wide).push).toBe(true);
  });

  it("seller manager gets collections for every invoice", () => {
    const d = decideDelivery(event("invoice.overdue", { actorUserId: null, ownerUserId: "a-seller" }), recipient("seller_manager"));
    expect(d.push).toBe(true);
  });

  it("nobody is notified about their own action, except security", () => {
    expect(decideDelivery(event("payment.received", { actorUserId: "me" }), recipient("superadmin")).skip).toBe("self");
    const own = event("api_key.created", { actorUserId: "me", subjectUserId: "me" });
    expect(decideDelivery(own, recipient("seller")).inbox).toBe(true);
    // An admin changing someone else's role is not told about their own action
    const other = event("team.role_changed", { actorUserId: "me", subjectUserId: "ravi" });
    expect(decideDelivery(other, recipient("admin")).skip).toBe("self");
  });

  it("ineligible roles are skipped even if they opt in", () => {
    const d = decideDelivery(event("einvoice.failed"), recipient("seller", { tenantOverride: { delivery: "push" } }));
    expect(d.skip).toBe("not_eligible");
  });

  it("off means nothing, digest/inbox mean inbox without push", () => {
    expect(decideDelivery(event("payment.received"), recipient("superadmin", { tenantOverride: { delivery: "off" } })).skip).toBe("off");
    const digest = decideDelivery(event("payment.received"), recipient("superadmin", { tenantOverride: { delivery: "digest" } }));
    expect(digest).toMatchObject({ inbox: true, push: false, pushWithheld: "preference" });
  });

  it("locked compliance failures ignore 'off', always email, and bypass quiet hours", () => {
    const r = recipient("accountant", { tenantOverride: { delivery: "off", email: false } });
    const d = decideDelivery(event("einvoice.failed", { now: NOW_NIGHT }), r);
    expect(d).toMatchObject({ inbox: true, push: true, email: true, locked: true });
  });

  it("seller managers are not eligible for e-invoice failures", () => {
    expect(decideDelivery(event("einvoice.failed"), recipient("seller_manager")).skip).toBe("not_eligible");
  });

  it("security events only reach admins and the subject", () => {
    const e = event("team.role_changed", { subjectUserId: "ravi" });
    expect(decideDelivery(e, recipient("seller")).skip).toBe("not_in_audience");
    expect(decideDelivery(e, { userId: "ravi", role: "seller" }).inbox).toBe(true);
    expect(decideDelivery(e, recipient("admin")).inbox).toBe(true);
  });

  it("threshold withholds push but keeps the inbox entry", () => {
    const r = recipient("superadmin", { tenantOverride: { thresholdPaise: 10_000_00 } });
    const d = decideDelivery(event("payment.received", { amountPaise: 500_00 }), r);
    expect(d).toMatchObject({ inbox: true, push: false, pushWithheld: "threshold" });
  });

  it("quiet hours withhold non-urgent push; user can turn quiet hours off", () => {
    const night = event("payment.received", { now: NOW_NIGHT });
    expect(decideDelivery(night, recipient("superadmin")).pushWithheld).toBe("quiet_hours");
    expect(decideDelivery(night, recipient("superadmin", { quietStart: null, quietEnd: null })).push).toBe(true);
  });

  it("paused users get inbox only", () => {
    const d = decideDelivery(event("payment.received"), recipient("superadmin", { pausedUntil: new Date(NOW_DAY.getTime() + 60_000) }));
    expect(d.pushWithheld).toBe("paused");
  });
});

describe("isWithinQuietHours", () => {
  it("handles windows that wrap midnight, in IST", () => {
    expect(isWithinQuietHours(NOW_NIGHT, "22:00", "08:00")).toBe(true);
    expect(isWithinQuietHours(NOW_DAY, "22:00", "08:00")).toBe(false);
    expect(isWithinQuietHours(NOW_DAY, "11:00", "13:00")).toBe(true);
    expect(isWithinQuietHours(NOW_DAY, "bad", "08:00")).toBe(false);
  });
});

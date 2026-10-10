// Preference model and the pure decision function used by the dispatcher.
// See docs/architecture/notifications.md §3.
//
// Resolution order, most specific first:
//   business preference → tenant default → role default
// then the hard rules, which preferences can never override:
//   eligibility (permissions) → locked events → quiet hours / caps.

import { defineAbilityFor, mapDbRole, type RoleName } from "../permissions.js";
import { CHANNELS, CHANNEL_IDS, type ChannelId } from "./channels.js";
import { EVENTS, type Audience, type EventDef, type EventType } from "./events.js";

export type Delivery = "push" | "inbox" | "digest" | "off";
export type Scope = "mine" | "everyone";

export const DELIVERIES: readonly Delivery[] = ["push", "inbox", "digest", "off"];
export const SCOPES: readonly Scope[] = ["mine", "everyone"];

export interface ChannelPreference {
  delivery: Delivery;
  scope: Scope;
  /** Push only when the event amount is at least this many paise. null = no threshold. */
  thresholdPaise: number | null;
  /** Also send an email copy. */
  email: boolean;
}

/** A stored override: any field left null falls through to the next level. */
export interface PreferenceOverride {
  delivery?: Delivery | null;
  scope?: Scope | null;
  thresholdPaise?: number | null;
  email?: boolean | null;
}

export type PreferenceSource = "role_default" | "tenant" | "business";

const p = (delivery: Delivery, scope: Scope = "everyone", email = false): ChannelPreference => ({
  delivery,
  scope,
  thresholdPaise: null,
  email,
});

type RoleDefaults = Record<ChannelId, ChannelPreference>;

// promotions: the explicit opt-in (user settings) is the consent gate; until a
// user opts in, decideDelivery drops promotions whatever the delivery says.
const OWNER_DEFAULTS: RoleDefaults = {
  money_in: p("push"),
  collections: p("push"),
  sales: p("digest"),
  store: p("push"),
  payables: p("inbox"),
  banking: p("inbox"),
  compliance: p("push", "everyone", true),
  inventory: p("inbox"),
  targets: p("digest"),
  security: p("push", "everyone", true),
  digest: p("push", "everyone", true),
  general: p("inbox"),
  promotions: p("inbox"),
};

/** Role defaults (docs §3.2). Ineligible channels are filtered by eligibility, not here. */
export const ROLE_DEFAULTS: Record<RoleName, RoleDefaults> = {
  superadmin: OWNER_DEFAULTS,
  admin: OWNER_DEFAULTS,
  seller_manager: {
    money_in: p("push"),
    collections: p("push"),
    sales: p("push"),
    store: p("push"),
    payables: p("off"),
    banking: p("off"),
    compliance: p("off"),
    inventory: p("push"),
    targets: p("push"),
    security: p("push", "everyone", true),
    digest: p("push", "everyone", true),
    general: p("inbox"),
    promotions: p("inbox"),
  },
  seller: {
    money_in: p("push", "mine"),
    collections: p("push", "mine"),
    sales: p("inbox", "mine"),
    store: p("off"),
    payables: p("off"),
    banking: p("off"),
    compliance: p("off"),
    inventory: p("off"),
    targets: p("push", "mine"),
    security: p("push", "everyone", true),
    digest: p("push", "mine", true),
    general: p("inbox"),
    promotions: p("inbox"),
  },
  accountant: {
    money_in: p("inbox"),
    collections: p("push"),
    sales: p("off"),
    store: p("off"),
    payables: p("push"),
    banking: p("push"),
    compliance: p("push", "everyone", true),
    inventory: p("off"),
    targets: p("off"),
    security: p("push", "everyone", true),
    digest: p("inbox", "everyone", true),
    general: p("inbox"),
    promotions: p("inbox"),
  },
};

const NO_ROLE_DEFAULTS: RoleDefaults = Object.fromEntries(
  CHANNEL_IDS.map((c) => [c, p("off")]),
) as RoleDefaults;

export function roleDefault(rawRole: string | null | undefined, channel: ChannelId): ChannelPreference {
  const role = mapDbRole(rawRole);
  return { ...(role ? ROLE_DEFAULTS[role] : NO_ROLE_DEFAULTS)[channel] };
}

/** Merge role default ← tenant override ← business override, reporting the most specific source used. */
export function resolvePreference(
  rawRole: string | null | undefined,
  channel: ChannelId,
  tenantOverride?: PreferenceOverride | null,
  businessOverride?: PreferenceOverride | null,
): { preference: ChannelPreference; source: PreferenceSource } {
  const preference = roleDefault(rawRole, channel);
  let source: PreferenceSource = "role_default";
  for (const [override, level] of [[tenantOverride, "tenant"], [businessOverride, "business"]] as const) {
    if (!override) continue;
    let applied = false;
    if (override.delivery != null) { preference.delivery = override.delivery; applied = true; }
    if (override.scope != null) { preference.scope = override.scope; applied = true; }
    if (override.thresholdPaise !== undefined && override.thresholdPaise !== null) {
      preference.thresholdPaise = override.thresholdPaise;
      applied = true;
    }
    if (override.email != null) { preference.email = override.email; applied = true; }
    if (applied) source = level;
  }
  if (!CHANNELS[channel].scopeable) preference.scope = "everyone";
  if (!CHANNELS[channel].thresholdable) preference.thresholdPaise = null;
  return { preference, source };
}

// ── Eligibility ──────────────────────────────────────────────────────────────

const ADMIN_ROLES: readonly RoleName[] = ["superadmin", "admin"];

export function isInAudience(
  audience: Audience,
  rawRole: string | null | undefined,
  userId: string,
  subjectUserId: string | null | undefined,
): boolean {
  const role = mapDbRole(rawRole);
  if (!role) return false;
  const isAdmin = ADMIN_ROLES.includes(role);
  const isSubject = !!subjectUserId && subjectUserId === userId;
  switch (audience) {
    case "business": return true;
    case "admins": return isAdmin;
    case "subject": return isSubject;
    case "subject_and_admins": return isAdmin || isSubject;
  }
}

/** Hard permission gate: may this role receive this event at all? */
export function isEligible(event: EventDef, rawRole: string | null | undefined): boolean {
  const ability = defineAbilityFor(rawRole);
  if (!ability.role) return false;
  return event.requires.every(([action, resource]) => ability.can(action, resource));
}

/** Is this event locked on (cannot be muted) for this role? */
export function isLockedFor(event: EventDef, rawRole: string | null | undefined): boolean {
  if (!event.lockedFor) return false;
  if (event.lockedFor === "all") return true;
  const role = mapDbRole(rawRole);
  return !!role && event.lockedFor.includes(role);
}

/**
 * A channel is locked for a role when every event on it that the role may
 * receive is locked. Used by settings UIs to disable the toggle.
 */
export function isChannelLockedFor(channel: ChannelId, rawRole: string | null | undefined): boolean {
  const events = Object.values(EVENTS).filter(
    (e) => e.channel === channel && isEligible(e, rawRole),
  );
  return events.length > 0 && events.every((e) => isLockedFor(e, rawRole));
}

/** Can this role receive anything at all on this channel? */
export function isChannelAvailableFor(channel: ChannelId, rawRole: string | null | undefined): boolean {
  if (channel === "security") return !!mapDbRole(rawRole);
  if (channel === "promotions" || channel === "general" || channel === "digest") return !!mapDbRole(rawRole);
  return Object.values(EVENTS).some((e) => e.channel === channel && isEligible(e, rawRole));
}

// ── Quiet hours ──────────────────────────────────────────────────────────────

/** "HH:MM" → minutes after midnight, or null if malformed. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minutes after local midnight for `now` in `timeZone`. */
export function minutesInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((x) => x.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((x) => x.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export const DEFAULT_QUIET_START = "22:00";
export const DEFAULT_QUIET_END = "08:00";
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export function isWithinQuietHours(
  now: Date,
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): boolean {
  const start = parseClock(quietStart);
  const end = parseClock(quietEnd);
  if (start === null || end === null || start === end) return false;
  const t = minutesInTimeZone(now, timeZone);
  // Window may wrap past midnight (22:00 → 08:00).
  return start < end ? t >= start && t < end : t >= start || t < end;
}

// ── Decision ─────────────────────────────────────────────────────────────────

export interface RecipientContext {
  userId: string;
  role: string | null | undefined;
  tenantOverride?: PreferenceOverride | null;
  businessOverride?: PreferenceOverride | null;
  /** User-global settings. quietStart/quietEnd: undefined = defaults, null = off. */
  pausedUntil?: Date | null;
  quietStart?: string | null;
  quietEnd?: string | null;
  promotionsOptIn?: boolean;
}

export interface EventContext {
  type: EventType;
  actorUserId: string | null;
  /** The user who owns the record ("mine"): invoice creator, target owner, … */
  ownerUserId: string | null;
  /** The user an own-account or team event is about. */
  subjectUserId: string | null;
  amountPaise: number | null;
  now: Date;
  timeZone?: string;
}

export type SkipReason =
  | "not_in_audience"
  | "not_eligible"
  | "self"
  | "off"
  | "not_mine"
  | "promotions_not_opted_in";

export interface DeliveryDecision {
  inbox: boolean;
  push: boolean;
  email: boolean;
  locked: boolean;
  skip: SkipReason | null;
  /** Why push was withheld while the inbox still gets the entry. */
  pushWithheld: "preference" | "threshold" | "quiet_hours" | "paused" | null;
}

const NONE = (skip: SkipReason): DeliveryDecision => ({
  inbox: false, push: false, email: false, locked: false, skip, pushWithheld: null,
});

/**
 * Decide how (and whether) one recipient receives one event. Pure: the
 * dispatcher gathers the inputs, this function makes every policy decision so
 * it can be unit-tested exhaustively.
 */
export function decideDelivery(event: EventContext, recipient: RecipientContext): DeliveryDecision {
  const def = EVENTS[event.type];

  if (!isInAudience(def.audience, recipient.role, recipient.userId, event.subjectUserId)) {
    return NONE("not_in_audience");
  }
  if (!isEligible(def, recipient.role)) return NONE("not_eligible");

  // Nobody is notified of their own action — except security events about
  // their own account (e.g. "API key created"): if the account is compromised,
  // that alert (and its email copy) is how the real owner finds out.
  const isSelf = !!event.actorUserId && event.actorUserId === recipient.userId;
  const ownAccountSecurity = def.channel === "security" && event.subjectUserId === recipient.userId;
  if (isSelf && !ownAccountSecurity) return NONE("self");

  if (def.channel === "promotions" && !recipient.promotionsOptIn) {
    return NONE("promotions_not_opted_in");
  }

  const locked = isLockedFor(def, recipient.role);
  const { preference } = resolvePreference(
    recipient.role, def.channel, recipient.tenantOverride, recipient.businessOverride,
  );

  if (!locked) {
    if (preference.delivery === "off") return NONE("off");
    if (preference.scope === "mine" && CHANNELS[def.channel].scopeable) {
      if (!event.ownerUserId || event.ownerUserId !== recipient.userId) return NONE("not_mine");
    }
  }

  const decision: DeliveryDecision = {
    inbox: true,
    push: false,
    email: locked || preference.email,
    locked,
    skip: null,
    pushWithheld: null,
  };

  const wantsPush = locked || preference.delivery === "push";
  if (!wantsPush) {
    decision.pushWithheld = "preference";
    return decision;
  }
  if (
    !locked &&
    preference.thresholdPaise !== null &&
    event.amountPaise !== null &&
    event.amountPaise < preference.thresholdPaise
  ) {
    decision.pushWithheld = "threshold";
    return decision;
  }
  if (!def.urgent) {
    if (recipient.pausedUntil && recipient.pausedUntil > event.now) {
      decision.pushWithheld = "paused";
      return decision;
    }
    if (isWithinQuietHours(
      event.now,
      // undefined = no settings row → defaults; null = user turned quiet hours off
      recipient.quietStart === undefined ? DEFAULT_QUIET_START : recipient.quietStart,
      recipient.quietEnd === undefined ? DEFAULT_QUIET_END : recipient.quietEnd,
      event.timeZone,
    )) {
      decision.pushWithheld = "quiet_hours";
      return decision;
    }
  }
  decision.push = true;
  return decision;
}

/** Rupee amount string ("1234.50") → integer paise, or null. */
export function amountToPaise(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

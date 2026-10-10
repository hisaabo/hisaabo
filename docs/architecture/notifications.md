# Notifications Architecture for Hisaabo

**Status**: Proposed (design agreed, not yet built)
**Date**: 2026-10-10
**Supersedes**: [online-store.md §10](online-store.md#10-notification-flow) (store-order notifications become one channel of this system)

---

## Table of Contents

1. [Philosophy](#1-philosophy)
2. [Channels](#2-channels)
3. [Recipients: eligibility, role defaults, preferences](#3-recipients-eligibility-role-defaults-preferences)
4. [Multi-tenancy rules](#4-multi-tenancy-rules)
5. [Delivery surfaces](#5-delivery-surfaces)
6. [Architecture](#6-architecture)
7. [Data model](#7-data-model)
8. [Push delivery: Gorush (Hisaabo Cloud)](#8-push-delivery-gorush-hisaabo-cloud)
9. [Quotas and rate limits](#9-quotas-and-rate-limits)
10. [Self-hosted deployments](#10-self-hosted-deployments)
11. [Store policy compliance (Play Store, App Store, F-Droid)](#11-store-policy-compliance-play-store-app-store-f-droid)
12. [Noise control](#12-noise-control)
13. [Client parity (web, desktop, mobile, CLI, MCP)](#13-client-parity-web-desktop-mobile-cli-mcp)
14. [Phases](#14-phases)
15. [Decision log](#15-decision-log)
16. [Open items](#16-open-items)

---

## 1. Philosophy

1. **Every notification must earn its interruption.** It is about money (in, out, stuck), it asks for an action, or it warns of a risk. Engagement comes from being useful ("₹1.2L overdue across 4 parties — send reminders?"), never from nagging ("We miss you!"). Accounting users abandon apps that spam them.
2. **Eligibility is not preference.** Permissions (`packages/shared/src/permissions.ts`) decide who *may* receive an event; role defaults decide what is *on out of the box*; the user's own preferences decide the rest. A seller never receives a bank alert, even if they try to enable it.
3. **Audience scope per channel: "Only mine" vs "Everyone's".** A seller wants to know when *their* invoice is paid; an owner does not want a buzz for every sale the team makes.
4. **Digests over firehoses.** High-volume channels default to the daily summary for roles that only need the aggregate.
5. **The in-app inbox is the system of record.** Push, email, web push and (later) WhatsApp are delivery transports for an inbox entry. Disabling push never loses information.
6. **Agent-native parity.** The inbox and preferences are tRPC procedures, so web, desktop, mobile, CLI and MCP get identical capabilities. Significant actions taken by AI agents or API keys notify the humans ("An agent created 12 invoices").
7. **Content stays private.** Push payloads are end-to-end encrypted to the device ([§8.4](#84-end-to-end-encrypted-payloads)), so Apple, Google and our own push infrastructure never see amounts or party names.

---

## 2. Channels

These map 1:1 to **Android notification channels**. Once a channel ships, its ID is permanent, and its importance is fixed once created on a device (only the user can change it afterwards). So **IDs are frozen from the first push-enabled release**. Display names can be localised and changed freely.

| # | Channel ID | Display name | Example events | Importance (Android / iOS interruption level) | User can mute? |
|---|---|---|---|---|---|
| 1 | `money_in` | Money received | Payment recorded, gateway payment captured, invoice fully paid, refund/reversal | HIGH / active | Yes |
| 2 | `collections` | Collections | Invoice due today, overdue at 7/30/60 days, party over credit limit, promise-to-pay date reached | HIGH / active | Yes |
| 3 | `sales` | Sales activity | Invoice/quote created by the team, quote converted, invoice edited or cancelled | LOW / passive | Yes (owners default to digest) |
| 4 | `store` | Online store & shipping | New store order, order cancelled, shipment delayed / delivered / RTO | HIGH / active | Yes |
| 5 | `payables` | Payables & expenses | Supplier bill due, large expense recorded, recurring bill generated | DEFAULT / active | Yes |
| 6 | `banking` | Banking & reconciliation | Statement imported, unmatched lines waiting, low balance | DEFAULT / active | Yes |
| 7 | `compliance` | GST & compliance | GSTR-1/3B due in 3 days / today, ITC nearing 180 days (Sec 16(4)), e-invoice IRN failed, e-way bill expiring | HIGH / time-sensitive (failures and due-today only) | Reminders: yes. **Failures: locked on for owners and accountants** ([§11.1](#111-always-on-alerts-what-locked-means)) |
| 8 | `inventory` | Inventory | Low stock, out of stock, negative stock | DEFAULT / passive | Yes |
| 9 | `targets` | Targets & performance | 50% / 100% of target reached, behind pace | LOW / passive | Yes |
| 10 | `security` | Team & security | New device sign-in, member joined, role changed, API key created, data export run | HIGH / time-sensitive | **No** (security only) |
| 11 | `digest` | Summaries | Daily summary (sales, collections, cash, overdue), weekly business review | DEFAULT / passive | Yes; delivery time is configurable |
| 12 | `general` | General | Hisaabo service notices: new features relevant to the user's role, scheduled maintenance, plan/billing notices, app update available | LOW / passive | Yes |
| 13 | `promotions` | Offers & tips | Marketing: offers, plan upgrades, webinars, onboarding tips | MIN / passive | Yes. **Off by default, explicit opt-in** ([§11.3](#113-promotions-opt-in)) |

`general` vs `promotions`: `general` is information about the service the user already uses (legitimate-interest, on by default, mutable). `promotions` is anything that tries to sell or upsell. If in doubt, it is `promotions`.

Fixed rule: a notification is published to exactly one channel. New event types are added to an existing channel. A new channel is a deliberate decision recorded in [§15](#15-decision-log).

---

## 3. Recipients: eligibility, role defaults, preferences

### 3.1 Eligibility (hard gate)

Each event type declares the permission a recipient needs, expressed against the existing role matrix:

| Channel | Required ability |
|---|---|
| `money_in` | `read:Payment` |
| `collections` | `read:Invoice` + `read:Party` |
| `sales` | `read:Invoice` |
| `store` | `read:Store` |
| `payables` | `read:Expense` |
| `banking` | `read:BankTransaction` |
| `compliance` | `read:GstReport` (IRN/EWB failures: `read:EInvoice` / `read:EWayBill`) |
| `inventory` | `read:Item` |
| `targets` | `read:SalesTarget` |
| `security` | Own-account events: everyone. Team events: `manage:Team` |
| `digest` | Per-section: each digest section is filtered by the ability its source channel requires |
| `general`, `promotions` | Everyone |

Eligibility is evaluated **at dispatch time** with `defineAbilityFor(role)`, so role changes and removals take effect immediately.

### 3.2 Role defaults

The starting point only; users override per channel.

| Channel | Owner / Admin | Seller manager | Seller | Accountant |
|---|---|---|---|---|
| Money received | Everyone's · push | Everyone's · push | **Mine** · push | Everyone's · inbox |
| Collections | Everyone's · push | Everyone's · push | Mine · push | Everyone's · push |
| Sales activity | **Digest only** | Everyone's · push | Mine · inbox | Off |
| Store & shipping | Push | Push | Off | Off |
| Payables & expenses | Inbox | — | — | Push |
| Banking & recon | Inbox | — | — | Push |
| GST & compliance | Push (failures locked) | — | — | Push (failures locked) |
| Inventory | Inbox | Push | Off | Off |
| Targets | Digest | Push | Push | — |
| Team & security | Always | Own account | Own account | Own account |
| Summaries | Daily 21:00 | Daily 21:00 | Daily 21:00 (own numbers) | Weekly (Mon 09:00) |
| General | Inbox | Inbox | Inbox | Inbox |
| Promotions | Off | Off | Off | Off |

"—" = not eligible ([§3.1](#31-eligibility-hard-gate)).

### 3.3 Preference knobs (per channel)

- **Delivery**: `push` (push + inbox) · `inbox` (inbox only) · `digest` (only appears in the summary) · `off`
- **Scope**: `mine` · `everyone` (only on channels where records have an owner: `money_in`, `collections`, `sales`, `targets`)
- **Threshold** (optional): minimum amount, for `money_in`, `payables`, `sales`
- **Email copy**: on/off (default on for `compliance` and `digest` only)

"Mine" means the record's `created_by_user_id` (invoices, payments) or the target's `user_id`. For collections, it is the invoice creator. Seller managers receive collections for **every** invoice in the business (default scope `everyone`), so a seller's overdue invoice always reaches both the seller and the seller manager(s). There is no reporting-line field today, so a seller manager sees all sellers' collections rather than only their own team's. If manager→seller reporting lines are added later, the seller manager's default narrows to "my team".

### 3.4 Preference resolution (per business)

Most specific wins:

```
business-level preference  (user, tenant, business, channel)
  → tenant-level default    (user, tenant, business = NULL, channel)
    → role default          (§3.2, code constant in @hisaabo/shared)
then
  eligibility gate (§3.1)   — always applied last; cannot be overridden
  locked rules (§11.1)      — force inbox + email even if delivery = off
  global mute / quiet hours — user-level (§12)
```

UI: one list per tenant by default. A **"Customise for each business"** link appears only when the tenant has more than one business the user can access.

---

## 4. Multi-tenancy rules

1. **Notification identity is `(user, tenant, business)`.** Someone who is an owner in tenant A and an accountant in tenant B gets different defaults and eligibility in each.
2. **Data placement** follows the existing control/tenant split:
   - **Tenant DB** (`tenant-schema.ts`): event outbox, inbox entries, per-business preferences. Tenant data never leaves the tenant DB and is deleted with it.
   - **Control DB** (`control-schema.ts`): device registrations (push tokens + device public keys), user-global settings (quiet hours, pause all, language, lock-screen privacy), per-tenant unread counters for the cross-tenant badge, quota counters.
3. **Every push carries `tenantId` and `businessId`** inside the encrypted payload. When the user taps a notification, the client switches to that tenant and business *before* navigating to the record. A notification must never open into the wrong tenant context. If the user is no longer a member, show "You no longer have access to this business" and drop the deep link.
4. **Recipients are resolved at dispatch, not at emit time.** Removed members, pending invitations, suspended tenants and deleted users get nothing.
5. **Device registrations are bound to sessions.** Sign-out, session revocation and session rotation (`session-rotation.ts`) delete or re-bind the registration, so a revoked session stops receiving push immediately.
6. **Business time zone** governs quiet hours, digest delivery time and due-date reminders. Default `Asia/Kolkata`.
7. **Tenant lifecycle**: suspension pauses dispatch (outbox rows are kept and expire). Deletion removes the tenant's outbox, inbox and preferences with the tenant DB. Control-side counters for that tenant are purged in the same flow.
8. **User deletion** (DPDP right to erasure): delete device registrations and global settings in the control DB. Inbox rows in each tenant are anonymised (recipient cleared) on the next sweep.

---

## 5. Delivery surfaces

| Priority | Surface | Transport | Phase |
|---|---|---|---|
| 1 | **In-app inbox** (bell + per-tenant unread count) | tRPC | 1 |
| 2 | **Mobile push** (Play / App Store builds) | FCM / APNs via Gorush | 1 |
| 3 | **Email** | existing Resend service (`lib/email.ts`) | 1 (compliance fallback), 2 (digest) |
| 4 | **Web push** (web + desktop) | Web Push / VAPID (RFC 8030/8291/8292), service worker | 2 |
| 5 | **UnifiedPush** (F-Droid build; self-hosters on Android) | Web Push to the UnifiedPush distributor endpoint | 2 |
| 6 | **WhatsApp** | WhatsApp Business API | 3, **paid plans only** |
| — | SMS | not used for notifications (OTP only) | — |

Desktop (Tauri) uses web push in its webview where supported. Otherwise `tauri-plugin-notification`, fed by the inbox stream while the app is open.

---

## 6. Architecture

```
 Domain write (tRPC mutation, webhook, scheduler)
   │  same DB transaction
   ▼
 notification_outbox (tenant DB)                 Scheduled sweeps (per tenant, business TZ)
   │                                                overdue · GST due dates · ITC age · low stock
   │                                                · target pace · digests
   │                                                         │ insert into outbox
   ▼                                                         ▼
 Dispatcher (in-process worker, ticks like recurring-invoice-scheduler.ts,
             SELECT … FOR UPDATE SKIP LOCKED, iterates active tenants)
   │ 1. resolve candidate recipients (tenant_members ⨝ role)
   │ 2. eligibility gate (permissions.ts)
   │ 3. preferences (§3.4) → delivery per recipient
   │ 4. dedupe (event key) · grouping window · quiet hours · per-user caps
   │ 5. write notification_inbox rows      ← system of record
   │ 6. enqueue transports
   ▼
 Transport layer (PushProvider interface)
   ├─ GorushProvider      → Gorush (private network) → FCM / APNs     [cloud]
   ├─ WebPushProvider     → browser push service / UnifiedPush endpoint
   ├─ EmailProvider       → Resend
   ├─ WhatsAppProvider    → (Phase 3, plan-gated)
   └─ NoopProvider        → self-hosted without push configured
   │
   ▼
 Delivery results → prune dead tokens (control DB), quota counters, metrics
```

**Event emission** is a single helper, `emitNotificationEvent(tx, { type, businessId, subjectId, actorUserId, actorKind, payload, dedupeKey })`, called inside the same transaction as the domain write. If the write rolls back, the notification never exists. `actorKind` is `user | api_key | agent | system`, so agent/API activity can be reported distinctly.

**Self-notification suppression**: the actor is never notified of their own action (except security events such as "new sign-in").

**Templates** live in `@hisaabo/shared` as `{type → (payload, locale) → {title, body, deepLink}}`. They are rendered at dispatch time (so a later locale change applies) and shared with the CLI/MCP for parity. **Launch locales: English (`en`) and Hindi (`hi`).** Every template must exist in both before an event type ships, enforced by a unit test. Amounts use Indian digit grouping (₹1,20,000) in both locales. The recipient's locale comes from the user's app language setting, falling back to `en`. Other Indian languages come later.

**Retention**: inbox rows kept for 90 days, outbox rows deleted 7 days after dispatch. Both handled by the existing cleanup timers in `server.ts`.

---

## 7. Data model

Indicative only; final column names are decided at implementation.

### Tenant DB

```ts
notification_outbox     id, business_id, event_type, channel, subject_type, subject_id,
                        actor_user_id, actor_kind, payload jsonb, dedupe_key (unique),
                        status (pending|dispatched|expired), attempts, available_at, created_at

notification_inbox      id, business_id, recipient_user_id, channel, event_type,
                        title, body, deep_link, subject_type, subject_id, group_key,
                        priority, read_at, archived_at, created_at
                        idx (recipient_user_id, read_at, created_at desc)

notification_prefs      user_id, business_id NULL = tenant default, channel,
                        delivery (push|inbox|digest|off), scope (mine|everyone),
                        threshold_paise bigint NULL, email boolean, updated_at
                        unique (user_id, business_id, channel)
```

### Control DB

```ts
push_devices            id, user_id, session_id, platform (ios|android|web|unifiedpush),
                        app_flavor (play|appstore|fdroid|web|desktop),
                        token / endpoint (encrypted at rest, crypto.ts),
                        device_public_key, auth_secret, locale, app_version,
                        last_seen_at, created_at
                        unique (platform, token)

user_notification_settings  user_id, quiet_start, quiet_end, pause_until,
                            lock_screen_privacy boolean, promotions_opt_in_at,
                            promotions_opt_in_source

tenant_unread_counters  user_id, tenant_id, unread_count, updated_at

push_quota_usage        scope (instance|tenant|user), scope_id, window_start, count
```

---

## 8. Push delivery: Gorush (Hisaabo Cloud)

### 8.1 Why Gorush

| Option | License | Verdict |
|---|---|---|
| [Gorush](https://github.com/appleboy/gorush) (Go) | MIT | **Chosen.** Single static binary with an official Docker image (`appleboy/gorush`, runs as a non-root user). Covers APNs (token auth), FCM HTTP v1 and HMS. Has a sync mode that returns per-token failures, Prometheus `/metrics`, `/healthz`, and optional Redis/NATS queues. Actively maintained (v1.22.0, July 2026). |
| [Sygnal](https://github.com/matrix-org/sygnal) | Apache 2.0 | Architectural reference only (Matrix's push gateway). Its API is Matrix-specific. |
| [ntfy](https://github.com/binwiederhier/ntfy) | Apache 2.0 / GPLv2 | UnifiedPush distributor for the F-Droid / self-hosted path ([§10](#10-self-hosted-deployments)). Not our cloud gateway. |
| Expo Push Service | proprietary, hosted | Rejected: adds a third party to the data path. The app registers native FCM/APNs tokens (`getDevicePushTokenAsync`) instead. |

MIT is compatible with O'Saasy. Gorush runs as a separate, unmodified container, so no license obligations flow into our code beyond keeping its notice.

### 8.2 Topology

```
 hisaabo-api (N replicas) ──HTTP, private network──▶ gorush ──▶ FCM / APNs
        ▲                                               │
        └──────── sync response (failed tokens) ────────┘
```

- **Gorush has no authentication on `/api/push`.** It must **never** be published on a host port or the internet. It is reachable only on the internal Docker network (or a private VPC subnet / k8s ClusterIP with a NetworkPolicy that admits only the API pods).
- **Sync mode** (`core.sync: true`, local queue): the API gets per-token results in the HTTP response, so it can delete dead tokens without a feedback webhook. Durability comes from our outbox, not from Gorush's queue. A failed call leaves the outbox row pending for retry.
- **Scaling**: Gorush is stateless in sync mode. Run 2 replicas behind the internal service name for availability. Move to the Redis queue + `feedback_hook_url` only if push volume makes synchronous calls a bottleneck (not expected before ~1M pushes/day).

### 8.3 Bringing up Gorush (Docker)

**Credentials** (owned by the Hisaabo Cloud org, never committed):

| Secret | Where to get it | Mounted at |
|---|---|---|
| FCM service-account JSON | Firebase console → Project settings → Service accounts → Generate new private key (project that owns `in.hisaabo.app`) | `/run/secrets/fcm.json` |
| APNs auth key (`.p8`) + Key ID + Team ID | Apple Developer → Certificates, IDs & Profiles → Keys → new key with APNs enabled | `/run/secrets/apns.p8` |

Use a token-based APNs key (`.p8`), not certificates. It does not expire yearly and covers both sandbox and production.

**`docker-compose.push.yml`** (override file used with `docker-compose.prod.yml` on Hisaabo Cloud only):

```yaml
# Usage (Hisaabo Cloud only — self-hosters do not run this, see §10):
#   docker compose --env-file .env.prod \
#     -f docker-compose.prod.yml -f docker-compose.push.yml up -d
services:
  gorush:
    image: appleboy/gorush:1.22.0          # pin; bump via Dependabot like other images
    restart: unless-stopped
    # NO `ports:` — internal network only. /api/push is unauthenticated.
    environment:
      GORUSH_CORE_PORT: "8088"
      GORUSH_CORE_MODE: release
      GORUSH_CORE_SYNC: "true"
      GORUSH_CORE_WORKER_NUM: "0"          # 0 = runtime.NumCPU()
      GORUSH_CORE_MAX_NOTIFICATION: "500"  # max notifications per request
      GORUSH_QUEUE_ENGINE: local
      GORUSH_STAT_ENGINE: memory
      GORUSH_ANDROID_ENABLED: "true"
      GORUSH_ANDROID_KEY_PATH: /run/secrets/fcm.json
      GORUSH_ANDROID_MAX_RETRY: "2"
      GORUSH_IOS_ENABLED: "true"
      GORUSH_IOS_KEY_PATH: /run/secrets/apns.p8
      GORUSH_IOS_KEY_TYPE: p8
      GORUSH_IOS_KEY_ID: ${APNS_KEY_ID:?set APNS_KEY_ID}
      GORUSH_IOS_TEAM_ID: ${APNS_TEAM_ID:?set APNS_TEAM_ID}
      GORUSH_IOS_PRODUCTION: "true"
      GORUSH_IOS_MAX_RETRY: "2"
      GORUSH_LOG_HIDE_TOKEN: "true"
      GORUSH_LOG_HIDE_MESSAGES: "true"     # payloads are ciphertext anyway
      GORUSH_LOG_ACCESS_LEVEL: info
    secrets:
      - source: fcm_service_account
        target: /run/secrets/fcm.json
      - source: apns_auth_key
        target: /run/secrets/apns.p8
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop: [ALL]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8088/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging:
      driver: journald
      options: { tag: hisaabo-gorush }

  api:
    environment:
      PUSH_PROVIDER: gorush
      GORUSH_URL: http://gorush:8088
      APNS_TOPIC: in.hisaabo.app
    depends_on:
      gorush:
        condition: service_healthy

secrets:
  fcm_service_account:
    file: ./secrets/fcm.json
  apns_auth_key:
    file: ./secrets/apns.p8
```

**Steps**

1. Place the FCM JSON and APNs `.p8` in `./secrets/` on the host (`chmod 600`, owned by root). Add `secrets/` to `.gitignore` and to the backup exclusion list.
2. Add `APNS_KEY_ID`, `APNS_TEAM_ID` to `.env.prod`.
3. `docker compose … -f docker-compose.push.yml up -d gorush` and check `docker compose exec api wget -qO- http://gorush:8088/healthz`.
4. Smoke test from inside the API container with a real device token (staging Firebase project + `GORUSH_IOS_PRODUCTION=false` for TestFlight/dev builds).
5. Confirm Gorush is unreachable from outside the host: `curl http://<public-ip>:8088/healthz` must fail.
6. Scrape `http://gorush:8088/metrics` from the internal Prometheus (if/when added). Alert on the failure-rate ratio.

**Environments**: staging uses a separate Firebase project and `GORUSH_IOS_PRODUCTION=false`. Never point staging at production credentials.

**Key rotation**: replace the file, then `docker compose restart gorush`. APNs keys can be revoked in the Apple portal. FCM service-account keys are rotated in Google Cloud IAM.

**Image updates**: pin an exact version (`1.22.0`). Add `docker-compose.push.yml` to Dependabot's `docker-compose` ecosystem so it gets the same weekly bumps as the other images. Run the smoke test from step 4 on each bump.

### 8.4 End-to-end encrypted payloads

Goal: FCM, APNs and Gorush only ever see ciphertext. This satisfies App Store guideline 4.5.4 on sensitive information and keeps business data private.

1. On registration the app generates a P-256 key pair and a 16-byte auth secret (the same primitives as Web Push, RFC 8291). The private key is kept in Keychain / Android Keystore via `expo-secure-store`. The public key and auth secret are sent with the device registration.
2. The dispatcher encrypts `{title, body, deepLink, tenantId, businessId, notificationId, channel}` with `aes128gcm` (RFC 8188) to that device key. One code path serves FCM/APNs, browser Web Push and UnifiedPush.
3. Push messages carry: a fixed placeholder (`"New notification"` / `"Hisaabo"`), the ciphertext in a data field, `mutable_content: true` (iOS) and the channel ID (Android).
4. **iOS**: a Notification Service Extension decrypts and replaces the title/body before display. If decryption fails, the placeholder shows and tapping opens the inbox. **Android**: a data message is decrypted in the FCM messaging service and the notification is posted locally on the correct channel.
5. **Lock-screen privacy** setting: when on, the decrypted notification shows "Payment received · Hisaabo" without the amount or party. The full text appears in-app.
6. Size budget: FCM and APNs cap at 4 KB. Payloads are kept short and the client fetches anything larger from the inbox by `notificationId`.

> Expo note: decrypting in an iOS Notification Service Extension and handling Android data messages natively requires a config plugin plus native code. Phase 0 must prove this works in the Expo 55 prebuild setup.

---

### 8.5 Why Firebase at all

We use exactly **one** Firebase product: **Firebase Cloud Messaging (FCM)**. No Analytics, Crashlytics, Remote Config or Auth. FCM is free.

- **Android needs it.** On Android devices with Google Play services (practically every phone sold in India), FCM is the only way to wake an app that is not running. Android's battery management (Doze, app standby, OEM task killers on Xiaomi, Vivo, Oppo, Realme) kills an app's own background connections. The OS keeps one shared connection open to Google for every app, and FCM is how an app uses it. A "Firebase project" is just the container Google requires for the FCM credentials (the service-account JSON) and the `google-services.json` built into the app.
- **iOS does not need it.** Gorush talks to APNs directly with our `.p8` key. Firebase is not involved on iOS.
- **Alternatives considered for Android:**
  - *UnifiedPush*: works without Google, but the user must install and configure a separate distributor app (e.g. ntfy). Fine for F-Droid users and self-hosters, but too much friction for a Play Store shopkeeper. It is the `fdroid` flavor's transport, not the default.
  - *Our own persistent connection*: needs a permanent foreground-service notification, drains battery, is still killed by aggressive OEMs, and Play restricts foreground-service types. Rejected.
  - *Huawei (HMS) devices without Google services*: Gorush supports HMS. Add it only if usage data shows meaningful Huawei/Honor installs.
- **Privacy cost is small.** Payloads are end-to-end encrypted ([§8.4](#84-end-to-end-encrypted-payloads)), so Google sees only a device token, the timing and size of messages, and ciphertext.
- **Ownership**: the Firebase project and the Apple Developer account belong to the Hisaabo organisation, not an individual, with at least two admins and documented key rotation ([§8.3](#83-bringing-up-gorush-docker)).

---

## 9. Quotas and rate limits

Push volume costs money (infrastructure, support) and, more importantly, **sender reputation**: Apple and Google throttle senders that look abusive. Quotas protect the shared credentials from one runaway tenant, bug or loop.

Three layers, all enforced in the API's `GorushProvider` before calling Gorush, with counters in `push_quota_usage` (control DB, fixed windows, atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING count`):

| Layer | Scope | Default | On breach |
|---|---|---|---|
| **Per instance** | Each deployment holding push credentials (prod cloud, staging, each preview env) is an instance, identified by `PUSH_INSTANCE_ID`. | prod: 2,000,000 / day, 2,000 / min burst · staging: 10,000 / day · preview: 1,000 / day | Hard stop for push. Inbox + email continue. Page on-call at 80%. |
| **Per tenant** | One cloud tenant, by plan (`plan-limits.ts` → `pushPerDay`) | free: 500 / day · pro: 5,000 · business: 20,000 · enterprise: custom | Further pushes for that tenant are downgraded to inbox until the window resets. `security` and locked `compliance` events are exempt. Owner gets one inbox notice ("Push limit reached today"). |
| **Per user** | One recipient across all their tenants | 60 / hour, 200 / day; per-channel caps in [§12](#12-noise-control) | Overflow rolls into the next digest. |

All defaults are env-configurable (`PUSH_QUOTA_INSTANCE_DAY`, `PUSH_QUOTA_INSTANCE_MIN`, …) and reviewed after Phase 1 against real volumes.

Visibility: owners see "Pushes sent today: n / limit" in notification settings. Ops sees per-instance and per-tenant counters in the admin CLI (`packages/api/src/bin/admin.ts`).

---

## 10. Self-hosted deployments

**Decision: Hisaabo Cloud's push credentials are not shared with self-hosted instances. There is no public relay.** The official Play / App Store apps therefore cannot receive FCM/APNs pushes from a self-hosted server. Self-hosters get the full notification system (inbox, preferences, digests) and choose their own transport:

| Option | Effort | Platforms |
|---|---|---|
| **In-app inbox** | none (always on) | all |
| **Email** (digests, compliance) | configure `RESEND_API_KEY` (already required for sign-in) | all |
| **Web push** (web + desktop) | none beyond HTTPS. The server auto-generates its VAPID key pair on first boot. | browsers, desktop |
| **UnifiedPush via their own ntfy** | run `binwiederhier/ntfy` (Apache 2.0). Users install the ntfy app and point it at that server. | Android (Play and F-Droid builds), no Google services needed |
| **Own app build + own Gorush** | fork the mobile app with their own bundle ID, Firebase project and APNs key; run [§8.3](#83-bringing-up-gorush-docker) with those credentials (`PUSH_PROVIDER=gorush`) | Android + iOS |

The default is `PUSH_PROVIDER=none`, plus web push and UnifiedPush, which work without any third-party credentials. The settings screen shows which transports the server supports, so self-hosted users are never promised push that will not arrive. Per-instance quotas ([§9](#9-quotas-and-rate-limits)) apply to self-hosters only if they enable Gorush, and default to unlimited there.

---

## 11. Store policy compliance (Play Store, App Store, F-Droid)

### 11.1 Always-on alerts: what "locked" means

No app can stop a user from disabling notifications at the OS level, either per channel on Android or per app on iOS. Trying to work around it (re-prompting loops, misusing critical alerts) risks rejection. So **locked** means:

- the in-app toggle is disabled (with an explanation) for **owners/admins and accountants** on `compliance` failure events, and for everyone on `security`;
- the event **always** lands in the inbox;
- the event **always** sends an email copy, independent of push;
- if the OS has blocked the app or the `compliance` channel, the app shows a persistent, dismissible-per-session banner: *"GST alerts are turned off on this device. Turn on in Settings."* with a deep link to the system settings.

Due-date reminders in `compliance` remain mutable. Only failures (IRN failed, e-way bill expiring with goods in transit, ITC about to lapse) are locked.

### 11.2 Platform rules applied

| Platform | Rule | Our approach |
|---|---|---|
| iOS | Push must not be required for the app to function (4.5.4) | Inbox gives full functionality without push |
| iOS | No sensitive personal/confidential info in push (4.5.4) | E2E-encrypted payloads ([§8.4](#84-end-to-end-encrypted-payloads)) + lock-screen privacy |
| iOS | Marketing pushes need explicit in-app opt-in and an in-app opt-out (4.5.4) | `promotions` off by default ([§11.3](#113-promotions-opt-in)) |
| iOS | Critical Alerts entitlement is for health/safety/security | **Not requested.** Use `time-sensitive` only for `security` and `compliance` failures / due-today |
| Android 13+ | `POST_NOTIFICATIONS` runtime permission | Ask in context (after first payment received or first store order), never on first launch. Explain the value first. |
| Android | Channels must reflect real categories, and users control them | 13 channels exactly as [§2](#2-channels), created at first launch with the documented importance |
| Play | Data safety form | Declare: device identifiers (push token), app interactions. Data encrypted in transit; user can request deletion. |
| App Store | Privacy nutrition label | Same declarations as Play |
| F-Droid | No proprietary libraries (Firebase SDK → `NonFreeDep` anti-feature); contacting Google servers → `NonFreeNet` | Separate **`fdroid` build flavor** without Firebase, using **UnifiedPush** only. Falls back to inbox + fetch-on-open when no distributor is installed. |
| India — DPDP Act 2023 | Consent for marketing must be free, specific, informed and withdrawable | `promotions` opt-in records timestamp + source. One-tap withdrawal. |

### 11.3 Promotions opt-in

- Off for every user by default, including existing users after the feature launches.
- Turned on only by an explicit control with clear wording ("Send me offers and tips from Hisaabo"). Never bundled with the OS permission prompt or another consent.
- Opt-in timestamp and source stored (`promotions_opt_in_at`, `promotions_opt_in_source`). Every promotional push or email includes a one-tap way to turn it off.
- Promotions never use HIGH importance, never ignore quiet hours, and are capped at 2 per week per user.

---

## 12. Noise control

- **Dedupe**: `dedupe_key` is unique in the outbox (e.g. `payment.captured:<gatewayPaymentId>`), so retried webhooks never double-notify.
- **Grouping**: events of the same type, business and recipient within a 10-minute window are collapsed ("5 new store orders"). This uses `group_key` in the inbox, `collapse_key` on Android and `thread-id`/`collapse_id` on iOS.
- **Quiet hours**: default 22:00–08:00 in the business time zone. Only `security` and locked `compliance` events bypass them. Everything else is held and delivered at the end of quiet hours (or folded into the digest).
- **Caps**: per user per channel per day (e.g. `sales` 20, `inventory` 10, `general` 1, `promotions` 2/week). Overflow goes to the digest.
- **Actionable notifications** (Phase 3): "Send reminder", "Record payment", "Accept order". These call the same tRPC procedures with the user's session and are subject to the same permission checks.
- **Feedback loop**: per-channel delivery, open and opt-out rates (aggregated, no content) reviewed monthly. A channel whose opt-out rate climbs is too noisy, so fix its defaults or thresholds.

---

## 13. Client parity (web, desktop, mobile, CLI, MCP)

New tRPC router `notification`:

| Procedure | Purpose |
|---|---|
| `notification.list` | Inbox, paginated, filter by channel / unread / business |
| `notification.unreadCounts` | Per business and per tenant (cross-tenant badge) |
| `notification.markRead` / `markAllRead` / `archive` | Inbox state |
| `notification.prefs.get` / `prefs.update` | Resolved preferences with source (`role-default` / `tenant` / `business`) and `locked` flags |
| `notification.devices.register` / `unregister` / `list` | Push registrations for the current session |
| `notification.settings.get` / `update` | Quiet hours, pause, lock-screen privacy, promotions consent |
| `notification.transports` | Which transports this server supports (§10) |

CLI: `hisaabo notifications [list|read|prefs]`. MCP: `notifications_list`, `notifications_mark_read`, `notification_prefs_get`. These are covered by the parity check like every other procedure, with no entries in `parity-exceptions.yaml`. Agents get read access to their own inbox, so an agent can act on "Invoice INV-104 is 30 days overdue".

---

## 14. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0: Spikes** (~1 week) | Gorush in staging; E2E-encrypted push to a real Android and iOS device (NSE + Android data message in Expo prebuild); `fdroid` flavor builds without Firebase and receives a UnifiedPush message via ntfy | All three proven, or a documented fallback |
| **1: Foundation** | Outbox + `emitNotificationEvent`, dispatcher, inbox, preferences (per business), role defaults, eligibility, quotas, mobile push for `money_in`, `collections`, `store`, `security`; `compliance` failures with email fallback; notification settings screens on web + mobile; CLI/MCP read parity | Owner receives a payment push within 10 s; seller never receives an ineligible event (tests); quota breach degrades to inbox |
| **2: Breadth** | Remaining channels incl. `general` and `promotions` with consent; daily/weekly digest (push + email); scheduled sweeps; web push (web + desktop); UnifiedPush; thresholds; grouping; quiet hours | Digest delivered at business-local time; opt-out rate per channel visible |
| **3: Depth** | Actionable notifications; WhatsApp transport (**paid plans only**, gated in `plan-limits.ts`); smarter nudges; agent-activity alerts | WhatsApp cost per tenant tracked; free plan cannot trigger it |

---

## 15. Decision log

| # | Decision | Date |
|---|---|---|
| D1 | Inbox is the system of record. Push/email/web push/WhatsApp are transports. | 2026-10-10 |
| D2 | 13 channels as in §2, IDs frozen from the first push-enabled release. `general` and `promotions` added for flexibility. | 2026-10-10 |
| D3 | Preferences per business within a tenant, with tenant-level defaults and role defaults beneath. | 2026-10-10 |
| D4 | Gorush (MIT) is the cloud push gateway, run as a private sidecar. Expo Push Service not used. | 2026-10-10 |
| D5 | No push relay for self-hosters. They use inbox, email, web push, UnifiedPush, or their own app build + Gorush. | 2026-10-10 |
| D6 | Per-instance, per-tenant and per-user push quotas. | 2026-10-10 |
| D7 | `compliance` failures locked on for owners/admins and accountants (inbox + email always), within store policy. `security` locked for all. | 2026-10-10 |
| D8 | WhatsApp is Phase 3 and paid plans only. | 2026-10-10 |
| D9 | Push payloads are end-to-end encrypted to the device. | 2026-10-10 |
| D10 | F-Droid build ships without Firebase and uses UnifiedPush. | 2026-10-10 |
| D11 | Collections: "mine" = invoice creator; seller managers get collections for all invoices by default. | 2026-10-10 |
| D12 | Launch locales are English and Hindi; other languages later. | 2026-10-10 |
| D13 | Customer-facing messaging (to parties/store customers) is out of scope and designed separately. | 2026-10-10 |
| D14 | Only FCM is used from Firebase (Android delivery); iOS uses APNs directly. Firebase and Apple accounts are org-owned with 2+ admins. | 2026-10-10 |

---

## 16. Open items

1. **Phase 0 feasibility**: Expo 55 prebuild with an iOS Notification Service Extension, Android data-message decryption, and a Firebase-free `fdroid` flavor with a maintained React Native UnifiedPush library.
2. **Digest content** per role: exact sections and numbers, designed together with the dashboard so figures match `dashboard.ts` exactly. Must be settled before launch.
3. **Quota defaults** in §9 are estimates. Revisit after four weeks of Phase 1 data.
4. **Customer-facing messages** (payment reminders, invoice sent, order confirmation *to parties and store customers*): separate design (D13). Needs DLT registration (SMS) and WhatsApp templates, sent on the business's behalf.

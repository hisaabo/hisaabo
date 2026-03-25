# PRD: Hisaabo Marketing Website (hisaabo.in)

**Status**: Draft
**Author**: Alex (PM) **Last Updated**: 2026-03-25 **Version**: 1.0
**Stakeholders**: Engineering Lead, Design Lead, Marketing, Content
**Repo**: Separate from main monorepo (e.g., `hisaabo-website`)

---

## 1. Problem Statement

Hisaabo is a fully functional invoicing and business management product with no public-facing website. Potential users cannot discover it, evaluate it, or sign up. The product exists in a vacuum -- no landing page, no pricing page, no SEO footprint, no acquisition funnel.

Indian small and medium businesses searching for "GST billing software" or "free invoicing app" land on myBillBook, Vyaapaar, Khatabook, or Zoho. Hisaabo has no presence in that decision flow.

**Cost of not solving this**: Zero organic acquisition. The product cannot grow beyond word-of-mouth. Every feature built in the app is wasted if nobody knows it exists.

**Evidence:**
- Competitive landscape: myBillBook, Vyaapaar, and Khatabook collectively serve millions of Indian SMBs. Their websites rank #1-5 for every relevant keyword.
- Product readiness: Core billing, GST compliance, multi-business, party/item management, payment tracking, PDF invoices, dashboard, and RBAC are all built and functional.
- Differentiators exist but are invisible: Open source, unlimited free tier, modern UX, keyboard shortcuts, dark mode, A5 invoice format, UPI QR on invoices, magic link auth.
- Coming features strengthen the pitch: Online store, bank reconciliation, WhatsApp sharing, AI-powered HSN/GST.

---

## 2. Goals & Success Metrics

### Primary Goal: Drive sign-ups
Get Indian SMB owners from "never heard of it" to "created their first invoice" in under 3 minutes.

### Secondary Goal: Build trust for paid tier conversion
Establish Hisaabo as the premium, modern alternative. Position paid tiers as obvious upgrades, not hard sells.

### Tertiary Goal: SEO dominance for Indian billing keywords
Rank on page 1 for high-intent keywords within 6 months of launch.

| Goal | Metric | Baseline | Target | Window |
|------|--------|----------|--------|--------|
| Acquisition | Unique sign-ups / month | 0 | 500 | 90 days post-launch |
| Activation | % sign-ups who create first invoice | N/A | 40% | 90 days |
| Bounce rate | Homepage bounce rate | N/A | < 45% | 60 days |
| SEO | Page 1 rankings for 5 target keywords | 0 | 5 | 180 days |
| Pricing page | % visitors who view pricing page | N/A | 30% | 60 days |
| Import funnel | % sign-ups via "Switch from myBillBook" | N/A | 15% | 90 days |
| Time to value | Median time from landing page to first invoice | N/A | < 3 min | 90 days |
| Page performance | Largest Contentful Paint (LCP) | N/A | < 1.5s on 4G | Launch |

---

## 3. Non-Goals

- **We are not building a documentation site in this scope.** Docs will live at `docs.hisaabo.in` as a separate project (likely Starlight/Astro or Mintlify). The website links to it.
- **We are not building a customer dashboard or account management.** The website is marketing-only. Authentication and app functionality live at `app.hisaabo.in`.
- **We are not supporting multiple languages at launch.** English-first with strategic Hinglish in headlines and CTAs. Full Hindi/regional language support is a v2 initiative based on user demographics.
- **We are not building a custom CMS.** Blog content uses MDX files in the repo or a headless CMS -- no bespoke content management.
- **We are not optimizing for mobile app downloads.** Hisaabo is desktop-first. Mobile support is a future initiative; the website should not promise what does not exist yet.

---

## 4. Target Audience

### Primary Persona: Rajesh -- Small Business Owner

- Runs a 5-50 employee trading, manufacturing, or services business
- Currently uses myBillBook, Vyaapaar, or Excel for invoicing
- Frustrated by slow UI, limited features, expensive tiers, and poor support
- Makes buying decisions himself; price-sensitive but willing to pay for value
- Searches Google in a mix of English and Hindi
- Uses WhatsApp as primary business communication
- Needs GST compliance but is not an accountant himself
- Desktop-primary during work hours, mobile for quick checks

### Secondary Persona: Priya -- Accountant / CA

- Manages books for 5-20 clients
- Evaluates billing software on behalf of clients
- Cares about GST accuracy, GSTR1/GSTR3B reports, export capabilities
- Wants multi-business support and role-based access
- Influences purchasing decisions for multiple businesses
- Trust signals: compliance, data accuracy, audit trails

### Tertiary Persona: Amit -- Developer / Technical Founder

- Interested in self-hosting and open source
- Evaluates code quality, stack decisions, license terms
- Potential contributor to the open-source project
- Values transparency, documentation, and community

---

## 5. Page Structure & Detailed Specifications

### 5.1 Information Architecture

```
hisaabo.in/
  |-- /                     Home / Landing page
  |-- /pricing              Pricing comparison
  |-- /features             Feature deep dive
  |-- /features/gst         GST compliance feature page
  |-- /features/invoicing   Invoicing feature page
  |-- /features/online-store   Online store feature page
  |-- /features/inventory   Inventory management feature page
  |-- /switch               Import / Switch from competitors
  |-- /open-source          Open source & self-hosting
  |-- /blog                 Blog index
  |-- /blog/:slug           Individual blog posts
  |-- /about                About / Team / Story
  |-- /contact              Contact / Support
  |-- /legal/privacy        Privacy Policy
  |-- /legal/terms          Terms of Service
  |-- /legal/license        O'Saasy License explanation
```

External links (not part of this site):
- `app.hisaabo.in` -- The actual application (sign up / log in)
- `docs.hisaabo.in` -- Documentation site
- `store.hisaabo.in` -- Online store platform
- `github.com/[org]/hisaabo` -- Open source repository

---

### 5.2 Home / Landing Page

This is the most important page. It must do five things in 10 seconds: (1) explain what Hisaabo is, (2) establish credibility, (3) create urgency, (4) show the product, (5) present a single clear CTA.

#### Hero Section

```
+----------------------------------------------------------------------+
|  [Logo: Hisaabo]                    Features  Pricing  Open Source   |
|                                     Blog  Docs    [Sign Up Free ->]  |
+----------------------------------------------------------------------+
|                                                                      |
|        India ka billing software,                                    |
|        jo actually kaam kare.                                        |
|                                                                      |
|        Create GST invoices, manage inventory, track payments,        |
|        and run your complete business -- free forever.               |
|                                                                      |
|        [Start Free -- No Credit Card ->]     [See it in action]      |
|                                                                      |
|        Used by X businesses  |  Open source  |  GST compliant       |
|                                                                      |
+----------------------------------------------------------------------+
|                                                                      |
|        [==== Live product screenshot / interactive demo ====]        |
|        (Full-width screenshot of the dashboard in dark mode,         |
|         showing invoice list with the Hisaabo UI in all its          |
|         glory. NOT a mockup -- the real product.)                    |
|                                                                      |
+----------------------------------------------------------------------+
```

**Hero Copy Options (test via A/B):**

Option A (Hinglish, confidence):
> **India ka billing software, jo actually kaam kare.**
> Create GST invoices, manage inventory, track payments, and run your complete business -- free forever.

Option B (English, pain-first):
> **Your billing software shouldn't be slower than your business.**
> Hisaabo is the modern invoicing platform Indian businesses deserve. GST-compliant, blazing fast, free forever.

Option C (Direct competitive):
> **Tired of myBillBook? You're not alone.**
> Switch to Hisaabo -- faster, cleaner, unlimited. Import your data in 2 minutes.

**Sub-hero social proof bar:**
```
[X businesses] created   |   [Y invoices] generated   |   [Z] in transactions processed
        Open source on GitHub [star count]
```

Note: Until real numbers exist, use "Join hundreds of businesses already switching" or similar honest framing. Never fabricate metrics.

#### Problem-Solution Section

Immediately below the hero. Three columns, pain-first:

```
+----------------------+----------------------+----------------------+
|  Slow, clunky UI?    |  Paying for basics?  |  Locked into one     |
|                      |                      |  vendor?             |
|  Hisaabo loads in    |  Unlimited invoices, |  Open source.        |
|  under a second.     |  unlimited parties,  |  Self-host or use    |
|  Built on a modern   |  unlimited businesses|  our cloud.          |
|  stack with keyboard |  -- on the free tier.|  Your data is always |
|  shortcuts and dark  |  No artificial       |  yours.              |
|  mode.               |  limits.             |                      |
+----------------------+----------------------+----------------------+
```

#### Feature Highlights (Scroll Section)

Six feature cards, each with:
- A short pain statement (what sucks today)
- A one-line solution (what Hisaabo does)
- A product screenshot or illustration
- A "Learn more" link to the relevant /features/* page

**Card 1: GST Invoicing**
Pain: "Creating a GST invoice shouldn't require a CA degree."
Solution: "Auto-calculated CGST/SGST/IGST. HSN codes. E-invoicing ready. Just fill in the items."
[Screenshot of InvoiceCreator with line items and tax breakdown]

**Card 2: Inventory & Stock**
Pain: "Sold something that's out of stock? Again?"
Solution: "Real-time stock tracking. Low stock alerts. Purchase price tracking. Stock adjustment log."
[Screenshot of item list with stock levels]

**Card 3: Multi-Business**
Pain: "Running 3 businesses from 3 different apps?"
Solution: "Manage all your businesses from one account. Switch in one click. Separate books, unified view."
[Screenshot of business switcher]

**Card 4: Payment Tracking**
Pain: "Sharma ji paid Rs. 15,000 last Tuesday. Or was it Wednesday? Was it for invoice #42 or #43?"
Solution: "Link payments to invoices. Track partial payments. See outstanding balances instantly."
[Screenshot of payment ledger]

**Card 5: Beautiful Invoices**
Pain: "Your invoice looks like it was made in 1998."
Solution: "Professional A4 and A5 layouts. UPI QR code for instant payment. Your logo, your colors."
[Screenshot of generated PDF invoice with UPI QR]

**Card 6: Online Store (Coming Soon)**
Pain: "Customers call you to place orders. In 2026."
Solution: "Your own online store at store.hisaabo.in/your-business. Orders become invoices automatically."
[Illustration / mockup of store page]

#### Pricing Preview

A condensed version of the pricing page -- three columns showing tier names and key differentiators. "See full pricing ->" link.

```
+--------------------+--------------------+--------------------+
|     DUKAAN         |     VYAPAAR        |      UDYAM         |
|     Free forever   |   Rs 499-999/mo    |  Rs 1999-4999/mo   |
|                    |                    |                    |
|  Unlimited bills   |  WhatsApp sharing  |  AI-powered HSN    |
|  GST compliant     |  Multi-user teams  |  Dynamic pricing   |
|  Multi-business    |  Custom domain     |  Auto-reordering   |
|  PDF invoices      |  Bank feeds        |  SSO / SAML        |
|  Payment tracking  |  E-invoicing       |  Priority support   |
|                    |  Recurring invoices|  Custom roles       |
|                    |                    |                    |
|  [Start Free ->]   |  [Start Free ->]   |  [Contact Sales ->] |
+--------------------+--------------------+--------------------+
```

#### Trust Section

```
+----------------------------------------------------------------------+
|                                                                      |
|  "Open source means no vendor lock-in. Your data is always yours."  |
|                                                                      |
|  [GST Compliant]  [Bank-Grade Security]  [Made in India]  [GitHub]  |
|   GSTR1/GSTR3B     Argon2id hashing       For Indian         View   |
|   ready. E-inv     Session-based auth      businesses,        source |
|   compatible.      RBAC with CASL.         by an Indian       code.  |
|                    No plain passwords.     developer.                |
|                                                                      |
+----------------------------------------------------------------------+
```

#### Competitor Comparison (Optional, high-impact)

A tasteful but pointed comparison table. Framed as "honest comparison" not "attack."

```
+----------------------------------------------------------------------+
|            Why businesses switch to Hisaabo                          |
+----------------------------------------------------------------------+
|                    | Hisaabo  | myBillBook | Vyaapaar  | Khatabook  |
|--------------------+----------+------------+-----------+------------|
| Free tier limit    | Unlimited| 50 inv/mo  | Limited   | No invoices|
| Multi-business     | Yes, free| Paid only  | No        | No         |
| Open source        | Yes      | No         | No        | No         |
| Dark mode          | Yes      | No         | No        | No         |
| Keyboard shortcuts | Yes      | No         | No        | No         |
| Self-host option   | Yes      | No         | No        | No         |
| UPI QR on invoice  | Yes      | Paid only  | No        | No         |
| Desktop app        | Yes      | No         | Yes       | No         |
| A5 invoice format  | Yes      | No         | No        | No         |
| Online store       | Coming   | No         | No        | No         |
| Modern UI/UX       | 2025     | 2019       | 2015      | 2018       |
+----------------------------------------------------------------------+
```

**Important**: This table must be factually accurate. Research and verify every claim before publishing. Inaccurate competitive claims destroy trust instantly.

#### Testimonials Section

At launch, testimonials will be from beta users and early adopters. Structure:

```
+----------------------------------------------------------------------+
|  "Quote from user about specific pain that Hisaabo solved."          |
|                                                                      |
|  -- Name, Business Name, City                                        |
|  [Photo if available]                                                |
+----------------------------------------------------------------------+
```

Collect 3-5 testimonials before website launch. Prioritize:
1. A user who switched from myBillBook (migration story)
2. A user who loves the UI/UX (premium positioning)
3. A CA/accountant who manages multiple clients (multi-business)
4. A self-hoster (open source credibility)

If real testimonials are not available at launch, DO NOT use fake ones. Instead, use the social proof bar (invoice count, business count) and the open source angle ("Don't trust us? Read the source code.").

#### Final CTA Section

```
+----------------------------------------------------------------------+
|                                                                      |
|           Hisaab, pakka.                                             |
|                                                                      |
|    Start managing your business in 60 seconds.                       |
|    No credit card. No setup fees. No limits on the free tier.        |
|                                                                      |
|    [Enter your email]                    [Start Free ->]             |
|                                                                      |
|    Or self-host it yourself. It's open source.                       |
|    [View on GitHub ->]                                               |
|                                                                      |
+----------------------------------------------------------------------+
```

#### Footer

```
+----------------------------------------------------------------------+
| Product         Company        Resources       Legal                 |
| Features        About          Blog            Privacy Policy        |
| Pricing         Contact        Documentation   Terms of Service      |
| Online Store    GitHub         API Reference    O'Saasy License      |
| Switch          Twitter/X      Help Center                           |
| Open Source     LinkedIn       Status Page                           |
|                                                                      |
| [Logo] Hisaabo -- Hisaab, pakka.                                    |
| Made with care in India.                                             |
+----------------------------------------------------------------------+
```

---

### 5.3 Pricing Page (`/pricing`)

#### Page Goal
Convert browsers into sign-ups. Make the free tier so compelling that trying Hisaabo is a no-brainer. Position paid tiers as "when you grow, we grow with you."

#### Layout

```
+----------------------------------------------------------------------+
|                                                                      |
|        Simple pricing. No surprises.                                 |
|        Start free. Upgrade when your business needs it.              |
|                                                                      |
|        [Monthly]  [Annual -- Save 20%]                               |
|                                                                      |
+----------------------------------------------------------------------+

+--------------------+--------------------+--------------------+
|                    |   MOST POPULAR     |                    |
|     DUKAAN         |     VYAPAAR        |      UDYAM         |
|     (Shop)         |     (Trade)        |      (Enterprise)  |
|                    |                    |                    |
|     FREE           |   Rs 499/mo        |  Rs 1,999/mo       |
|     forever        |   (Rs 399/mo       |  (Rs 1,599/mo      |
|                    |    billed annual)   |   billed annual)   |
|                    |                    |                    |
|  Everything you    | Everything in      | Everything in      |
|  need to start     | Dukaan, plus tools | Vyapaar, plus AI   |
|  billing.          | for growing teams. | and automation.    |
|                    |                    |                    |
|  * Unlimited       | * WhatsApp invoice | * AI HSN code      |
|    invoices        |   sharing          |   suggestions      |
|  * Unlimited       | * Multi-user teams | * Auto GST rate    |
|    parties/items   |   (5 roles)        |   updates          |
|  * Unlimited       | * Custom domain    | * Supplier invoice |
|    businesses      |   for invoices     |   verification     |
|  * GST compliant   | * Bank feed        | * Dynamic pricing  |
|    (GSTR1/GSTR3B)  |   integration      | * Auto supplier    |
|  * PDF invoices    | * Recurring        |   reordering       |
|    (A4/A5/thermal) |   invoices         | * Customer engage- |
|  * Payment         | * E-invoicing /    |   ment automation  |
|    tracking        |   E-way bill       | * Custom role      |
|  * Expense         | * Email delivery   |   definitions      |
|    tracking        |   with tracking    | * Multi-entity     |
|  * Dashboard &     | * Auto-backups     |   consolidation    |
|    reports         |   with PITR        | * SSO / SAML       |
|  * UPI QR on       | * Image on         | * Priority support |
|    invoices        |   invoices         |   with SLA         |
|  * Dark mode       | * Shipping         |                    |
|  * Keyboard        |   tracking         |                    |
|    shortcuts       |                    |                    |
|  * Desktop app     |                    |                    |
|  * Online store    |                    |                    |
|    (basic)         |                    |                    |
|                    |                    |                    |
| [Start Free ->]    | [Start 14-day      | [Contact Sales ->] |
|                    |  Free Trial ->]    |                    |
+--------------------+--------------------+--------------------+
```

#### Pricing Strategy Decisions

1. **Free tier (Dukaan) is genuinely unlimited.** No invoice caps, no business caps. This is the sharpest differentiator against myBillBook (which caps free at 50 invoices/month). The strategy: get users on free, let the product sell itself, upgrade when team features or automation become necessary.

2. **Vyapaar trial: 14 days, no credit card.** After trial, user downgrades to Dukaan automatically. No hard cutoff, no lost data. This reduces trial anxiety.

3. **Udyam: Contact sales.** At Rs 1,999-4,999/mo, these are larger businesses that expect a conversation. Self-serve sign-up is available, but the primary CTA is "Talk to us" to qualify leads and offer custom pricing for multi-entity setups.

4. **Annual discount: 20%.** Displayed as monthly-equivalent price with "(billed annually)" notation. Toggle between monthly and annual views.

5. **No hidden fees.** The pricing page must explicitly state: "No setup fees. No per-invoice charges. No hidden costs. Cancel anytime."

#### Feature Comparison Table (Below the Cards)

A full-detail comparison matrix with every feature listed and checkmarks per tier. Expandable/collapsible by category:
- Invoicing & Billing
- GST & Compliance
- Inventory & Items
- Team & Access Control
- Automation & AI
- Integrations
- Support & SLA

#### FAQ Section

Address objections directly:

- **"What happens when my free trial ends?"** You keep using Dukaan for free. Your data stays exactly where it is. We never hold your data hostage.
- **"Can I switch plans later?"** Yes. Upgrade anytime, downgrade at end of billing cycle. No penalties.
- **"Is the free tier really unlimited?"** Yes. Unlimited invoices, unlimited parties, unlimited items, unlimited businesses. We make money from teams and automation, not from putting gates on basic billing.
- **"I'm a CA managing 10+ businesses. Which plan?"** Dukaan handles unlimited businesses for free. If you need team access for your staff, Vyapaar. If you need AI-powered GST checks across all clients, Udyam.
- **"What about self-hosting?"** Hisaabo's core is open source. Self-host it for free on your own server. Cloud features (WhatsApp, bank feeds, AI) require our managed cloud.
- **"How does pricing compare to myBillBook?"** myBillBook's Silver plan costs Rs 3,999/year and limits you to 1 business. Hisaabo's free tier gives you unlimited businesses with no invoice caps. Our paid tiers start at Rs 399/month (annual) with features myBillBook doesn't offer at any price.

---

### 5.4 Features Page (`/features`)

#### Page Goal
Deep-dive into capabilities for evaluators who need to justify the switch to their boss, partner, or CA.

#### Layout Strategy
Hub-and-spoke: `/features` is the hub with category cards linking to detail pages.

#### Hub Page (`/features`)

```
+----------------------------------------------------------------------+
|                                                                      |
|        Everything your business needs.                               |
|        Nothing it doesn't.                                           |
|                                                                      |
+----------------------------------------------------------------------+

+--------------------+--------------------+--------------------+
| [icon]             | [icon]             | [icon]             |
| GST Invoicing      | Inventory          | Payment Tracking   |
|                    | Management         |                    |
| Create, send, and | Real-time stock,   | Partial payments,  |
| track GST-         | purchase prices,   | ledger view,       |
| compliant invoices | low stock alerts,  | outstanding        |
| with auto tax      | stock adjustments. | balances at a      |
| calculation.       |                    | glance.            |
|                    |                    |                    |
| [Learn more ->]    | [Learn more ->]    | [Learn more ->]    |
+--------------------+--------------------+--------------------+
+--------------------+--------------------+--------------------+
| [icon]             | [icon]             | [icon]             |
| Multi-Business     | Online Store       | GST Reports        |
|                    |                    |                    |
| Run all your       | Your products,     | GSTR1, GSTR3B,     |
| businesses from    | online, in 5       | HSN summary --     |
| one account.       | minutes. Orders    | generated from     |
| Switch in a click. | become invoices.   | your actual data.  |
|                    |                    |                    |
| [Learn more ->]    | [Learn more ->]    | [Learn more ->]    |
+--------------------+--------------------+--------------------+
+--------------------+--------------------+--------------------+
| [icon]             | [icon]             | [icon]             |
| Team & Roles       | Expense Tracking   | Dashboard &        |
|                    |                    | Analytics          |
| 5 built-in roles   | Track business     | Revenue, expenses, |
| with granular      | expenses with      | outstanding,       |
| permissions. CASL- | categories and     | top parties, cash  |
| powered RBAC.      | tax tracking.      | flow -- all in     |
|                    |                    | real time.         |
| [Learn more ->]    | [Learn more ->]    | [Learn more ->]    |
+--------------------+--------------------+--------------------+
```

#### Feature Detail Page Pattern (`/features/:feature`)

Each spoke page follows the same template:

```
1. HERO: Pain statement + solution one-liner + product screenshot
2. HOW IT WORKS: 3-step visual walkthrough
3. KEY CAPABILITIES: Bullet list with icons
4. BEFORE / AFTER: What users did before vs. what they do now
5. FOR YOUR CA: How this helps their accountant (if applicable)
6. CTA: "Try it free -- create your first [invoice/item/etc.] in 60 seconds"
```

**Example: `/features/gst`**

```
HERO:
  "GST compliance shouldn't require a PhD."
  Hisaabo handles CGST, SGST, IGST, cess, and HSN codes automatically.
  You fill in the items. We handle the math.
  [Screenshot of invoice with tax breakdown]

HOW IT WORKS:
  1. Add items with HSN codes and tax rates
  2. Create invoice -- taxes auto-calculate based on state
  3. Generate GSTR1/GSTR3B reports with one click

KEY CAPABILITIES:
  - Auto CGST/SGST for intra-state, IGST for inter-state
  - HSN code management with 4/6/8 digit support
  - GSTR1 report with B2B, B2C, HSN summary sections
  - GSTR3B summary report
  - E-invoicing ready (Vyapaar tier)
  - Financial year April-March (configurable)
  - Adapts terminology for non-GST businesses

BEFORE / AFTER:
  Before: "I calculate tax in Excel, copy it into myBillBook, then
           re-enter it into the GST portal. Every. Single. Month."
  After:  "I click 'Generate GSTR1', download the JSON, upload it
           to the portal. Done in 2 minutes."

CTA: [Start Free ->]
```

---

### 5.5 Import / Switch Page (`/switch`)

#### Page Goal
Convert myBillBook / Vyaapaar / Khatabook users specifically. This page is an SEO magnet for "switch from myBillBook" and "myBillBook alternative" searches.

#### Layout

```
+----------------------------------------------------------------------+
|                                                                      |
|        Switch from myBillBook in 2 minutes.                          |
|        Bring everything. Leave nothing behind.                       |
|                                                                      |
|        [Import My Data ->]                                           |
|                                                                      |
+----------------------------------------------------------------------+

WHAT GETS IMPORTED:
+--------------------+--------------------+--------------------+
| Parties            | Items              | Invoices           |
| All customers &    | Every item with    | Full invoice        |
| suppliers with     | prices, stock,     | history with line  |
| contact details,   | HSN codes, tax     | items, taxes,      |
| GSTIN, balance.    | rates, categories. | payments, status.  |
+--------------------+--------------------+--------------------+

HOW IT WORKS:
  Step 1: Export your data from myBillBook (we show you exactly how)
  Step 2: Upload the CSV/Excel files to Hisaabo
  Step 3: Review the mapping, confirm, done.
  [Include screenshots of each step]

WHAT MAKES HISAABO BETTER:
  (Side-by-side comparison with specific pain points)

  myBillBook: 50 free invoices/month -> Hisaabo: Unlimited, forever
  myBillBook: Single business on free -> Hisaabo: Unlimited businesses
  myBillBook: No dark mode -> Hisaabo: Beautiful dark mode
  myBillBook: No keyboard shortcuts -> Hisaabo: Full keyboard navigation
  myBillBook: No self-hosting -> Hisaabo: Open source, self-host free
  myBillBook: Mobile-first, desktop afterthought -> Hisaabo: Desktop-first, built for productivity

TESTIMONIAL:
  "I had 3 years of data in myBillBook. Imported everything to
   Hisaabo in under 5 minutes. Wish I'd switched sooner."
   -- [Name, Business, City]

FAQ:
  - "Will I lose any data?" No. We import everything. If something
     doesn't map cleanly, we flag it for your review.
  - "Can I import from Vyaapaar / Khatabook / Tally?"
     myBillBook import is available now. Vyaapaar and Khatabook
     imports are in development. Tally import is planned.
  - "Can I run both apps during the transition?"
     Absolutely. Import your data, verify everything looks right,
     then switch when you're confident.
```

Additional sections for other competitors:
- `/switch#vyaapaar` -- "Upgrade from Vyaapaar's 2015 interface"
- `/switch#khatabook` -- "Outgrow Khatabook's limitations"
- `/switch#tally` -- "Your CA-friendly alternative to Tally"

---

### 5.6 Open Source Page (`/open-source`)

#### Page Goal
Build trust, attract developers, explain the business model clearly.

#### Layout

```
+----------------------------------------------------------------------+
|                                                                      |
|        Open source. Not open-wash.                                   |
|                                                                      |
|        The complete billing and invoicing engine is free to use,     |
|        free to modify, and free to self-host. No time bombs.         |
|        No "open core" bait-and-switch.                               |
|                                                                      |
|        [View on GitHub ->]      [Self-Hosting Guide ->]              |
|                                                                      |
+----------------------------------------------------------------------+

WHAT'S OPEN SOURCE (everything that matters):
  - Full invoicing engine (create, send, track)
  - GST compliance (CGST/SGST/IGST, GSTR1, GSTR3B)
  - Multi-business management
  - Party & item management with full inventory
  - Payment tracking with partial payment support
  - Expense tracking
  - PDF invoice generation (A4, A5, thermal)
  - UPI QR codes on invoices
  - Dashboard & analytics
  - Desktop app (Tauri)
  - Role-based access control (5 roles, CASL)

WHAT'S CLOUD-ONLY (things that need infrastructure):
  - WhatsApp invoice sharing (requires Business API)
  - Bank feed integration (requires Account Aggregator)
  - AI features (HSN suggestions, GST rate updates)
  - E-invoicing / E-way bill (NIC API integration)
  - Auto-backups with point-in-time recovery
  - Multi-tenant isolation (one DB per tenant)
  - Priority support with SLA

THE LICENSE: O'SAASY
  "Free to use. Free to modify. Free to self-host.
   The only restriction: you can't use it to compete
   with our hosted service."

  Plain English: Run it for your business? Great.
  Modify it for your needs? Go ahead. Sell it as a
  hosted service to others? That's our lane.

  [Read the full license ->]

SELF-HOSTING GUIDE:
  Requirements:
  - PostgreSQL 16+
  - Node.js 20+
  - 1GB RAM minimum
  - Any Linux server (Ubuntu, Debian, etc.)

  Quick start:
    git clone https://github.com/[org]/hisaabo
    cp .env.example .env
    # Edit .env with your DATABASE_URL
    pnpm install
    pnpm db:migrate
    pnpm build
    pnpm start

  [Full self-hosting documentation ->]

TECH STACK (for developers):
  Monorepo: Turborepo + pnpm workspaces
  API: Hono + tRPC + Drizzle ORM
  Frontend: React 19 + Vite + TanStack Router
  Desktop: Tauri v2
  Database: PostgreSQL 16
  Auth: Argon2id + session-based (no JWTs)
  Validation: Zod (shared between API and frontend)
  Types: End-to-end via tRPC (zero codegen)

  [Architecture documentation ->]

CONTRIBUTE:
  We welcome contributions. Start with:
  - Bug reports and feature requests on GitHub Issues
  - Documentation improvements
  - Translation help (Hindi, regional languages planned)
  - Code contributions (see CONTRIBUTING.md)

  [Contributing Guide ->]
```

---

### 5.7 Online Store Page (`/features/online-store`)

#### Page Goal
Generate excitement for the online store feature. Position it as the "one more thing" that makes Hisaabo the obvious choice.

#### Layout

```
+----------------------------------------------------------------------+
|                                                                      |
|        Your business, online. In 5 minutes.                          |
|                                                                      |
|        Turn your Hisaabo product catalog into a live online store.   |
|        Customers browse, order, pay. You get a draft invoice.        |
|        No Shopify. No separate app. It just works.                   |
|                                                                      |
|        [Get Early Access ->]                                         |
|                                                                      |
+----------------------------------------------------------------------+

HOW IT WORKS:
  1. Enable the store in your Hisaabo settings
  2. Pick which items to list (toggle per item or bulk-select)
  3. Share your link: store.hisaabo.in/your-business
  4. Customer places order -> you see a draft invoice -> confirm -> done

YOUR STOREFRONT:
  [Mockup of a clean, fast store page showing:
   - Business name and tagline
   - Category navigation
   - Product grid with images, prices, and "Add to cart"
   - Cart sidebar
   - Simple checkout: name, phone, address, notes]

FEATURES:
  - Custom store URL (store.hisaabo.in/your-slug)
  - Custom accent colors to match your brand
  - Category organization with custom sort order
  - Store-specific pricing (optional -- different from invoice price)
  - Store-specific descriptions
  - Minimum order amount
  - "Order on WhatsApp" button
  - Order status tracking for customers
  - Custom domain support (Vyapaar tier)

THE MAGIC: ORDERS = INVOICES
  "When a customer places an order, it becomes a draft invoice
   in your regular invoice list. Confirm it with one click.
   All your existing workflows -- payments, GST reports,
   PDF generation -- work automatically. Zero extra effort."

COMING SOON BADGE:
  This feature is in active development. Sign up now to be
  first in line when it launches.
  [Join the waitlist ->]
```

---

### 5.8 Blog (`/blog`)

#### Page Goal
SEO engine. Build authority on GST, invoicing, small business management in India. Drive organic traffic that converts to sign-ups.

#### Layout
Standard blog index: featured post at top, grid of recent posts, category sidebar.

#### Content Strategy (see Section 7 for full editorial plan)

---

### 5.9 About Page (`/about`)

#### Page Goal
Build personal connection. Indian SMB owners buy from people they trust.

#### Content
- The story: why Hisaabo was built (frustration with existing tools)
- The mission: every Indian business deserves professional tools, not overpriced junk
- The approach: open source first, sustainable business model
- The person: founder/team introduction (optional, depends on comfort level)
- Made in India angle: "Built by an Indian developer, for Indian businesses"

---

### 5.10 Contact Page (`/contact`)

#### Layout
- Support email
- GitHub Issues for bug reports
- Twitter/X for quick questions
- Simple contact form (name, email, message, category dropdown: General / Sales / Support / Partnership)

---

## 6. Conversion Funnel Design

### The Happy Path

```
Google search "GST billing software free"
  |
  v
Landing page (hisaabo.in)
  |  -- Hero communicates value in 5 seconds
  |  -- Social proof reduces skepticism
  |  -- CTA is above the fold
  v
Click "Start Free" -> redirect to app.hisaabo.in/auth/signup
  |
  v
Enter email -> magic link sent (< 5 seconds)
  |  -- "Check your email" page with clear instructions
  |  -- Magic link expires in 15 minutes
  v
Click magic link -> logged in -> Create Business form
  |  -- Business name, GSTIN (optional), state
  |  -- Under 30 seconds to complete
  v
Dashboard (empty state with guided onboarding)
  |  -- "Create your first invoice" prompt
  |  -- "Import from myBillBook" option
  |  -- Quick-start checklist
  v
First invoice created -> VALUE DELIVERED
```

### Funnel Drop-off Mitigations

| Step | Expected Drop-off | Mitigation |
|------|-------------------|------------|
| Landing -> CTA click | 60-70% leave | A/B test hero copy. Ensure CTA is visible without scrolling. Show product, not marketing fluff. |
| CTA -> Email entry | 30-40% abandon | Single field (email only). No password, no phone, no name at this stage. "No credit card required" reassurance. |
| Email entry -> Magic link click | 20-30% don't click | Subject line: "Your Hisaabo login link". Send within 3 seconds. Include "This link expires in 15 minutes" urgency. Resend option on the waiting page. |
| Magic link -> Create business | 10-15% abandon | Pre-fill what we can. Only 2 required fields (name, state). GSTIN is optional with "Add later" option. |
| Create business -> First invoice | 30-40% don't complete | Guided empty state. "Create your first invoice" button is the only prominent action. Sample data option ("Try with demo data"). |

### Alternative Paths

1. **Import path**: Landing -> Switch page -> "Import My Data" -> Sign up -> Upload CSV -> Review -> Business created with data
2. **Self-host path**: Landing -> Open Source page -> GitHub -> Clone -> Self-host (no sign-up on hisaabo.in)
3. **CA/Accountant path**: Landing -> Features -> Multi-business -> Sign up -> Create multiple businesses
4. **Pricing-first path**: Landing -> Pricing -> Compare tiers -> Start free or contact sales

### Re-engagement

- **Abandoned sign-up**: If email is entered but magic link is never clicked, send a follow-up email after 24 hours: "Still interested? Here's a fresh link."
- **Signed up but no invoice**: If business is created but no invoice after 48 hours, send an email: "Need help getting started? Here's a 2-minute video walkthrough."
- **Active on free tier**: After 30 days of active use, subtle in-app prompt about Vyapaar features (not on the website -- this is an in-app concern).

---

## 7. SEO Strategy

### Target Keywords

| Keyword | Monthly Volume (Est.) | Difficulty | Intent | Target Page |
|---------|----------------------|------------|--------|-------------|
| GST billing software | High | High | Commercial | Home |
| free invoicing app India | High | Medium | Commercial | Home |
| GST invoice maker | Medium | Medium | Commercial | /features/gst |
| billing software for small business India | Medium | Medium | Commercial | Home |
| myBillBook alternative | Medium | Low | Commercial | /switch |
| free GST invoice software | Medium | Medium | Commercial | Home |
| open source billing software | Low | Low | Informational | /open-source |
| GSTR1 report software | Low | Low | Commercial | /features/gst |
| online store for small business India | Medium | Medium | Commercial | /features/online-store |
| khatabook alternative | Medium | Low | Commercial | /switch |
| self hosted invoicing | Low | Low | Informational | /open-source |
| UPI QR invoice | Low | Low | Commercial | /features/invoicing |

### On-Page SEO Requirements

Every page must have:
- Unique `<title>` tag (50-60 chars) with primary keyword
- Unique `<meta name="description">` (150-160 chars) with CTA language
- One `<h1>` per page containing the primary keyword naturally
- Structured data (JSON-LD): Organization, Product, FAQ, BreadcrumbList as appropriate
- Open Graph and Twitter Card meta tags for social sharing
- Canonical URLs
- Alt text on all images
- Internal linking between related pages

### Blog Content Plan (First 20 Posts)

**Category 1: GST Guides (high search volume, builds authority)**

1. "Complete Guide to GST Invoice Format in 2026 (With Free Template)" -- Targets: GST invoice format, GST bill format
2. "GSTR1 Filing: Step-by-Step Guide for Small Businesses" -- Targets: GSTR1 filing, how to file GSTR1
3. "GSTR3B: What It Is, How to File, Common Mistakes" -- Targets: GSTR3B filing
4. "HSN Code List 2026: How to Find the Right Code for Your Products" -- Targets: HSN code list, HSN code finder
5. "Inter-State vs Intra-State GST: IGST, CGST, SGST Explained Simply" -- Targets: IGST CGST SGST difference
6. "E-Invoicing for Small Business: Do You Need It? (2026 Rules)" -- Targets: e-invoicing small business
7. "GST for Freelancers and Service Providers: Complete Guide" -- Targets: GST for freelancers

**Category 2: Business Management (medium volume, high conversion intent)**

8. "How to Create a Professional Invoice in 5 Minutes (Free)" -- Targets: how to create invoice, invoice format
9. "Payment Tracking for Small Business: Stop Losing Money" -- Targets: payment tracking software
10. "Managing Multiple Businesses: The Complete Guide" -- Targets: multiple business management
11. "Inventory Management for Small Business (Without the Complexity)" -- Targets: inventory management small business
12. "How to Set Up UPI Payments on Your Invoices" -- Targets: UPI QR on invoice
13. "A5 vs A4 Invoice: Which Format Works Better?" -- Targets: invoice format, A5 invoice

**Category 3: Competitor Comparisons (high conversion, medium volume)**

14. "myBillBook vs Hisaabo: Honest Comparison (2026)" -- Targets: myBillBook review, myBillBook alternative
15. "Vyaapaar vs Hisaabo: Which Is Better for Your Business?" -- Targets: Vyaapaar alternative
16. "5 Reasons Small Businesses Are Leaving Khatabook" -- Targets: Khatabook alternative
17. "Tally vs Cloud Billing: Why Modern Businesses Are Switching" -- Targets: Tally alternative

**Category 4: Open Source / Tech (developer audience, builds credibility)**

18. "Why We Open-Sourced Our Billing Software" -- Targets: open source billing, self-hosted invoicing
19. "Self-Hosting Hisaabo: Complete Setup Guide" -- Targets: self-hosted invoicing software
20. "The O'Saasy License: Open Source With a Sustainable Business Model" -- Targets: O'Saasy license, open source SaaS

### Technical SEO

- Sitemap.xml generated automatically
- robots.txt allowing all pages, disallowing /api
- Page load time under 1.5s LCP on 4G
- Core Web Vitals: all green
- Mobile-responsive (even though the app is desktop-first, the WEBSITE must be mobile-friendly)
- HTTPS everywhere
- Clean URL structure (no query params for content pages)

---

## 8. Trust Signals Strategy

### Security Credibility (drawn from actual implementation)

| Claim | Evidence | Where to Show |
|-------|----------|---------------|
| "No plain-text passwords" | Argon2id hashing (industry gold standard) | Security section, About |
| "Session-based auth" | HttpOnly, Secure, SameSite=Lax cookies, 30-day expiry | Open Source page |
| "Role-based access control" | 5 roles with CASL-powered granular permissions | Features, Pricing |
| "Business data isolation" | businessProcedure middleware scopes every query | Open Source page |
| "Rate limiting" | 120 req/min/IP global, auth-specific throttling | Security section |
| "Magic link auth" | Passwordless login, no OTP cost, token hashed with SHA-256 | Home, Features |

**Important**: Do NOT claim "bank-grade security" on the website until the items in SECURITY_PENDING.md are resolved (invitation token hashing, DB password encryption, role hierarchy enforcement, per-email rate limiting). Once fixed, this becomes a legitimate claim.

### Data Ownership

- "Your data stays yours. Export everything, anytime, in standard formats."
- "Self-host option means you literally own the server."
- "Open source means you can audit every line of code."
- "No vendor lock-in. No data hostage situations."

### Made in India

- "Built by an Indian developer, for Indian businesses."
- "Designed for the Indian financial year (April-March)."
- "GST-native, not GST-bolted-on."
- "Understands your business because we understand India."

### Social Proof (build over time)

- GitHub stars count (live badge)
- Business count (once significant)
- Invoice count (once significant)
- Testimonials (collect actively from beta users)
- "As featured in" badges (after ProductHunt, HN launches)

---

## 9. Technical Considerations

### 9.1 Recommended Tech Stack

| Layer | Recommendation | Rationale |
|-------|---------------|-----------|
| **Framework** | **Astro 5** | Static-first with islands architecture. Marketing sites are 95% static content. Astro generates zero JS by default, adds it only for interactive islands (pricing toggle, mobile menu). Superior to Next.js for this use case -- no SSR runtime needed, trivial hosting. |
| **Styling** | **Tailwind CSS 4** | Consistent with the main app. Share the same color palette and design tokens. DM Sans + JetBrains Mono fonts. |
| **Content (Blog)** | **Astro Content Collections + MDX** | Blog posts as MDX files in the repo. Type-safe frontmatter via Astro's content schemas. No external CMS dependency. Easy to add components within posts (code blocks, comparison tables, CTAs). |
| **Hosting** | **Cloudflare Pages** | Free tier handles significant traffic. Global CDN. Automatic HTTPS. Deploy on git push. Zero cold starts (static files). |
| **Analytics** | **Plausible Analytics** (self-hosted or cloud) | Privacy-friendly, no cookie banner needed, lightweight script (< 1KB). Tracks pageviews, referrers, goals. Open source option aligns with brand values. |
| **Forms** | **Cloudflare Workers** or **Formspree** | Contact form submissions. No backend server needed. |
| **Email** | **Resend** or **Postmark** | Transactional emails (magic link, follow-ups). Not needed for the website itself -- the app handles auth emails. |
| **Search** | **Pagefind** (built into Astro) | Static search index for blog and docs. Zero runtime cost. |
| **Monitoring** | **Cloudflare Web Analytics** (free) + **Plausible** | Core Web Vitals monitoring. |

**Why Astro over Next.js:**
- The marketing website is content, not application. Astro is purpose-built for this.
- Zero JavaScript by default = fastest possible page loads = best Core Web Vitals = best SEO.
- MDX content collections are first-class in Astro.
- Cloudflare Pages deployment is trivial (no server needed).
- Next.js would be overkill -- its strengths (SSR, API routes, app router) are irrelevant here.
- If interactive demos are needed later, Astro's React islands allow embedding React components without shipping React to the entire site.

**Why NOT plain HTML:**
- No component reuse across pages.
- No templating for blog posts.
- No content collections for type-safe blog management.
- Manual build process.
- The overhead of Astro is near-zero; the developer experience gain is significant.

### 9.2 Repository Structure

```
hisaabo-website/
  src/
    pages/
      index.astro              # Home
      pricing.astro            # Pricing
      switch.astro             # Import / Switch
      open-source.astro        # Open Source
      about.astro              # About
      contact.astro            # Contact
      features/
        index.astro            # Features hub
        gst.astro              # GST feature page
        invoicing.astro        # Invoicing feature page
        online-store.astro     # Online store feature page
        inventory.astro        # Inventory feature page
      blog/
        index.astro            # Blog index
        [...slug].astro        # Blog post template
      legal/
        privacy.astro          # Privacy Policy
        terms.astro            # Terms of Service
        license.astro          # O'Saasy License
    components/
      Header.astro             # Site header
      Footer.astro             # Site footer
      Hero.astro               # Hero section (reusable)
      FeatureCard.astro        # Feature card component
      PricingCard.astro        # Pricing tier card
      PricingToggle.tsx        # React island: monthly/annual toggle
      ComparisonTable.astro    # Competitor comparison
      TestimonialCard.astro    # Testimonial component
      CTASection.astro         # Reusable CTA block
      BlogCard.astro           # Blog post preview card
      MobileMenu.tsx           # React island: mobile hamburger menu
    content/
      blog/                    # MDX blog posts
        gst-invoice-guide.mdx
        gstr1-filing-guide.mdx
        ...
      config.ts                # Content collection schemas
    layouts/
      BaseLayout.astro         # HTML shell, meta tags, analytics
      BlogLayout.astro         # Blog post layout
    styles/
      globals.css              # Design tokens, brand colors
    lib/
      seo.ts                   # SEO utility (meta tag generation)
  public/
    images/
      screenshots/             # Product screenshots
      illustrations/           # Custom illustrations
      og/                      # Open Graph images per page
    fonts/                     # DM Sans, JetBrains Mono
    favicon.svg
    robots.txt
    sitemap.xml                # Auto-generated by Astro
  astro.config.mjs
  tailwind.config.mjs
  package.json
  tsconfig.json
```

### 9.3 Performance Budget

| Metric | Target | Measurement |
|--------|--------|-------------|
| Largest Contentful Paint (LCP) | < 1.2s | Lighthouse, 4G throttling |
| First Input Delay (FID) | < 50ms | Lighthouse |
| Cumulative Layout Shift (CLS) | < 0.05 | Lighthouse |
| Total page weight (home) | < 500KB (transferred) | DevTools Network |
| JavaScript (home) | < 20KB (only analytics + interactive islands) | Bundle analysis |
| Time to Interactive (TTI) | < 2s on 4G | Lighthouse |
| Lighthouse Performance score | > 95 | Lighthouse CI |

### 9.4 Dependencies & Risks

| Dependency | Needed For | Owner | Risk |
|------------|-----------|-------|------|
| Product screenshots | Every feature page, home page | Design/PM | HIGH -- Website cannot launch without real product screenshots. Must be captured from the actual running app, not mockups. |
| Brand assets | Logo, favicon, OG images | Design | MEDIUM -- Logo exists; OG images and illustrations need creation. |
| Blog content | SEO strategy, authority | PM/Content | MEDIUM -- First 5 posts should be ready at launch. |
| Plausible setup | Analytics from day 1 | Engineering | LOW -- Simple script tag addition. |
| Cloudflare Pages | Hosting | Engineering | LOW -- Free tier, simple setup. |
| Domain DNS | hisaabo.in pointing to Cloudflare | Engineering | LOW -- One-time setup. |
| Security fixes | "Bank-grade security" claim on website | Engineering | HIGH -- Cannot make strong security claims until SECURITY_PENDING items are resolved. |

### 9.5 Open Questions

- [ ] **Domain structure confirmation**: Is the plan `hisaabo.in` (website), `app.hisaabo.in` (application), `docs.hisaabo.in` (documentation), `store.hisaabo.in` (online stores)? -- Owner: PM -- Deadline: Before design starts
- [ ] **GitHub org name**: What is the GitHub organization? Needed for open source page links. -- Owner: PM -- Deadline: Before launch
- [ ] **Pricing finalization**: The SAAS.md shows ranges (Rs 499-999, Rs 1999-4999). Need exact launch prices. -- Owner: PM -- Deadline: Before pricing page design
- [ ] **Testimonial collection**: Do we have 3+ beta users willing to provide testimonials? -- Owner: PM -- Deadline: 2 weeks before launch
- [ ] **Legal review**: Privacy Policy, Terms of Service, O'Saasy license text need legal review. -- Owner: PM/Legal -- Deadline: Before launch
- [ ] **Product screenshots**: Need a polished demo environment with realistic Indian business data for screenshots. -- Owner: Design/PM -- Deadline: Before design starts

---

## 10. Design Direction & Brand Application

### Color System

```
Primary:     Deep true indigo  #5b5bd6  (brand, CTAs, links)
Accent:      Warm amber         #fbbf24  (highlights, badges, special callouts)
Background:  White              #ffffff  (light mode)
             Near-black         #0c0c0d  (dark mode, if supported)
Surface:     Off-white           #f8f8f8  (cards, sections)
Text:        Near-black          #1a1a1a  (body text)
             Dark gray           #6b7280  (secondary text)
Success:     Green               #22c55e  (checkmarks, positive comparisons)
```

### Typography

- **Headlines**: DM Sans Bold (same as the app)
- **Body**: DM Sans Regular (same as the app)
- **Code / Technical**: JetBrains Mono (same as the app)
- **Hindi/Devanagari**: Ensure DM Sans has adequate Hindi glyph support. If not, specify a fallback (Noto Sans Devanagari).

### Tone of Voice for Website Copy

| Attribute | Do | Don't |
|-----------|-----|-------|
| **Confident** | "Hisaabo handles GST automatically." | "We think our GST features are pretty good." |
| **Direct** | "Free forever. No catches." | "Our generous free tier provides a comprehensive set of features..." |
| **Warm** | "Your business deserves better tools." | "Optimize your business operations with our solution." |
| **Specific** | "GSTR1 report in one click." | "Comprehensive reporting capabilities." |
| **Honest** | "Online store is coming soon." | "Full e-commerce platform" (when it's not shipped yet) |
| **Hinglish (headlines only)** | "Hisaab, pakka." | Every sentence in Hinglish (exhausting, gimmicky) |

**Copy rules:**
1. Headlines can use Hinglish. Body copy is English.
2. Never use "leverage", "synergy", "solution", "utilize", "empower", or other corporate nonsense.
3. Numbers are specific: "60 seconds" not "minutes", "Rs 499/mo" not "affordable pricing".
4. Features are described by what they DO, not what they ARE. "Create a GST invoice in 60 seconds" not "GST invoice creation module".
5. Competitor references are factual and fair. Never mock. State differences and let the reader decide.
6. "Coming soon" features are clearly labeled. Never imply availability of unshipped features.

### Visual Style

- **Product screenshots are the hero.** The real app, running, with realistic Indian business data (Sharma Traders, Gupta Electronics, etc.). Not mockups. Not illustrations of what it "could" look like.
- **Minimal illustrations.** If used, they should be simple line illustrations in indigo/amber, not generic SaaS vector art.
- **No stock photos.** No handshake photos, no "diverse team in office" photos, no laptop-on-desk lifestyle shots. These destroy credibility for a technical audience.
- **Dark mode screenshots preferred.** The dark mode UI is a differentiator. Lead with it. Show light mode as a secondary option.
- **Generous whitespace.** The website should feel as premium as the product.

---

## 11. Launch Strategy

### Phase 1: Soft Launch (Week 1-2)

**Goal**: Get the website live, collect initial feedback, fix issues.

- Deploy to hisaabo.in
- Share with 10-20 trusted beta users for feedback
- Fix copy issues, broken links, mobile responsiveness bugs
- Ensure analytics are tracking correctly
- Verify sign-up funnel works end-to-end (website CTA -> app.hisaabo.in -> magic link -> create business)

### Phase 2: Community Launch (Week 3)

**Goal**: First wave of organic traffic from developer/tech communities.

#### Hacker News

**Post title**: "Show HN: Open-source GST billing software for Indian businesses"

**Post body (comment)**:
```
Hey HN, I built Hisaabo (https://hisaabo.in) -- an open-source invoicing
and business management app for Indian small businesses.

Why: I was using myBillBook for my business and got frustrated with the
clunky UI, artificial free tier limits, and vendor lock-in. So I built
what I wished existed.

What it does:
- GST-compliant invoicing (CGST/SGST/IGST auto-calculated)
- Inventory management with real-time stock tracking
- Payment tracking with partial payment support
- Multi-business support (unlimited, even on free tier)
- GSTR1/GSTR3B report generation
- PDF invoices with UPI QR codes
- Dark mode, keyboard shortcuts, fast

Tech stack: React 19 + Vite + TanStack Router, Hono + tRPC + Drizzle,
PostgreSQL, Tauri for desktop. Monorepo with Turborepo.

The core is open source under the O'Saasy license (free to use and
self-host, can't compete as a hosted service). Cloud version at
hisaabo.in adds team features, WhatsApp sharing, and AI-powered
GST compliance.

GitHub: [link]
Live demo: [link]

Would love feedback on the product, the pricing model, and whether
the open-source approach resonates.
```

#### ProductHunt

- Schedule launch for a Tuesday or Wednesday (highest traffic days)
- Prepare: tagline, description, 4-5 product images, maker comment
- Tagline: "Open-source GST billing for Indian businesses"
- First comment: the personal story (why it was built)
- Ask beta users to upvote and leave honest reviews

#### Reddit

- r/india: "I built a free, open-source alternative to myBillBook for Indian businesses" (with context about the problem)
- r/IndianStockMarket: (only if there is a relevant thread about business tools)
- r/selfhosted: "Self-hosted invoicing and business management with GST compliance"
- r/opensource: "Open-source billing software built with React, Hono, PostgreSQL"
- r/webdev or r/programming: Focus on the tech stack and architecture decisions

**Reddit rules**: Be genuine. Share the story. Answer every comment. Do not astroturf. One post per subreddit, spaced 2-3 days apart.

#### Twitter/X Launch Thread

```
Thread:

1/ I just open-sourced Hisaabo -- billing software built for Indian
businesses that actually works.

Free forever. Unlimited invoices. Unlimited businesses.
GST-compliant. Dark mode. Keyboard shortcuts.

Here's the story. [thread emoji]

2/ I was using myBillBook for my trading business. The UI was slow.
The free tier capped me at 50 invoices. I needed a second business
but that required a paid plan.

I thought: I'm a developer. I can build something better.

3/ 6 months later, Hisaabo handles:
- GST invoicing (CGST/SGST/IGST auto-calc)
- Inventory with real-time stock
- Payment tracking (partial payments too)
- GSTR1/GSTR3B reports
- PDF invoices with UPI QR codes
- Multiple businesses from one account

4/ The core is open source. Self-host it on your own server for free.

Or use our cloud at hisaabo.in -- the free tier has no limits on
invoices, parties, items, or businesses.

We make money from team features and AI, not from gating basic billing.

5/ Tech stack for the nerds:
- React 19 + Vite + TanStack Router
- Hono + tRPC + Drizzle ORM
- PostgreSQL 16
- Tauri v2 for desktop
- Argon2id auth, CASL RBAC
- Zero JS frameworks on the marketing site (Astro)

6/ Coming next:
- Online store (your catalog, live, in 5 minutes)
- WhatsApp invoice sharing
- Bank reconciliation
- AI-powered HSN/GST suggestions

7/ Try it: https://hisaabo.in
GitHub: [link]
Docs: [link]

If you run an Indian business and billing software frustrates you,
give it 5 minutes. I think you'll be surprised.

Feedback welcome. I'm building this in public. [end]
```

#### LinkedIn

- Personal post (founder's profile) with the "why I built this" narrative
- Focus on the business problem, not the tech
- Tag relevant Indian startup/SMB communities

### Phase 3: SEO Content Push (Week 4-8)

- Publish 2 blog posts per week, starting with highest-volume keywords
- Priority order: GST invoice guide > GSTR1 guide > myBillBook comparison > HSN code guide
- Submit to Google Search Console, request indexing
- Internal linking strategy: every blog post links to at least 2 other posts and 1 product page
- Build backlinks: respond to Quora questions about GST/billing with helpful answers + link

### Phase 4: Paid Experiment (Week 8+, optional)

- Google Ads: "GST billing software free" and "myBillBook alternative" keywords
- Budget: Rs 500/day for 2 weeks as a test
- Measure: CPC, sign-up conversion rate, cost per activated user
- Decision: Continue if cost per activated user < Rs 100. Kill if > Rs 200.

---

## 12. Success Criteria & Measurement Plan

### Launch Day (Day 1)

| Metric | Target |
|--------|--------|
| Website loads without errors | 100% of pages |
| LCP on 4G | < 1.5s |
| Sign-up funnel works end-to-end | Verified manually |
| Analytics tracking | All page views recording |
| Zero broken links | Verified via crawler |

### Week 1

| Metric | Target |
|--------|--------|
| Unique visitors | > 500 (community launch traffic) |
| Sign-ups | > 50 |
| Bounce rate | < 55% |
| Pricing page views | > 20% of visitors |

### Month 1

| Metric | Target |
|--------|--------|
| Unique visitors | > 2,000 |
| Sign-ups | > 200 |
| Activation (first invoice created) | > 30% of sign-ups |
| Blog posts published | > 5 |
| GitHub stars (if open-sourced) | > 100 |

### Month 3

| Metric | Target |
|--------|--------|
| Monthly unique visitors | > 5,000 |
| Monthly sign-ups | > 500 |
| Organic search traffic | > 30% of total |
| Page 1 rankings | > 3 target keywords |
| Activation rate | > 40% |

### Month 6

| Metric | Target |
|--------|--------|
| Monthly unique visitors | > 15,000 |
| Monthly sign-ups | > 1,500 |
| Organic search traffic | > 50% of total |
| Page 1 rankings | > 5 target keywords |
| Paid tier conversion | > 5% of active free users |

---

## 13. Appendix

### A. Competitor Website Audit Notes

**myBillBook (mybillbook.in)**:
- Strengths: Strong SEO, clear pricing, "used by X lakh businesses" social proof, regional language support
- Weaknesses: Cluttered UI, aggressive popups, mobile-first design that feels cramped on desktop, free tier limitations prominently hidden
- Opportunity: Position as the "clean, modern, unlimited" alternative

**Vyaapaar (vyaparapp.in)**:
- Strengths: Desktop app positioning, Tally comparison angle
- Weaknesses: Dated design, feature-list-heavy pages, no open source angle
- Opportunity: Same desktop-first positioning but with modern UI

**Khatabook (khatabook.com)**:
- Strengths: Simple, mass-market appeal, strong mobile
- Weaknesses: Too simple for growing businesses, limited invoicing
- Opportunity: Position as "Khatabook for businesses that need more"

**Zoho Invoice (zoho.com/invoice)**:
- Strengths: Enterprise credibility, international
- Weaknesses: Complex, part of massive Zoho ecosystem (overwhelming), not India-specific
- Opportunity: "Everything you need from Zoho Invoice, nothing you don't"

### B. Key Dates

| Milestone | Target Date | Owner |
|-----------|------------|-------|
| PRD approved | Week 1 | PM |
| Design mockups (home, pricing) | Week 2-3 | Design |
| Product screenshots captured | Week 2 | PM/Design |
| Development sprint 1 (home, pricing, core pages) | Week 3-4 | Engineering |
| Development sprint 2 (features, blog, switch) | Week 5-6 | Engineering |
| Content: first 5 blog posts written | Week 4-6 | PM/Content |
| QA, performance testing, SEO audit | Week 7 | Engineering/PM |
| Soft launch | Week 8 | All |
| Community launch (HN, PH, Reddit, Twitter) | Week 9 | PM/Marketing |
| SEO content push begins | Week 10+ | PM/Content |

### C. Design Inspiration (Websites to Study)

- **Linear.app** -- Minimal, product-forward, dark mode hero, fast
- **Raycast.com** -- Developer-focused, clean typography, product screenshots as hero
- **Cal.com** -- Open source SaaS positioning done right, clear pricing
- **Plausible.io** -- Open source analytics, honest competitive positioning, clear value prop
- **Dub.co** -- Modern SaaS landing page, great use of social proof

These are aspirational references for visual quality and information architecture -- not templates to copy. Hisaabo's website should feel distinctly Indian and distinctly confident, not like another Silicon Valley clone.

### D. Content Style Guide (Quick Reference)

**Headlines**: Short. Punchy. Hinglish is welcome. Max 8-10 words.
- Good: "India ka billing software, jo actually kaam kare."
- Bad: "The Comprehensive Invoicing and Business Management Platform for Indian Enterprises"

**Subheadlines**: One sentence. English. Explains what the headline promises.
- Good: "Create GST invoices, manage inventory, and track payments -- free forever."
- Bad: "Our platform provides a suite of tools designed to streamline your business operations."

**Body copy**: Short paragraphs (2-3 sentences max). Active voice. Second person ("you", "your"). Specific numbers over vague claims.
- Good: "Your invoice is generated in under 2 seconds. CGST and SGST are calculated automatically based on your customer's state."
- Bad: "Our fast invoice generation engine leverages advanced algorithms to provide comprehensive tax calculation capabilities."

**CTAs**: Action verbs. Specific outcome. No "Learn More" (meaningless) or "Get Started" (vague).
- Good: "Start Free -- Create Your First Invoice"
- Good: "Import My myBillBook Data"
- Good: "View Pricing"
- Bad: "Learn More"
- Bad: "Get Started"
- Bad: "Sign Up"

### E. Accessibility Requirements

- WCAG 2.1 AA compliance minimum
- Color contrast ratios: 4.5:1 for normal text, 3:1 for large text
- All interactive elements keyboard-accessible
- Semantic HTML (proper heading hierarchy, landmark regions, alt text)
- Focus indicators visible
- Reduced motion support (respect `prefers-reduced-motion`)
- Screen reader testing before launch

---

*This PRD is a living document. It will be updated as design work begins, user feedback is collected, and priorities shift. The version number at the top tracks major revisions.*

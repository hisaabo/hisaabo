# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: global-setup.ts >> authenticate
- Location: e2e/global-setup.ts:19:6

# Error details

```
Error: business.create failed: {"error":{"json":{"message":"[\n  {\n    \"validation\": \"regex\",\n    \"code\": \"invalid_string\",\n    \"message\": \"Invalid\",\n    \"path\": [\n      \"gstin\"\n    ]\n  }\n]","code":-32600,"data":{"code":"BAD_REQUEST","httpStatus":400,"stack":"TRPCError: [\n  {\n    \"validation\": \"regex\",\n    \"code\": \"invalid_string\",\n    \"message\": \"Invalid\",\n    \"path\": [\n      \"gstin\"\n    ]\n  }\n]\n    at inputValidatorMiddleware (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/middleware.ts:195:15)\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at async callRecursive (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:642:20)\n    at async callRecursive (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:642:20)\n    at async callRecursive (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:642:20)\n    at async callRecursive (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:642:20)\n    at async procedure (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:682:20)\n    at async <anonymous> (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/http/resolveResponse.ts:374:31)\n    at async resolveResponse (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/http/resolveResponse.ts:412:31)\n    at async fetchRequestHandler (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/adapters/fetch/fetchRequestHandler.ts:41:10)","path":"business.create","zodError":null}},"meta":{"values":{"data.zodError":["undefined"]},"v":1}}}

expect(received).toBeTruthy()

Received: false
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - generic [ref=e6]:
      - img "Hisaabo" [ref=e7]
      - generic [ref=e13]: Hisaabo
    - navigation [ref=e14]:
      - generic [ref=e15]:
        - paragraph [ref=e16]: OVERVIEW
        - link "Dashboard" [ref=e17] [cursor=pointer]:
          - /url: /
          - img [ref=e18]
          - text: Dashboard
      - generic [ref=e23]:
        - paragraph [ref=e24]: SALES
        - link "Invoices" [ref=e25] [cursor=pointer]:
          - /url: /invoices
          - img [ref=e26]
          - text: Invoices
        - link "Quotations" [ref=e29] [cursor=pointer]:
          - /url: /quotations
          - img [ref=e30]
          - text: Quotations
        - link "Sales Returns" [ref=e34] [cursor=pointer]:
          - /url: /sales-returns
          - img [ref=e35]
          - text: Sales Returns
        - link "Credit Notes" [ref=e39] [cursor=pointer]:
          - /url: /credit-notes
          - img [ref=e40]
          - text: Credit Notes
        - link "Delivery Challans" [ref=e42] [cursor=pointer]:
          - /url: /delivery-challans
          - img [ref=e43]
          - text: Delivery Challans
        - link "Proforma Invoices" [ref=e48] [cursor=pointer]:
          - /url: /proforma-invoices
          - img [ref=e49]
          - text: Proforma Invoices
        - link "Store Orders" [ref=e53] [cursor=pointer]:
          - /url: /store-orders
          - img [ref=e54]
          - text: Store Orders
        - link "Recurring Invoices" [ref=e59] [cursor=pointer]:
          - /url: /automated-invoices
          - img [ref=e60]
          - text: Recurring Invoices
      - generic [ref=e65]:
        - paragraph [ref=e66]: CONTACTS
        - link "Parties" [ref=e67] [cursor=pointer]:
          - /url: /parties
          - img [ref=e68]
          - text: Parties
      - generic [ref=e71]:
        - paragraph [ref=e72]: INVENTORY
        - link "Items" [ref=e73] [cursor=pointer]:
          - /url: /items
          - img [ref=e74]
          - text: Items
      - generic [ref=e77]:
        - paragraph [ref=e78]: MONEY
        - link "Payments" [ref=e79] [cursor=pointer]:
          - /url: /payments
          - img [ref=e80]
          - text: Payments
        - link "Cash & Bank" [ref=e82] [cursor=pointer]:
          - /url: /cash-and-bank
          - img [ref=e83]
          - text: Cash & Bank
        - link "Expenses" [ref=e87] [cursor=pointer]:
          - /url: /expenses
          - img [ref=e88]
          - text: Expenses
        - link "Shipments" [ref=e91] [cursor=pointer]:
          - /url: /shipments
          - img [ref=e92]
          - text: Shipments
      - generic [ref=e98]:
        - paragraph [ref=e99]: COMPLIANCE
        - link "GST Returns" [ref=e100] [cursor=pointer]:
          - /url: /gst
          - img [ref=e101]
          - text: GST Returns
        - link "GSTR-2B Recon" [ref=e104] [cursor=pointer]:
          - /url: /gstr2b
          - img [ref=e105]
          - text: GSTR-2B Recon
        - link "Input Tax Credit" [ref=e107] [cursor=pointer]:
          - /url: /itc
          - img [ref=e108]
          - text: Input Tax Credit
        - link "E-Way Bills" [ref=e110] [cursor=pointer]:
          - /url: /eway-bills
          - img [ref=e111]
          - text: E-Way Bills
        - link "Business Reports" [ref=e113] [cursor=pointer]:
          - /url: /reports
          - img [ref=e114]
          - text: Business Reports
    - generic [ref=e117]:
      - paragraph [ref=e118]: E2E Test User's Organization
      - paragraph [ref=e119]: v0.6.5
  - main [ref=e120]:
    - generic [ref=e121]:
      - button "System theme" [ref=e122] [cursor=pointer]:
        - img [ref=e123]
      - button "Keyboard shortcuts" [ref=e126] [cursor=pointer]:
        - generic [ref=e127]: "?"
      - button "Settings" [ref=e128] [cursor=pointer]:
        - img [ref=e129]
      - generic [ref=e132]:
        - generic [ref=e133]:
          - generic [ref=e134]: ET
          - generic [ref=e135]: E2E Test User
          - generic [ref=e137]: Owner
        - button "Sign out" [ref=e138] [cursor=pointer]:
          - img [ref=e139]
    - generic [ref=e144]:
      - generic [ref=e146]:
        - heading "Almost there!" [level=1] [ref=e147]
        - paragraph [ref=e148]: Set up your business to start creating invoices
      - generic [ref=e149]:
        - heading "Set Up Your Business" [level=2] [ref=e150]
        - generic [ref=e151]:
          - generic [ref=e152]:
            - generic [ref=e153]:
              - generic [ref=e154]: Business Name*
              - textbox "Business Name*" [active] [ref=e155]
            - generic [ref=e156]:
              - generic [ref=e157]: Legal Name
              - textbox "Legal Name" [ref=e158]
          - generic [ref=e159]:
            - generic [ref=e161]:
              - generic [ref=e162]: GST Registration
              - combobox "GST Registration" [ref=e163] [cursor=pointer]:
                - generic [ref=e164]: Not GST Registered
                - img [ref=e165]
            - generic [ref=e167]:
              - generic [ref=e168]: PAN *
              - textbox "AAAAA0000A" [ref=e169]
          - generic [ref=e170]:
            - generic [ref=e171]:
              - generic [ref=e172]: Phone *
              - generic [ref=e173]:
                - generic [ref=e174]: "+91"
                - textbox "9876543210" [ref=e175]
            - generic [ref=e176]:
              - generic [ref=e177]: Email
              - textbox "Email" [ref=e178]
          - generic [ref=e179]:
            - generic [ref=e180]: Address*
            - textbox "Address*" [ref=e181]
          - generic [ref=e182]:
            - generic [ref=e183]:
              - generic [ref=e184]: Pincode
              - textbox "400001" [ref=e186]
            - generic [ref=e188]:
              - generic [ref=e189]: City
              - textbox "City" [ref=e190]
            - generic [ref=e192]:
              - generic [ref=e193]: State
              - generic [ref=e194]:
                - combobox "State" [ref=e195]
                - generic:
                  - img
          - generic [ref=e196]:
            - generic [ref=e197]: Currency
            - textbox "Currency" [ref=e198]: INR
          - button "Create Business" [ref=e200] [cursor=pointer]
```

# Test source

```ts
  1   | /**
  2   |  * global-setup.ts — Authenticate once, persist session for all tests.
  3   |  *
  4   |  * Registers a test user via the UI, creates a business via tRPC API,
  5   |  * then saves the browser storage state (cookies) so all test projects
  6   |  * can reuse the session without logging in again.
  7   |  *
  8   |  * Login page flow: magic-link (default) → password-login → register
  9   |  * Business creation: done via API (more reliable than filling the complex form)
  10  |  */
  11  | import { test as setup, expect } from "@playwright/test";
  12  | import path from "path";
  13  | import fs from "fs";
  14  | import type { GlobalSeed } from "./helpers/seed";
  15  | 
  16  | const AUTH_FILE = path.join(__dirname, ".auth", "user.json");
  17  | const SEED_FILE = path.join(__dirname, ".auth", "seed.json");
  18  | 
  19  | setup("authenticate", async ({ page, request }) => {
  20  |   // Ensure .auth directory exists
  21  |   const authDir = path.dirname(AUTH_FILE);
  22  |   if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  23  | 
  24  |   const email = `e2e-${Date.now()}@test.hisaabo.in`;
  25  |   const password = "Test@1234!";
  26  |   const name = "E2E Test User";
  27  | 
  28  |   // ── Step 1: Register via UI ───────────────────────────────────
  29  |   await page.goto("/login");
  30  | 
  31  |   // magic-link → password-login → register
  32  |   await page.getByText("Use password instead").click();
  33  |   await page.getByText("Create one").click();
  34  |   await expect(page.getByText("Create your account")).toBeVisible();
  35  | 
  36  |   await page.getByPlaceholder("Your name").fill(name);
  37  |   await page.getByPlaceholder("you@yourcompany.com").fill(email);
  38  |   await page.getByPlaceholder("Min 8 characters").fill(password);
  39  |   await page.getByPlaceholder("Repeat password").fill(password);
  40  |   await page.getByRole("button", { name: "Create account" }).click();
  41  | 
  42  |   // Wait for redirect away from login
  43  |   await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  44  | 
  45  |   // ── Step 2: Create business via API ───────────────────────────
  46  |   // Extract cookies from the browser context to use in API calls
  47  |   const cookies = await page.context().cookies();
  48  |   const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  49  |   const apiUrl = process.env.API_URL ?? "http://localhost:3000";
  50  | 
  51  |   const createBizRes = await request.post(`${apiUrl}/api/trpc/business.create`, {
  52  |     headers: {
  53  |       "Content-Type": "application/json",
  54  |       "X-Requested-With": "hisaabo",
  55  |       Cookie: cookieHeader,
  56  |     },
  57  |     data: {
  58  |       json: {
  59  |         name: "E2E Test Business",
  60  |         gstRegistrationType: "regular",
  61  |         gstin: "27AABCE2E00R1ZM",
  62  |         pan: "AAACE0000A",
  63  |         phone: "9876500000",
  64  |         email: email,
  65  |         address: "123 Test Road",
  66  |         city: "Mumbai",
  67  |         state: "Maharashtra",
  68  |         stateCode: "27",
  69  |         pincode: "400001",
  70  |         currency: "INR",
  71  |       },
  72  |     },
  73  |   });
  74  | 
> 75  |   expect(createBizRes.ok(), `business.create failed: ${await createBizRes.text()}`).toBeTruthy();
      |                                                                                     ^ Error: business.create failed: {"error":{"json":{"message":"[\n  {\n    \"validation\": \"regex\",\n    \"code\": \"invalid_string\",\n    \"message\": \"Invalid\",\n    \"path\": [\n      \"gstin\"\n    ]\n  }\n]","code":-32600,"data":{"code":"BAD_REQUEST","httpStatus":400,"stack":"TRPCError: [\n  {\n    \"validation\": \"regex\",\n    \"code\": \"invalid_string\",\n    \"message\": \"Invalid\",\n    \"path\": [\n      \"gstin\"\n    ]\n  }\n]\n    at inputValidatorMiddleware (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/middleware.ts:195:15)\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at async callRecursive (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:642:20)\n    at async callRecursive (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:642:20)\n    at async callRecursive (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:642:20)\n    at async callRecursive (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:642:20)\n    at async procedure (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts:682:20)\n    at async <anonymous> (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/http/resolveResponse.ts:374:31)\n    at async resolveResponse (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/unstable-core-do-not-import/http/resolveResponse.ts:412:31)\n    at async fetchRequestHandler (/home/saurabh/Coding/billkitaab/hisaabo/node_modules/@trpc/server/src/adapters/fetch/fetchRequestHandler.ts:41:10)","path":"business.create","zodError":null}},"meta":{"values":{"data.zodError":["undefined"]},"v":1}}}
  76  | 
  77  |   const bizData = await createBizRes.json();
  78  |   const businessId = bizData.result?.data?.json?.id ?? bizData.result?.data?.id;
  79  | 
  80  |   // ── Step 3: Seed a standard party + item ──────────────────────
  81  |   const partyName = "E2E Standard Customer";
  82  |   const itemName = "E2E Standard Product";
  83  | 
  84  |   const createPartyRes = await request.post(`${apiUrl}/api/trpc/party.create`, {
  85  |     headers: {
  86  |       "Content-Type": "application/json",
  87  |       "X-Requested-With": "hisaabo",
  88  |       Cookie: cookieHeader,
  89  |       "x-business-id": businessId,
  90  |     },
  91  |     data: {
  92  |       json: {
  93  |         name: partyName,
  94  |         type: "customer",
  95  |         phone: "9123400000",
  96  |         gstin: "",
  97  |         state: "Maharashtra",
  98  |         stateCode: "27",
  99  |       },
  100 |     },
  101 |   });
  102 |   expect(createPartyRes.ok(), `party.create failed: ${await createPartyRes.text()}`).toBeTruthy();
  103 |   const partyData = await createPartyRes.json();
  104 |   const partyId = partyData.result?.data?.json?.id ?? partyData.result?.data?.id;
  105 | 
  106 |   const createItemRes = await request.post(`${apiUrl}/api/trpc/item.create`, {
  107 |     headers: {
  108 |       "Content-Type": "application/json",
  109 |       "X-Requested-With": "hisaabo",
  110 |       Cookie: cookieHeader,
  111 |       "x-business-id": businessId,
  112 |     },
  113 |     data: {
  114 |       json: {
  115 |         name: itemName,
  116 |         hsn: "5208",
  117 |         unit: "pcs",
  118 |         itemMode: "simple",
  119 |         salePrice: "500.00",
  120 |         purchasePrice: "400.00",
  121 |         taxPercent: "18.00",
  122 |         itemType: "product",
  123 |         taxInclusive: false,
  124 |       },
  125 |     },
  126 |   });
  127 |   expect(createItemRes.ok(), `item.create failed: ${await createItemRes.text()}`).toBeTruthy();
  128 |   const itemData = await createItemRes.json();
  129 |   const itemId = itemData.result?.data?.json?.id ?? itemData.result?.data?.id;
  130 | 
  131 |   // Write seed IDs for tests to read
  132 |   const seed: GlobalSeed = { businessId, partyId, itemId, partyName, itemName };
  133 |   fs.writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
  134 | 
  135 |   // ── Step 4: Verify we're in the main app ──────────────────────
  136 |   // Reload to pick up the new business
  137 |   await page.goto("/invoices");
  138 |   await expect(page.locator("h1").first()).toContainText("Invoices", { timeout: 10_000 });
  139 | 
  140 |   // Save authenticated state
  141 |   await page.context().storageState({ path: AUTH_FILE });
  142 | });
  143 | 
```
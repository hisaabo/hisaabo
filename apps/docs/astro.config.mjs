import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "Hisaabo Docs",
      description: "Documentation for Hisaabo — self-hosted invoicing for Indian businesses",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: false,
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/hisaabo/hisaabo" },
      ],
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "What is Hisaabo?", slug: "getting-started" },
            { label: "Self-Hosting Setup", slug: "getting-started/self-hosting" },
            { label: "Create Your Business", slug: "getting-started/create-business" },
            { label: "Import Data", slug: "getting-started/import-data" },
          ],
        },
        {
          label: "Invoicing",
          items: [
            { label: "Overview", slug: "invoicing" },
            { label: "Create an Invoice", slug: "invoicing/create-invoice" },
            { label: "Invoice Statuses", slug: "invoicing/invoice-statuses" },
            { label: "Invoice PDF", slug: "invoicing/invoice-pdf" },
            { label: "GST on Invoices", slug: "invoicing/gst-on-invoices" },
          ],
        },
        {
          label: "Business Data",
          items: [
            {
              label: "Parties",
              items: [
                { label: "Managing Parties", slug: "parties" },
                { label: "Party Ledger", slug: "parties/party-ledger" },
              ],
            },
            {
              label: "Items & Inventory",
              items: [
                { label: "Managing Items", slug: "items" },
                { label: "Variants", slug: "items/variants" },
                { label: "Units & Conversions", slug: "items/units-and-conversions" },
              ],
            },
            { label: "Payments", slug: "payments" },
            { label: "Expenses", slug: "expenses" },
            { label: "Banking", slug: "banking" },
          ],
        },
        {
          label: "Reports & GST",
          items: [
            { label: "Business Reports", slug: "reports" },
            { label: "GST Compliance", slug: "gst" },
            { label: "GSTR-1 Filing", slug: "gst/gstr1" },
          ],
        },
        {
          label: "Settings & Team",
          items: [
            { label: "Settings", slug: "settings" },
            { label: "Team & Roles", slug: "team" },
            { label: "Invitations", slug: "team/invitations" },
            { label: "Online Store", slug: "online-store" },
          ],
        },
        {
          label: "Advanced",
          items: [
            { label: "Self-Hosting Reference", slug: "self-hosting" },
            {
              label: "AI & Automation",
              items: [
                { label: "Overview", slug: "ai" },
                { label: "MCP Server", slug: "ai/mcp-server" },
                { label: "CLI", slug: "ai/cli" },
                { label: "Integrations", slug: "ai/integrations" },
              ],
            },
            {
              label: "Reference",
              items: [
                { label: "Keyboard Shortcuts", slug: "reference/keyboard-shortcuts" },
                { label: "Supported Units", slug: "reference/supported-units" },
              ],
            },
          ],
        },
      ],
      defaultLocale: "en",
      head: [
        {
          tag: "meta",
          attrs: { name: "robots", content: "index, follow" },
        },
      ],
    }),
  ],
  site: "https://docs.hisaabo.in",
});

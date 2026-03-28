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
          autogenerate: { directory: "invoicing" },
        },
        {
          label: "Parties",
          autogenerate: { directory: "parties" },
        },
        {
          label: "Items & Inventory",
          autogenerate: { directory: "items" },
        },
        {
          label: "Payments",
          autogenerate: { directory: "payments" },
        },
        {
          label: "Expenses",
          autogenerate: { directory: "expenses" },
        },
        {
          label: "GST Compliance",
          autogenerate: { directory: "gst" },
        },
        {
          label: "Online Store",
          autogenerate: { directory: "online-store" },
        },
        {
          label: "Banking",
          autogenerate: { directory: "banking" },
        },
        {
          label: "Reports",
          autogenerate: { directory: "reports" },
        },
        {
          label: "Team & Roles",
          autogenerate: { directory: "team" },
        },
        {
          label: "Settings",
          autogenerate: { directory: "settings" },
        },
        {
          label: "Self-Hosting",
          autogenerate: { directory: "self-hosting" },
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
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

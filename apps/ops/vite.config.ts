import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The operator dashboard is served by the API at /ops under a strict CSP
// (script-src 'self'; style-src 'self'): hashed external assets only, no
// inline scripts or styles, no third-party hosts. See
// docs/architecture/queue.md §7.2.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  base: "/ops/",
  build: {
    outDir: "dist",
    target: "es2022",
    minify: true,
    // Keep everything as external, hashed files the CSP allows.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5175,
    // The API serves /ops/api same-origin in production; proxy it in dev.
    // Cookies are not port-scoped, so the API's session_id cookie for
    // localhost reaches the proxy too.
    proxy: {
      "/ops/api": { target: "http://localhost:3000", changeOrigin: false },
    },
  },
});

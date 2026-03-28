import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  base: "/",
  build: {
    outDir: "dist",
    target: "es2022",
    minify: true,
  },
  server: {
    port: 5174,
    proxy: {
      // Proxy API calls to the backend — store runs on its own subdomain,
      // so the slug is at the root: /<slug>/catalog.json (not /store/<slug>/...)
      // But the API endpoints still use /store/ prefix on the backend
      "^/[^/]+/catalog\\.json": { target: "http://localhost:3000", changeOrigin: true, rewrite: (path) => `/store${path}` },
      "^/[^/]+/order$": { target: "http://localhost:3000", changeOrigin: true, rewrite: (path) => `/store${path}` },
      "^/[^/]+/identify$": { target: "http://localhost:3000", changeOrigin: true, rewrite: (path) => `/store${path}` },
    },
  },
});

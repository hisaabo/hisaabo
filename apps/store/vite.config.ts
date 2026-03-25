import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  base: "/store/",
  build: {
    outDir: "dist",
    target: "es2022",
    minify: true,
  },
  server: {
    port: 5174,
    proxy: {
      // Proxy API calls to the backend (catalog.json + order endpoints)
      "^/store/[^/]+/catalog\\.json": { target: "http://localhost:3000", changeOrigin: true },
      "^/store/[^/]+/order$": { target: "http://localhost:3000", changeOrigin: true },
      "^/store/[^/]+/identify$": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});

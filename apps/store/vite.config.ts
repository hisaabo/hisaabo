import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2022",
    minify: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/store": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});

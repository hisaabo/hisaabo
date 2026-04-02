import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));

function getVersion(): string {
  // CI sets this from the git tag; fallback to git describe, then package.json
  if (process.env.VITE_APP_VERSION) return process.env.VITE_APP_VERSION;
  try {
    return execSync("git describe --tags --abbrev=0", { encoding: "utf-8" }).trim();
  } catch {
    return pkg.version;
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(getVersion()),
  },
  plugins: [
    TanStackRouterVite(),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-router': ['@tanstack/react-router'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-trpc': ['@trpc/client', '@trpc/react-query', 'superjson'],
        },
      },
    },
  },
});

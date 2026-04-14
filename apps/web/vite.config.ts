import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));

// SHA-256 hash of the inline theme-detection script in index.html (lines 36-40).
// Recompute with: node -e "const c=require('crypto'),f=require('fs');
//   const h=f.readFileSync('index.html','utf-8');
//   const s=h.slice(h.indexOf('<script>\n',h.indexOf('hisaabo-theme'))+8, h.indexOf('</script>',h.indexOf('hisaabo-theme')));
//   console.log('sha256-'+c.createHash('sha256').update(s).digest('base64'));"
const THEME_SCRIPT_HASH = "sha256-7v6Dh3op5YztyC/jZCheSbtL3NqCrnIjQcllTk6J6Ug=";

function cspPlugin(): Plugin {
  return {
    name: "csp-meta-tag",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const isDev = ctx.server !== undefined;
        const apiOrigin = process.env.VITE_API_URL; // e.g. "https://api.hisaabo.in"
        const connectSrc = isDev
          ? "connect-src 'self' ws:"
          : apiOrigin
            ? `connect-src 'self' ${apiOrigin}`
            : "connect-src 'self'";

        const directives = [
          "default-src 'self'",
          `script-src 'self' '${THEME_SCRIPT_HASH}' https://challenges.cloudflare.com`,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob:",
          connectSrc,
          "frame-src https://challenges.cloudflare.com",
          "object-src 'none'",
          "base-uri 'self'",
        ];

        const cspContent = directives.join("; ");
        const metaTag = `<meta http-equiv="Content-Security-Policy" content="${cspContent}">`;

        return html.replace("<head>", `<head>\n    ${metaTag}`);
      },
    },
  };
}

function getVersion(): string {
  // CI sets this from the git tag; fallback to git describe, then package.json
  // Always strip leading "v" — the display template adds its own "v" prefix
  if (process.env.VITE_APP_VERSION) return process.env.VITE_APP_VERSION.replace(/^v/, "");
  try {
    return execSync("git describe --tags --abbrev=0", { encoding: "utf-8" }).trim().replace(/^v/, "");
  } catch {
    return pkg.version;
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(getVersion()),
  },
  plugins: [
    cspPlugin(),
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
    sourcemap: "hidden",
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

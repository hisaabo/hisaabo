import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEFAULT_API_ORIGIN = "https://api.hisaabo.in";

export function apiOriginOf(value: string | undefined): string {
  if (!value) return DEFAULT_API_ORIGIN;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : DEFAULT_API_ORIGIN;
  } catch {
    return DEFAULT_API_ORIGIN;
  }
}

export function headersFile(apiOrigin: string): string {
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${apiOrigin}`,
    `connect-src 'self' ${apiOrigin}`,
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
    "  Strict-Transport-Security: max-age=63072000; includeSubDomains",
    "",
  ].join("\n");
}

// Cloudflare Pages reads dist/_headers. The API origin comes from VITE_API_URL
// at build time so self-hosters never edit a static file.
function headersPlugin(apiOrigin: string): Plugin {
  return {
    name: "store-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: headersFile(apiOrigin) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    react(),
    headersPlugin(apiOriginOf(process.env.VITE_API_URL ?? loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL)),
  ],
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
      // Store asset endpoints carry the /store prefix exactly as the catalog
      // returns them (logo, item images). Forward untouched so
      // <img src="/store/<slug>/..."> works in dev just like production. This
      // must come before the slug-rooted rules so it wins for /store/* paths.
      "^/store/": { target: "http://localhost:3000", changeOrigin: true },
      "^/[^/]+/catalog\\.json": { target: "http://localhost:3000", changeOrigin: true, rewrite: (path) => `/store${path}` },
      "^/[^/]+/order$": { target: "http://localhost:3000", changeOrigin: true, rewrite: (path) => `/store${path}` },
      "^/[^/]+/identify$": { target: "http://localhost:3000", changeOrigin: true, rewrite: (path) => `/store${path}` },
      "^/[^/]+/otp/(send|verify)$": { target: "http://localhost:3000", changeOrigin: true, rewrite: (path) => `/store${path}` },
    },
  },
}));

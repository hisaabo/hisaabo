import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { generateWellKnown } from "./src/lib/well-known.ts";

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf-8"));

// SHA-256 hash of the inline theme-detection script in index.html (lines 36-40).
// Recompute with: node -e "const c=require('crypto'),f=require('fs');
//   const h=f.readFileSync('index.html','utf-8');
//   const s=h.slice(h.indexOf('<script>\n',h.indexOf('hisaabo-theme'))+8, h.indexOf('</script>',h.indexOf('hisaabo-theme')));
//   console.log('sha256-'+c.createHash('sha256').update(s).digest('base64'));"
const THEME_SCRIPT_HASH = "sha256-7v6Dh3op5YztyC/jZCheSbtL3NqCrnIjQcllTk6J6Ug=";

function apiOriginOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function cspDirectives(isDev: boolean, apiOrigin: string | undefined): string[] {
  const connectSrc = isDev
    ? "connect-src 'self' ws:"
    : apiOrigin
      ? `connect-src 'self' ${apiOrigin}`
      : "connect-src 'self'";
  // Logos and item images are fetched from the API origin via apiUrl().
  const imgSrc = apiOrigin ? `img-src 'self' data: blob: ${apiOrigin}` : "img-src 'self' data: blob:";

  return [
    "default-src 'self'",
    `script-src 'self' '${THEME_SCRIPT_HASH}' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    imgSrc,
    connectSrc,
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
  ];
}

function cspPlugin(): Plugin {
  const apiOrigin = apiOriginOf(process.env.VITE_API_URL); // e.g. "https://api.hisaabo.in"
  return {
    name: "csp-meta-tag",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const isDev = ctx.server !== undefined;
        const cspContent = cspDirectives(isDev, apiOrigin).join("; ");
        const metaTag = `<meta http-equiv="Content-Security-Policy" content="${cspContent}">`;

        return html.replace("<head>", `<head>\n    ${metaTag}`);
      },
    },
    // Cloudflare Pages reads dist/_headers. The same policy is sent as an HTTP
    // header so frame-ancestors (ignored in <meta>) is enforced.
    generateBundle() {
      const csp = [...cspDirectives(false, apiOrigin), "frame-ancestors 'none'"].join("; ");
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: [
          "/*",
          `  Content-Security-Policy: ${csp}`,
          "  Strict-Transport-Security: max-age=63072000; includeSubDomains",
          "  Cross-Origin-Opener-Policy: same-origin",
          "  X-Content-Type-Options: nosniff",
          "  X-Frame-Options: DENY",
          "  Referrer-Policy: strict-origin-when-cross-origin",
          "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
          "",
          "/.well-known/apple-app-site-association",
          "  Content-Type: application/json",
          "",
        ].join("\n"),
      });
    },
  };
}

/**
 * Emits the Android/iOS app-link association files from
 * VITE_ANDROID_APP_CERT_SHA256 (comma-separated) and VITE_APPLE_TEAM_ID.
 * Without them the build still succeeds, with placeholders and a warning.
 */
function wellKnownPlugin(): Plugin {
  return {
    name: "well-known-app-links",
    generateBundle() {
      const { assetlinks, aasa, warnings } = generateWellKnown(process.env);
      for (const warning of warnings) this.warn(warning);
      this.emitFile({
        type: "asset",
        fileName: ".well-known/assetlinks.json",
        source: JSON.stringify(assetlinks, null, 2) + "\n",
      });
      this.emitFile({
        type: "asset",
        fileName: ".well-known/apple-app-site-association",
        source: JSON.stringify(aasa, null, 2) + "\n",
      });
    },
  };
}

/**
 * Injects the Chrome/Edge origin-trial token that turns on the WebMCP API
 * (`document.modelContext`) for this origin.
 *
 * Tokens are bound to a single origin, so self-hosters register their own at
 * https://developer.chrome.com/origintrials. Unset in dev and for anyone
 * testing behind chrome://flags/#enable-webmcp-testing — the meta tag is
 * simply omitted then, and the app falls back to feature detection.
 */
function originTrialPlugin(): Plugin {
  return {
    name: "origin-trial-meta-tag",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const token = process.env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN;
        if (!token) return html;

        // Tokens are base64 — strip anything that could break out of the attribute.
        const safeToken = token.trim().replace(/["'<>]/g, "");
        if (!safeToken) return html;

        const metaTag = `<meta http-equiv="origin-trial" content="${safeToken}">`;
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
    originTrialPlugin(),
    wellKnownPlugin(),
    TanStackRouterVite(),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "vendor-router", test: /[\\/]node_modules[\\/]@tanstack[\\/](react-router|router-core|history)[\\/]/ },
            { name: "vendor-query", test: /[\\/]node_modules[\\/]@tanstack[\\/](react-query|query-core)[\\/]/ },
            { name: "vendor-trpc", test: /[\\/]node_modules[\\/](@trpc[\\/](client|react-query|server)|superjson|copy-anything|is-what)[\\/]/ },
          ],
        },
      },
    },
  },
});

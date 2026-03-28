# @hisaabo/desktop

A native desktop wrapper for the Hisaabo web app. Built with Tauri v2, it ships a lightweight executable (macOS, Windows, Linux) that embeds the `apps/web` React app in a native webview with a proper window frame, system tray, and native OS integration.

[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-stable-CE4A00?logo=rust&logoColor=white)](https://www.rust-lang.org/)

---

## Cloud vs. self-hosted

The desktop app is a **Hisaabo Cloud** feature. Pre-built installers connect to `https://app.hisaabo.in` (Hisaabo Cloud) and are distributed to cloud subscribers.

If you are self-hosting Hisaabo, you do not need the desktop app. The web app (`apps/web`) runs in any browser and delivers the same full-featured experience.

**Advanced:** Self-hosted users can build the desktop app from source, targeting their own API, by setting `VITE_API_URL` to their server URL before running `cargo tauri build`.

## What this app does

The desktop app is a thin Tauri v2 shell. In development it points its webview at `http://localhost:5173` (the Vite dev server). In production it embeds the built output of `apps/web/dist` directly into the binary — no external web server required.

Feature parity with the web app is complete by design: the desktop app renders the same React application with no code differences.

**Window configuration:**
- Default size: 1200 × 800 px
- Minimum size: 900 × 600 px
- App identifier: `in.hisaabo.app`

---

## Prerequisites

- Rust stable toolchain: [rustup.rs](https://rustup.rs/)
- Tauri CLI: `cargo install tauri-cli`
- Platform build tools:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** Microsoft C++ Build Tools or Visual Studio
  - **Linux:** `build-essential`, `libwebkit2gtk-4.1-dev`, `libssl-dev` (see [Tauri Linux prerequisites](https://tauri.app/start/prerequisites/))
- Node.js 20+ and pnpm 9+ (for the web frontend build)

---

## Development

Starting the desktop app in development builds and hot-reloads the web frontend automatically:

```bash
cd apps/desktop
cargo tauri dev
```

This runs `pnpm --filter @hisaabo/web dev` (the `beforeDevCommand` in `tauri.conf.json`) and opens a native window pointed at `http://localhost:5173`. The API server must be running separately:

```bash
# Terminal 1 — start the API
pnpm --filter @hisaabo/api dev

# Terminal 2 — start the desktop app (starts web automatically)
cd apps/desktop && cargo tauri dev
```

---

## Building

```bash
cd apps/desktop
cargo tauri build
```

This runs `pnpm --filter @hisaabo/web build` first (the `beforeBuildCommand`), then bundles the built web output into the native binary.

### Output artifacts

| Platform | Artifact | Location |
|---|---|---|
| macOS | `.dmg` installer + `.app` bundle | `target/release/bundle/dmg/` |
| Windows | `.msi` installer + `.exe` | `target/release/bundle/msi/` |
| Linux | `.AppImage`, `.deb` | `target/release/bundle/appimage/`, `bundle/deb/` |

The `targets: "all"` setting in `tauri.conf.json` builds all available formats for the current platform.

---

## API connection

In development the desktop app connects to the API at `http://localhost:3000` (proxied through Vite at `/api`). In production builds the webview loads from the embedded static files, so API calls go to whatever `VITE_API_URL` was set to at build time, or fall back to relative `/api` paths (which requires the API to be served from the same origin or configured via a reverse proxy).

The CSP in `tauri.conf.json` allows connections to `http://localhost:3000` (dev) and `https://*.pages.dev` (Cloudflare Pages builds):

```json
"csp": "default-src 'self'; connect-src 'self' http://localhost:3000 https://*.pages.dev"
```

Adjust this for your production API domain.

---

## Project structure

```
apps/desktop/
├── src-tauri/
│   ├── src/
│   │   └── main.rs         # Tauri app entry point
│   ├── icons/              # App icons for all platforms
│   ├── tauri.conf.json     # Window config, CSP, build commands
│   └── Cargo.toml          # Rust dependencies
└── (no web source — web code lives in apps/web)
```

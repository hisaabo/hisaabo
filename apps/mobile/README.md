# @hisaabo/mobile

The Hisaabo mobile app. Built with Expo SDK 52 and React Native 0.76, it runs on Android and iOS using the same tRPC API as the web dashboard.

[![Expo](https://img.shields.io/badge/Expo-SDK_52-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React_Native-0.76-61DAFB?logo=react&logoColor=black)](https://reactnative.dev/)
[![New Architecture](https://img.shields.io/badge/New_Architecture-enabled-green)](https://reactnative.dev/docs/the-new-architecture/landing-page)

---

## Cloud vs. self-hosted

The mobile app is a **Hisaabo Cloud** feature. It connects to `https://api.hisaabo.in` by default and is available free with basic features on the App Store and Google Play.

If you are self-hosting Hisaabo, you do not need the mobile app. The web app (`apps/web`) is fully responsive and works on any mobile browser.

**Advanced:** Self-hosted users can point the mobile app at their own server by setting `EXPO_PUBLIC_API_URL` to their API URL before building. This requires building from source — pre-built store binaries connect to Hisaabo Cloud only.

## What this app does

The mobile app gives business owners and their teams on-the-go access to core Hisaabo features. It uses Expo Router for file-based navigation and communicates with the same Hono + tRPC API as the web app, authenticated via Bearer tokens stored in `expo-secure-store`.

Feature coverage vs. the web app is tracked in [feature-parity.yaml](../../feature-parity.yaml) at the monorepo root.

---

## Running locally

### Option 1: Expo Go (quickest start)

No build required. Install Expo Go on your physical device or emulator, then:

```bash
# From monorepo root
pnpm --filter @hisaabo/mobile dev

# Or from this directory
pnpm dev
```

Scan the QR code from the Expo Go app. The API server must be reachable from the device.

### Option 2: Android emulator (WSL + Windows)

The Android emulator runs in Windows. The API runs in WSL. The `dev:android` script handles the IP bridging automatically:

```bash
# From monorepo root — auto-detects WSL IP and sets EXPO_PUBLIC_API_URL
pnpm dev:mobile:android
```

**One-time Windows setup:**

1. Install [Android Studio](https://developer.android.com/studio) on Windows.
2. Open Android Studio, go to **More Actions > Virtual Device Manager**, and create an emulator (Pixel 8, API 35 recommended).
3. Start the emulator from Android Studio.
4. Run the command above from a WSL terminal. Expo will open in the emulator automatically.

If the emulator cannot reach the WSL API, check that your Windows Firewall allows inbound connections on port 3000, or run:

```powershell
# In PowerShell (Windows), allow WSL through firewall
New-NetFirewallRule -DisplayName "WSL API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### Option 3: iOS simulator (macOS only)

```bash
pnpm --filter @hisaabo/mobile dev:ios
```

Requires Xcode and iOS Simulator installed on macOS.

---

## Building

### Debug APK (Android)

```bash
pnpm --filter @hisaabo/mobile build:apk
```

This runs `apps/mobile/scripts/build-apk.sh`, which handles the Expo prebuild and local Gradle build. The APK is output to `android/app/build/outputs/apk/`.

### EAS Build (cloud, recommended for release)

Hisaabo uses [Expo Application Services](https://expo.dev/eas) for CI/CD builds. Three profiles are defined in `eas.json`:

| Profile | Distribution | Android output |
|---|---|---|
| `development` | Internal | Development client |
| `preview` | Internal | APK |
| `production` | Store | App bundle (.aab) |

```bash
# Install EAS CLI
npm install -g eas-cli

# Build a preview APK
eas build --profile preview --platform android

# Build a production app bundle for Play Store
eas build --profile production --platform android
```

### Expo prebuild (generate native projects)

If you need to modify native code (add a native module, change permissions, etc.):

```bash
pnpm --filter @hisaabo/mobile prebuild
```

This generates the `android/` and `ios/` directories from the Expo config. These directories are gitignored — regenerate them when needed.

---

## Project structure

```
apps/mobile/
├── app/
│   ├── (auth)/          # Login, register, magic link screens
│   └── (app)/           # Main app tabs (guarded by auth)
├── src/
│   ├── components/      # Shared UI components
│   ├── hooks/           # Custom React hooks
│   ├── lib/             # tRPC client, API config, date/money helpers
│   ├── providers/       # tRPC provider, auth context
│   └── stores/          # Zustand stores (auth state, active business)
├── assets/              # App icon, splash screen
├── scripts/             # build-apk.sh for local APK builds
├── app.json             # Expo config (bundle ID: in.hisaabo.app)
└── eas.json             # EAS build profiles
```

---

## Key patterns

### Authentication

The mobile app uses **Bearer token auth** rather than cookies (cookies are not reliable in React Native). On login, the server returns a session token; the app stores it in `expo-secure-store` (hardware-backed encrypted storage on supported devices).

Every tRPC request includes `Authorization: Bearer <token>` via a custom header in the tRPC client link configuration.

### tRPC client

The mobile app imports `AppRouter` from `@hisaabo/api` (devDependency, types only) and creates a typed tRPC client with `httpBatchLink`, identical in shape to the web client but configured for Bearer auth instead of cookies:

```typescript
// src/lib/trpc.ts
import type { AppRouter } from "@hisaabo/api";
import { createTRPCReact } from "@trpc/react-query";

export const trpc = createTRPCReact<AppRouter>();
```

### Business selection

The active business ID is stored in a Zustand store and injected as an `x-business-id` header on all business-scoped tRPC calls — the same pattern as the web app.

### Biometric authentication

The app uses `expo-local-authentication` to optionally gate access behind Face ID / fingerprint after the session is established. This is a client-side convenience layer on top of the server session — it does not replace token auth.

### Shared validators and money module

The mobile app imports `@hisaabo/shared` directly, giving it access to the same Zod schemas and the `money` fixed-point arithmetic module used by the API and web app. Never use `parseFloat` for monetary values.

---

## Environment variables

The Expo config reads environment variables prefixed with `EXPO_PUBLIC_`:

| Variable | Description | Default |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | API server base URL | `https://api.hisaabo.in` (Hisaabo Cloud) |

For local development the `dev:android` script sets this automatically to your WSL IP.

For production Hisaabo Cloud builds, `EXPO_PUBLIC_API_URL` is set to `https://api.hisaabo.in` in the EAS project environment variables on [expo.dev](https://expo.dev). If you are building a custom binary targeting your own self-hosted server, set this variable to your API's public URL instead.

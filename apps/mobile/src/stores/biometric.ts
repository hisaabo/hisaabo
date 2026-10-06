import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { sha256Hex, randomHex } from "../lib/sha256";
import { useAuthStore } from "./auth";

const BIOMETRIC_ENABLED_KEY = "hisaabo_biometric_enabled";
const PIN_HASH_KEY = "hisaabo_pin_hash";
const SETUP_PROMPTED_KEY = "hisaabo_setup_prompted";

const PIN_SALT_KEY = "hisaabo_pin_salt";
const PIN_FAILS_KEY = "hisaabo_pin_fails";
const PIN_LOCK_UNTIL_KEY = "hisaabo_pin_lock_until";

const PIN_HASH_V2 = "v2";
const PIN_HASH_ITERATIONS = 2000;
export const MAX_PIN_FAILURES = 10;

/**
 * Legacy 32-bit hash. Kept only to verify PINs stored by older versions once,
 * after which they are re-hashed with the salted scheme.
 */
function legacyHashPin(pin: string): string {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return String(hash);
}

function derivePinHash(pin: string, salt: string): string {
  let digest = sha256Hex(`${salt}:${pin}`);
  for (let i = 1; i < PIN_HASH_ITERATIONS; i++) {
    digest = sha256Hex(`${digest}${salt}${pin}`);
  }
  return digest;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function storePinHash(pin: string): Promise<void> {
  const salt = randomHex(16);
  await SecureStore.setItemAsync(PIN_SALT_KEY, salt);
  await SecureStore.setItemAsync(PIN_HASH_KEY, `${PIN_HASH_V2}$${derivePinHash(pin, salt)}`);
}

/** Lockout after the Nth consecutive failure: 5 -> 30s, 6 -> 5min, 7-9 -> 1h. */
export function lockoutMsForFailures(failures: number): number {
  if (failures < 5) return 0;
  if (failures === 5) return 30 * 1000;
  if (failures === 6) return 5 * 60 * 1000;
  return 60 * 60 * 1000;
}

interface BiometricState {
  biometricEnabled: boolean;
  pinEnabled: boolean;
  isLocked: boolean;
  isHydrated: boolean;
  setupPrompted: boolean;
  /** Epoch ms until which PIN entry is refused (0 = not locked out). */
  pinLockedUntil: number;

  hydrate: () => Promise<void>;
  enableBiometric: () => Promise<void>;
  disableBiometric: () => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  clearPin: () => Promise<void>;
  unlock: () => void;
  lock: () => void;
  markSetupPrompted: () => Promise<void>;

  /** Check if device supports biometric authentication */
  checkHardware: () => Promise<{ available: boolean; types: LocalAuthentication.AuthenticationType[] }>;

  /** Attempt biometric authentication. Returns { success, cancelled } */
  authenticate: () => Promise<{ success: boolean; cancelled: boolean }>;

  /** Verify a PIN against stored hash. Enforces lockout; returns false while locked out. */
  verifyPin: (pin: string) => Promise<boolean>;

  /** Load the persisted PIN lockout deadline into state and return it (epoch ms, 0 if none). */
  refreshPinLockout: () => Promise<number>;
}

export const useBiometricStore = create<BiometricState>((set, get) => ({
  biometricEnabled: false,
  pinEnabled: false,
  isLocked: false,
  isHydrated: false,
  setupPrompted: false,
  pinLockedUntil: 0,

  hydrate: async () => {
    try {
      const [biometricRaw, pinHash, prompted] = await Promise.all([
        SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY),
        SecureStore.getItemAsync(PIN_HASH_KEY),
        SecureStore.getItemAsync(SETUP_PROMPTED_KEY),
      ]);

      const biometricEnabled = biometricRaw === "1";
      const pinEnabled = !!pinHash;
      const setupPrompted = prompted === "1";

      // If biometric or PIN is enabled, start locked
      const isLocked = biometricEnabled || pinEnabled;

      set({
        biometricEnabled,
        pinEnabled,
        isLocked,
        isHydrated: true,
        setupPrompted,
      });
    } catch {
      // SecureStore failures are non-fatal
      set({ isHydrated: true });
    }
  },

  enableBiometric: async () => {
    try {
      await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "1");
      set({ biometricEnabled: true });
    } catch {
      // non-fatal
    }
  },

  disableBiometric: async () => {
    try {
      await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
      set({ biometricEnabled: false });
    } catch {
      // non-fatal
    }
  },

  setPin: async (pin: string) => {
    try {
      await storePinHash(pin);
      await SecureStore.deleteItemAsync(PIN_FAILS_KEY);
      await SecureStore.deleteItemAsync(PIN_LOCK_UNTIL_KEY);
      set({ pinEnabled: true, pinLockedUntil: 0 });
    } catch {
      // non-fatal
    }
  },

  clearPin: async () => {
    try {
      await SecureStore.deleteItemAsync(PIN_HASH_KEY);
      await SecureStore.deleteItemAsync(PIN_SALT_KEY);
      await SecureStore.deleteItemAsync(PIN_FAILS_KEY);
      await SecureStore.deleteItemAsync(PIN_LOCK_UNTIL_KEY);
      set({ pinEnabled: false, pinLockedUntil: 0 });
    } catch {
      // non-fatal
    }
  },

  unlock: () => {
    set({ isLocked: false });
  },

  lock: () => {
    const { biometricEnabled, pinEnabled } = get();
    if (biometricEnabled || pinEnabled) {
      set({ isLocked: true });
    }
  },

  markSetupPrompted: async () => {
    try {
      await SecureStore.setItemAsync(SETUP_PROMPTED_KEY, "1");
      set({ setupPrompted: true });
    } catch {
      // non-fatal
    }
  },

  checkHardware: async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      return {
        available: hasHardware && isEnrolled,
        types,
      };
    } catch {
      return { available: false, types: [] };
    }
  },

  authenticate: async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Hisaabo",
        cancelLabel: "Use PIN",
        disableDeviceFallback: true,
        fallbackLabel: "Use PIN",
      });
      // When the user taps "Use PIN" / cancel on the system dialog,
      // result.success is false and result.error is "user_cancel".
      const cancelled = !result.success && result.error === "user_cancel";
      return { success: result.success, cancelled };
    } catch {
      return { success: false, cancelled: false };
    }
  },

  refreshPinLockout: async () => {
    try {
      const raw = await SecureStore.getItemAsync(PIN_LOCK_UNTIL_KEY);
      const until = Number(raw) || 0;
      set({ pinLockedUntil: until > Date.now() ? until : 0 });
      return until > Date.now() ? until : 0;
    } catch {
      return 0;
    }
  },

  verifyPin: async (pin: string) => {
    try {
      const lockUntil = Number(await SecureStore.getItemAsync(PIN_LOCK_UNTIL_KEY)) || 0;
      if (lockUntil > Date.now()) {
        set({ pinLockedUntil: lockUntil });
        return false;
      }

      const storedHash = await SecureStore.getItemAsync(PIN_HASH_KEY);
      if (!storedHash) return false;

      let valid: boolean;
      if (storedHash.startsWith(`${PIN_HASH_V2}$`)) {
        const salt = await SecureStore.getItemAsync(PIN_SALT_KEY);
        valid = !!salt && timingSafeEqual(storedHash.slice(PIN_HASH_V2.length + 1), derivePinHash(pin, salt));
      } else {
        valid = timingSafeEqual(storedHash, legacyHashPin(pin));
        // Migrate the legacy 32-bit hash to the salted scheme on first success.
        if (valid) await storePinHash(pin).catch(() => {});
      }

      if (valid) {
        await SecureStore.deleteItemAsync(PIN_FAILS_KEY);
        await SecureStore.deleteItemAsync(PIN_LOCK_UNTIL_KEY);
        set({ pinLockedUntil: 0 });
        return true;
      }

      const failures = (Number(await SecureStore.getItemAsync(PIN_FAILS_KEY)) || 0) + 1;
      await SecureStore.setItemAsync(PIN_FAILS_KEY, String(failures));

      if (failures >= MAX_PIN_FAILURES) {
        // Too many guesses: wipe the local lock and the session so the PIN
        // can no longer protect (or be brute-forced into) an open session.
        await get().clearPin();
        await get().disableBiometric();
        set({ isLocked: false });
        await useAuthStore.getState().logout();
        return false;
      }

      const lockMs = lockoutMsForFailures(failures);
      if (lockMs > 0) {
        const until = Date.now() + lockMs;
        await SecureStore.setItemAsync(PIN_LOCK_UNTIL_KEY, String(until));
        set({ pinLockedUntil: until });
      }
      return false;
    } catch {
      return false;
    }
  },
}));

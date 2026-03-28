import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

const BIOMETRIC_ENABLED_KEY = "hisaabo_biometric_enabled";
const PIN_HASH_KEY = "hisaabo_pin_hash";
const SETUP_PROMPTED_KEY = "hisaabo_setup_prompted";

/**
 * Simple hash for PIN (local UX lock only, not a security boundary).
 * The real auth is the session token in SecureStore.
 */
function hashPin(pin: string): string {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return String(hash);
}

interface BiometricState {
  biometricEnabled: boolean;
  pinEnabled: boolean;
  isLocked: boolean;
  isHydrated: boolean;
  setupPrompted: boolean;

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

  /** Attempt biometric authentication */
  authenticate: () => Promise<boolean>;

  /** Verify a PIN against stored hash */
  verifyPin: (pin: string) => Promise<boolean>;
}

export const useBiometricStore = create<BiometricState>((set, get) => ({
  biometricEnabled: false,
  pinEnabled: false,
  isLocked: false,
  isHydrated: false,
  setupPrompted: false,

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
      const hashed = hashPin(pin);
      await SecureStore.setItemAsync(PIN_HASH_KEY, hashed);
      set({ pinEnabled: true });
    } catch {
      // non-fatal
    }
  },

  clearPin: async () => {
    try {
      await SecureStore.deleteItemAsync(PIN_HASH_KEY);
      set({ pinEnabled: false });
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
      return result.success;
    } catch {
      return false;
    }
  },

  verifyPin: async (pin: string) => {
    try {
      const storedHash = await SecureStore.getItemAsync(PIN_HASH_KEY);
      if (!storedHash) return false;
      return hashPin(pin) === storedHash;
    } catch {
      return false;
    }
  },
}));

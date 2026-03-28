import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const BIZ_KEY = "hisaabo_business";

interface BusinessState {
  businessId: string | null;
  businessName: string | null;
  isHydrated: boolean;
  setBusiness: (id: string, name: string) => Promise<void>;
  clearBusiness: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useBusinessStore = create<BusinessState>((set) => ({
  businessId: null,
  businessName: null,
  isHydrated: false,

  setBusiness: async (id, name) => {
    set({ businessId: id, businessName: name });
    try {
      await SecureStore.setItemAsync(BIZ_KEY, JSON.stringify({ id, name }));
    } catch {
      // SecureStore failures are non-fatal — in-memory state is still set
    }
  },

  clearBusiness: async () => {
    set({ businessId: null, businessName: null });
    try {
      await SecureStore.deleteItemAsync(BIZ_KEY);
    } catch {
      // non-fatal
    }
  },

  hydrate: async () => {
    try {
      const raw = await SecureStore.getItemAsync(BIZ_KEY);
      if (raw) {
        const { id, name } = JSON.parse(raw);
        set({ businessId: id, businessName: name });
      }
    } catch {
      // Corrupted entry — ignore and let the app re-select
    } finally {
      set({ isHydrated: true });
    }
  },
}));

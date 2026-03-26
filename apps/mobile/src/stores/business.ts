import { create } from "zustand";

interface BusinessState {
  businessId: string | null;
  businessName: string | null;
  setBusiness: (id: string, name: string) => void;
  clearBusiness: () => void;
}

export const useBusinessStore = create<BusinessState>((set) => ({
  businessId: null,
  businessName: null,
  setBusiness: (id, name) => set({ businessId: id, businessName: name }),
  clearBusiness: () => set({ businessId: null, businessName: null }),
}));

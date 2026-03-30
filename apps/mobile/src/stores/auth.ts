import { create } from "zustand";
import { getToken, setToken, clearToken } from "../lib/auth";

interface AuthState {
  token: string | null;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  isHydrated: false,
  hydrate: async () => {
    const token = await getToken();
    set({ token, isHydrated: true });
  },
  login: async (token: string) => {
    await setToken(token);
    set({ token });
  },
  logout: async () => {
    await clearToken();
    set({ token: null });
  },
}));

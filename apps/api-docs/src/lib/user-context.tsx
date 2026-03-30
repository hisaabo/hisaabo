import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface UserSession {
  user: { id: string; email: string; name: string | null } | null;
  tenantId: string | null;
  tenantName: string | null;
  role: string | null;
  needsProfile: boolean;
}

interface UserContextValue {
  session: UserSession | null;
  loading: boolean;
  error: boolean;
  businessId: string | null;
  setBusinessId: (id: string | null) => void;
}

const UserContext = createContext<UserContextValue>({
  session: null,
  loading: false,
  error: false,
  businessId: null,
  setBusinessId: () => {},
});

const API_BASE = import.meta.env.VITE_API_URL || "";

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(
    () => localStorage.getItem("api_docs_business_id")
  );

  useEffect(() => {
    // Only attempt auth if an explicit API URL is configured.
    // Without it, the docs are fully static and auth is not needed.
    if (!API_BASE) {
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 3000);

    setLoading(true);

    const sessionToken = localStorage.getItem("api_docs_session_token");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (sessionToken) {
      headers["Authorization"] = `Bearer ${sessionToken}`;
    }

    fetch(`${API_BASE}/api/trpc/auth.me`, {
      headers,
      credentials: "include",
      signal: abortController.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const result = data?.result?.data?.json;
        if (result) {
          setSession(result);
        }
      })
      .catch(() => {
        // Silently ignore — docs work 100% without auth.
        // Auth is only needed for the personalized examples feature (future).
        setError(true);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        setLoading(false);
      });

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, []);

  const handleSetBusinessId = (id: string | null) => {
    setBusinessId(id);
    if (id) {
      localStorage.setItem("api_docs_business_id", id);
    } else {
      localStorage.removeItem("api_docs_business_id");
    }
  };

  return (
    <UserContext.Provider value={{ session, loading, error, businessId, setBusinessId: handleSetBusinessId }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}

import React, { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Persona = "developer" | "agent-builder" | "ca-accountant" | "business-owner" | null;

export interface PersonaInfo {
  id: Exclude<Persona, null>;
  title: string;
  subtitle: string;
  icon: string;
  /** Group IDs to highlight on landing page */
  highlightedGroups: string[];
  /** Section IDs to auto-expand in sidebar */
  prioritySections: string[];
}

export const PERSONAS: PersonaInfo[] = [
  {
    id: "developer",
    title: "Developer",
    subtitle: "Building an integration or custom client",
    icon: "terminal",
    highlightedGroups: ["auth", "businesses", "invoices", "parties", "items", "payments", "api-keys"],
    prioritySections: ["foundation", "commerce"],
  },
  {
    id: "agent-builder",
    title: "AI Agent Builder",
    subtitle: "Connecting via MCP or building autonomous workflows",
    icon: "cpu",
    highlightedGroups: ["auth", "api-keys", "invoices", "dashboard", "reports", "gst", "bank-recon"],
    prioritySections: ["foundation", "analytics", "gst-tax"],
  },
  {
    id: "ca-accountant",
    title: "CA / Accountant",
    subtitle: "Managing clients, GST, and financial statements",
    icon: "calculator",
    highlightedGroups: ["tenant", "businesses", "gst", "itc", "reports", "journals", "accounts", "bank-recon", "gstr2b"],
    prioritySections: ["gst-tax", "accounting", "analytics"],
  },
  {
    id: "business-owner",
    title: "Business Owner",
    subtitle: "Running invoicing, payments, and inventory",
    icon: "store",
    highlightedGroups: ["invoices", "parties", "items", "payments", "expenses", "dashboard", "store", "shipments"],
    prioritySections: ["commerce", "analytics"],
  },
];

interface PersonaContextValue {
  persona: Persona;
  personaInfo: PersonaInfo | null;
  setPersona: (p: Persona) => void;
  clearPersona: () => void;
}

const PersonaContext = createContext<PersonaContextValue>({
  persona: null,
  personaInfo: null,
  setPersona: () => {},
  clearPersona: () => {},
});

const STORAGE_KEY = "hisaabo_docs_persona";

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState<Persona>(
    () => (localStorage.getItem(STORAGE_KEY) as Persona) || null
  );

  const setPersona = useCallback((p: Persona) => {
    setPersonaState(p);
    if (p) {
      localStorage.setItem(STORAGE_KEY, p);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clearPersona = useCallback(() => {
    setPersonaState(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const personaInfo = persona ? PERSONAS.find((p) => p.id === persona) ?? null : null;

  return (
    <PersonaContext.Provider value={{ persona, personaInfo, setPersona, clearPersona }}>
      {children}
    </PersonaContext.Provider>
  );
}

export function usePersona() {
  return useContext(PersonaContext);
}

import { createContext, useContext, useState, useCallback } from "react";
import { BusinessSwitcherSheet } from "../components/BusinessSwitcherSheet";

interface BusinessSwitcherContextType {
  openSwitcher: () => void;
}

const BusinessSwitcherContext = createContext<BusinessSwitcherContextType | null>(null);

export function useBusinessSwitcherContext(): BusinessSwitcherContextType {
  const ctx = useContext(BusinessSwitcherContext);
  if (!ctx) {
    throw new Error("useBusinessSwitcherContext must be used within BusinessSwitcherProvider");
  }
  return ctx;
}

interface BusinessSwitcherProviderProps {
  children: React.ReactNode;
  businesses: Array<{ id: string; name: string }>;
  activeBusinessId: string;
  onSwitch: (id: string, name: string) => void;
  onCreateNew?: () => void;
}

export function BusinessSwitcherProvider({
  children,
  businesses,
  activeBusinessId,
  onSwitch,
  onCreateNew,
}: BusinessSwitcherProviderProps) {
  const [showSwitcher, setShowSwitcher] = useState(false);

  const openSwitcher = useCallback(() => {
    setShowSwitcher(true);
  }, []);

  const handleClose = useCallback(() => {
    setShowSwitcher(false);
  }, []);

  const handleSwitch = useCallback(
    (id: string, name: string) => {
      onSwitch(id, name);
      setShowSwitcher(false);
    },
    [onSwitch],
  );

  const handleCreateNew = useCallback(() => {
    setShowSwitcher(false);
    onCreateNew?.();
  }, [onCreateNew]);

  return (
    <BusinessSwitcherContext.Provider value={{ openSwitcher }}>
      {children}
      <BusinessSwitcherSheet
        visible={showSwitcher}
        onClose={handleClose}
        businesses={businesses}
        activeBusinessId={activeBusinessId}
        onSwitch={handleSwitch}
        onCreateNew={handleCreateNew}
      />
    </BusinessSwitcherContext.Provider>
  );
}

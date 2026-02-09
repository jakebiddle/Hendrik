import type { SettingsTabId } from "@/settings/v2/settingsNavigation";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

interface TabContextType {
  selectedTab: SettingsTabId;
  setSelectedTab: (tab: SettingsTabId) => void;
  modalContainer: HTMLElement | null;
}

interface TabProviderProps {
  children: React.ReactNode;
  initialTab?: SettingsTabId;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

/**
 * Provides tab selection state shared by the settings views.
 */
export const TabProvider: React.FC<TabProviderProps> = ({ children, initialTab = "general" }) => {
  const [selectedTab, setSelectedTab] = useState<SettingsTabId>(initialTab);
  const [modalContainer, setModalContainer] = useState<HTMLElement | null>(null);
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!hasInitialized.current) {
      const modal = document.querySelector(".modal-container") as HTMLElement | null;
      setModalContainer(modal);
      hasInitialized.current = true;
    }
  }, []);

  return (
    <TabContext.Provider value={{ selectedTab, setSelectedTab, modalContainer }}>
      {children}
    </TabContext.Provider>
  );
};

/**
 * Reads the current settings tab context.
 *
 * @returns Tab context state and actions.
 */
export const useTab = (): TabContextType => {
  const context = useContext(TabContext);

  if (context === undefined) {
    throw new Error("useTab must be used within a TabProvider");
  }

  return context;
};

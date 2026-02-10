/**
 * Top-level Hendrik settings tab identifiers.
 */
export type SettingsTabId = "general" | "ai" | "search" | "commands" | "advanced";

let pendingSettingsTab: SettingsTabId | null = null;

/**
 * Stores the next settings tab that should be selected when the settings view mounts.
 *
 * @param tab - Settings tab to open.
 */
export function setPendingSettingsTab(tab: SettingsTabId): void {
  pendingSettingsTab = tab;
}

/**
 * Reads and clears the pending settings tab.
 *
 * @param defaultTab - Fallback tab when no pending tab exists.
 * @returns The pending tab if present; otherwise the provided default.
 */
export function consumePendingSettingsTab(defaultTab: SettingsTabId): SettingsTabId {
  const nextTab = pendingSettingsTab ?? defaultTab;
  pendingSettingsTab = null;
  return nextTab;
}

/**
 * Opens the Hendrik settings tab and optionally targets a specific sub-tab.
 *
 * @param tab - Optional tab that should be selected when settings open.
 */
export function openHendrikSettings(tab?: SettingsTabId): void {
  if (tab) {
    setPendingSettingsTab(tab);
  }

  const settingsApi = (
    app as unknown as {
      setting?: {
        open?: () => void;
        openTabById?: (tabId: string) => { display?: () => void } | void;
      };
    }
  ).setting;

  settingsApi?.open?.();
  if (settingsApi?.openTabById) {
    const openedSettingsTab = settingsApi.openTabById("hendrik");
    openedSettingsTab?.display?.();
    return;
  }

  window.open("obsidian://show-plugin?id=hendrik", "_blank");
}

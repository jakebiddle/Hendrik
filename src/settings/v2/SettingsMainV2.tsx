import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabContent } from "@/components/ui/setting-tabs";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import { cn } from "@/lib/utils";
import HendrikPlugin from "@/main";
import { resetSettings } from "@/settings/model";
import {
  SettingsSearchProvider,
  useSettingsSearch,
} from "@/settings/v2/search/SettingsSearchContext";
import { consumePendingSettingsTab, type SettingsTabId } from "@/settings/v2/settingsNavigation";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import {
  Brain,
  ExternalLink,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Terminal,
} from "lucide-react";
import React, { useEffect } from "react";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { AISettings } from "./components/AISettings";
import { GeneralSettings } from "./components/GeneralSettings";
import { SearchSettings } from "./components/SearchSettings";

interface TabDef {
  id: SettingsTabId;
  label: string;
  icon: React.ReactNode;
  component: React.FC;
}

const tabs: TabDef[] = [
  {
    id: "general",
    label: "General",
    icon: <Settings className="tw-size-4" />,
    component: GeneralSettings,
  },
  {
    id: "ai",
    label: "AI Settings",
    icon: <Brain className="tw-size-4" />,
    component: AISettings,
  },
  {
    id: "search",
    label: "Search",
    icon: <Search className="tw-size-4" />,
    component: SearchSettings,
  },
  {
    id: "commands",
    label: "Commands",
    icon: <Terminal className="tw-size-4" />,
    component: CommandSettings,
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: <SlidersHorizontal className="tw-size-4" />,
    component: AdvancedSettings,
  },
];

interface SidebarNavItemProps {
  tab: TabDef;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Renders a settings tab button for desktop navigation.
 */
const SidebarNavItem: React.FC<SidebarNavItemProps> = ({ tab, isSelected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "hendrik-settings-tab-button",
      "tw-flex tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-border-none tw-px-2.5 tw-py-1.5 tw-text-left tw-text-[13px]",
      isSelected
        ? "is-active tw-font-medium tw-text-[var(--text-on-accent)]"
        : "tw-text-muted hover:tw-text-normal"
    )}
  >
    <span className="tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center">
      {tab.icon}
    </span>
    <span>{tab.label}</span>
  </button>
);

interface SidebarGroupLabelProps {
  label: string;
}

/**
 * Renders desktop tab navigation group label.
 */
const SidebarGroupLabel: React.FC<SidebarGroupLabelProps> = ({ label }) => (
  <div className="tw-px-2.5 tw-pb-1 tw-pt-3 tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-[0.08em] tw-text-faint">
    {label}
  </div>
);

interface MobileNavPillProps {
  tab: TabDef;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Renders mobile tab selector button.
 */
const MobileNavPill: React.FC<MobileNavPillProps> = ({ tab, isSelected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "hendrik-settings-mobile-pill",
      "tw-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-solid tw-px-3 tw-py-1.5 tw-text-xs tw-font-medium",
      "tw-whitespace-nowrap",
      isSelected ? "is-active tw-text-on-accent" : "tw-text-muted hover:tw-text-normal"
    )}
  >
    {tab.icon}
    <span>{tab.label}</span>
  </button>
);

/**
 * Renders settings search row used within each selected tab.
 */
const SettingsSearchRow: React.FC = () => {
  const { query, setQuery } = useSettingsSearch();

  return (
    <div className="setting-item hendrik-settings-search-row">
      <div className="setting-item-info">
        <div className="setting-item-name">Search This Tab</div>
        <div className="setting-item-description">Filter settings in the current section.</div>
      </div>
      <div className="setting-item-control">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type to filter settings"
          className="tw-w-full sm:tw-w-[260px]"
          aria-label="Search settings"
        />
      </div>
    </div>
  );
};

/**
 * Renders the settings tab navigation and selected tab content.
 */
const SettingsContent: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();
  const { setQuery } = useSettingsSearch();

  useEffect(() => {
    setQuery("");
  }, [selectedTab, setQuery]);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 md:tw-flex-row md:tw-gap-8">
      <nav className="hendrik-settings-nav tw-hidden tw-w-44 tw-shrink-0 md:tw-flex md:tw-flex-col md:tw-gap-0.5">
        <SidebarGroupLabel label="Core" />
        {tabs.slice(0, 2).map((tab) => (
          <SidebarNavItem
            key={tab.id}
            tab={tab}
            isSelected={selectedTab === tab.id}
            onClick={() => setSelectedTab(tab.id)}
          />
        ))}
        <SidebarGroupLabel label="Features" />
        {tabs.slice(2).map((tab) => (
          <SidebarNavItem
            key={tab.id}
            tab={tab}
            isSelected={selectedTab === tab.id}
            onClick={() => setSelectedTab(tab.id)}
          />
        ))}
      </nav>

      <nav className="tw-flex tw-gap-2 tw-overflow-x-auto tw-pb-2 md:tw-hidden">
        {tabs.map((tab) => (
          <MobileNavPill
            key={tab.id}
            tab={tab}
            isSelected={selectedTab === tab.id}
            onClick={() => setSelectedTab(tab.id)}
          />
        ))}
      </nav>

      <div className="tw-min-w-0 tw-flex-1">
        <SettingsSearchRow />
        {tabs.map((tab) => {
          const Component = tab.component;
          return (
            <TabContent key={tab.id} id={tab.id} isSelected={selectedTab === tab.id}>
              <Component />
            </TabContent>
          );
        })}
      </div>
    </div>
  );
};

interface SettingsMainV2Props {
  plugin: HendrikPlugin;
}

/**
 * Main Hendrik settings entrypoint.
 */
const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin }) => {
  const [resetKey, setResetKey] = React.useState(0);
  const { latestVersion, hasUpdate } = useLatestVersion(plugin.manifest.version);
  const initialTab = React.useMemo<SettingsTabId>(() => consumePendingSettingsTab("general"), []);

  const logoMaskStyle: React.CSSProperties = {
    backgroundColor: "var(--hendrik-icon-ink)",
    WebkitMaskImage: "var(--hendrik-icon-url)",
    maskImage: "var(--hendrik-icon-url)",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "78%",
    maskSize: "78%",
  };

  /**
   * Resets plugin settings after user confirmation.
   */
  const handleReset = async () => {
    const modal = new ResetSettingsConfirmModal(app, async () => {
      resetSettings();
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  return (
    <TabProvider initialTab={initialTab} key={resetKey}>
      <SettingsSearchProvider>
        <div className="hendrik-plugin-settings tw-space-y-6">
          <div className="hendrik-settings-hero tw-relative tw-overflow-hidden tw-rounded-xl tw-border tw-border-solid tw-p-4">
            <div className="tw-flex tw-flex-col tw-gap-3 sm:tw-flex-row sm:tw-items-center sm:tw-justify-between">
              <div className="tw-flex tw-items-center tw-gap-3">
                <div className="tw-relative tw-size-11 tw-shrink-0 tw-rounded-xl">
                  <div
                    className="tw-absolute tw-inset-0 tw-rounded-xl"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--interactive-accent) 45%, var(--background-primary))",
                      opacity: 0.55,
                    }}
                  />
                  <div
                    className="tw-absolute tw-inset-[2px] tw-rounded-[10px] tw-border"
                    style={{
                      backgroundColor: "var(--hendrik-icon-backdrop)",
                      borderColor: "var(--hendrik-icon-border)",
                    }}
                  />
                  <div
                    className="tw-absolute tw-inset-[2px] tw-rounded-[10px]"
                    style={logoMaskStyle}
                    aria-hidden="true"
                  />
                </div>

                <div className="tw-min-w-0">
                  <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
                    <h1 className="tw-m-0 tw-text-lg tw-font-bold tw-leading-tight tw-text-normal">
                      Hendrik
                    </h1>
                    <span className="tw-rounded-full tw-bg-modifier-hover tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium tw-text-muted">
                      v{plugin.manifest.version}
                    </span>
                    {latestVersion && hasUpdate && (
                      <a
                        href="obsidian://show-plugin?id=hendrik"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tw-rounded-full tw-border tw-border-solid tw-bg-primary tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-semibold tw-text-accent hover:tw-underline"
                      >
                        Update available
                      </a>
                    )}
                  </div>
                  <p className="tw-m-0 tw-mt-1 tw-max-w-[52ch] tw-text-xs tw-leading-relaxed tw-text-muted">
                    Configure providers, models, search, commands, and plugin behavior.
                  </p>
                </div>
              </div>

              <div className="tw-flex tw-items-center tw-gap-2 tw-self-start">
                <a
                  href="https://github.com/jakebiddle/Hendrik"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tw-flex tw-items-center tw-gap-1 tw-rounded-full tw-border tw-border-solid tw-px-2 tw-py-1 tw-text-[10px] tw-font-medium tw-text-muted tw-no-underline tw-transition-colors hover:tw-text-normal"
                  title="View on GitHub"
                >
                  <ExternalLink className="tw-size-3" />
                  GitHub
                </a>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleReset}
                  className="tw-gap-1.5 tw-rounded-full tw-border tw-border-solid"
                >
                  <RotateCcw className="tw-size-3.5" />
                  Reset
                </Button>
              </div>
            </div>
          </div>

          <SettingsContent />
        </div>
      </SettingsSearchProvider>
    </TabProvider>
  );
};

export default SettingsMainV2;

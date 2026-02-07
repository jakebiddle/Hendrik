import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent } from "@/components/ui/setting-tabs";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import { cn } from "@/lib/utils";
import HendrikPlugin from "@/main";
import { resetSettings } from "@/settings/model";
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
import React from "react";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { AISettings } from "./components/AISettings";
import { GeneralSettings } from "./components/GeneralSettings";
import { SearchSettings } from "./components/SearchSettings";

type TabId = "general" | "ai" | "search" | "commands" | "advanced";

interface TabDef {
  id: TabId;
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

/** Sidebar navigation item */
const SidebarNavItem: React.FC<{
  tab: TabDef;
  isSelected: boolean;
  onClick: () => void;
}> = ({ tab, isSelected, onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      "tw-flex tw-w-full tw-items-center tw-gap-2",
      "tw-rounded-md tw-px-2.5 tw-py-1.5",
      "tw-text-left tw-text-[13px]",
      "tw-border-none",
      "tw-cursor-pointer",
      "tw-transition-all tw-duration-150",
      isSelected
        ? "tw-bg-[var(--interactive-accent)] tw-font-medium tw-text-[var(--text-on-accent)]"
        : "tw-bg-transparent tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
    )}
  >
    <span className="tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center">
      {tab.icon}
    </span>
    <span>{tab.label}</span>
  </button>
);

/** Sidebar section label for grouping tabs */
const SidebarGroupLabel: React.FC<{ label: string }> = ({ label }) => (
  <div className="tw-px-2.5 tw-pb-1 tw-pt-3 tw-text-[10px] tw-font-semibold tw-uppercase tw-tracking-[0.08em] tw-text-faint">
    {label}
  </div>
);

/** Mobile horizontal pill navigation item */
const MobileNavPill: React.FC<{
  tab: TabDef;
  isSelected: boolean;
  onClick: () => void;
}> = ({ tab, isSelected, onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      "tw-flex tw-items-center tw-gap-1.5",
      "tw-rounded-full tw-px-3 tw-py-1.5",
      "tw-whitespace-nowrap tw-text-xs tw-font-medium",
      "tw-border tw-border-solid tw-border-border",
      "tw-cursor-pointer",
      "tw-transition-all tw-duration-150",
      isSelected
        ? "!tw-border-[var(--interactive-accent)] !tw-bg-interactive-accent tw-text-on-accent"
        : "tw-bg-primary tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
    )}
  >
    {tab.icon}
    <span>{tab.label}</span>
  </button>
);

const SettingsContent: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 md:tw-flex-row md:tw-gap-8">
      {/* Sidebar Navigation (desktop) */}
      <nav className="tw-hidden tw-w-36 tw-shrink-0 md:tw-flex md:tw-flex-col md:tw-gap-0.5">
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

      {/* Mobile Navigation (horizontal pills) */}
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

      {/* Content Area */}
      <div className="tw-min-w-0 tw-flex-1">
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

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin }) => {
  const [resetKey, setResetKey] = React.useState(0);
  const { latestVersion, hasUpdate } = useLatestVersion(plugin.manifest.version);
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

  const handleReset = async () => {
    const modal = new ResetSettingsConfirmModal(app, async () => {
      resetSettings();
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  return (
    <TabProvider>
      <div className="tw-space-y-6">
        {/* App Header */}
        <div
          className="tw-relative tw-overflow-hidden tw-rounded-xl tw-border tw-border-solid tw-p-4"
          style={{
            background:
              "linear-gradient(155deg, color-mix(in srgb, var(--interactive-accent) 12%, transparent), color-mix(in srgb, var(--background-primary) 96%, transparent) 55%)",
            borderColor: `color-mix(in srgb, var(--interactive-accent) 18%, var(--hendrik-border-soft))`,
          }}
        >
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
                      className="tw-border-accent tw-rounded-full tw-border tw-border-solid tw-bg-primary tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-semibold tw-text-accent hover:tw-underline"
                    >
                      Update available
                    </a>
                  )}
                </div>
                <p className="tw-m-0 tw-mt-1 tw-max-w-[48ch] tw-text-xs tw-leading-relaxed tw-text-muted">
                  Your personal AI archivist. Configure providers, search, commands, and
                  preferences.
                </p>
              </div>
            </div>

            <div className="tw-flex tw-items-center tw-gap-2 tw-self-start">
              <a
                href="https://github.com/jakebiddle/Hendrik"
                target="_blank"
                rel="noopener noreferrer"
                className="tw-flex tw-items-center tw-gap-1 tw-rounded-full tw-border tw-border-solid tw-px-2 tw-py-1 tw-text-[10px] tw-font-medium tw-text-muted tw-no-underline tw-transition-colors hover:tw-text-normal"
                style={{ borderColor: "var(--hendrik-border-soft)" }}
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
                style={{ borderColor: "var(--hendrik-border-soft)" }}
              >
                <RotateCcw className="tw-size-3.5" />
                Reset
              </Button>
            </div>
          </div>
        </div>

        {/* Settings content with sidebar */}
        <SettingsContent key={resetKey} />
      </div>
    </TabProvider>
  );
};

export default SettingsMainV2;

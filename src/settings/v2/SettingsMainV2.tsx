import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent } from "@/components/ui/setting-tabs";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import { cn } from "@/lib/utils";
import CopilotPlugin from "@/main";
import { resetSettings } from "@/settings/model";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import { Brain, RotateCcw, Search, Settings, SlidersHorizontal, Terminal } from "lucide-react";
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
        {tabs.map((tab) => (
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
  plugin: CopilotPlugin;
}

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin }) => {
  const [resetKey, setResetKey] = React.useState(0);
  const { latestVersion, hasUpdate } = useLatestVersion(plugin.manifest.version);
  const logoMaskStyle: React.CSSProperties = {
    backgroundColor: "var(--copilot-icon-ink)",
    WebkitMaskImage: "var(--copilot-icon-url)",
    maskImage: "var(--copilot-icon-url)",
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
          className="tw-relative tw-overflow-hidden tw-rounded-xl tw-border tw-border-border tw-p-4 md:tw-p-5"
          style={{
            background:
              "radial-gradient(120% 130% at 0% 0%, color-mix(in srgb, var(--interactive-accent) 18%, var(--background-primary)) 0%, var(--background-primary) 62%)",
          }}
        >
          <div className="tw-pointer-events-none tw-absolute tw-inset-0 tw-opacity-50">
            <div
              className="tw-absolute tw--right-10 tw-top-[-52px] tw-size-36 tw-rounded-full"
              style={{
                backgroundColor: "color-mix(in srgb, var(--interactive-accent) 22%, transparent)",
                filter: "blur(22px)",
              }}
            />
            <div
              className="tw-absolute tw-bottom-[-58px] tw-left-8 tw-size-32 tw-rounded-full"
              style={{
                backgroundColor: "color-mix(in srgb, var(--interactive-accent) 14%, transparent)",
                filter: "blur(24px)",
              }}
            />
          </div>

          <div className="tw-relative tw-flex tw-flex-col tw-gap-4 sm:tw-flex-row sm:tw-items-start sm:tw-justify-between">
            <div className="tw-flex tw-items-start tw-gap-3">
              <div className="tw-relative tw-size-14 tw-shrink-0 tw-rounded-xl">
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
                    backgroundColor: "var(--copilot-icon-backdrop)",
                    borderColor: "var(--copilot-icon-border)",
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
                  <h1 className="tw-text-xl tw-font-bold tw-leading-tight tw-text-normal">
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
                      className="tw-rounded-full tw-border tw-border-border tw-bg-primary tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-semibold tw-text-accent hover:tw-underline"
                    >
                      Update available
                    </a>
                  )}
                </div>
                <p className="tw-mt-3 tw-max-w-[52ch] tw-text-sm tw-font-semibold tw-leading-relaxed tw-text-normal">
                  Hendrik - Your Personal AI Obsidian Archivist. Search, organize, and chat with
                  your vault.
                </p>
                <p className="tw-mt-2 tw-max-w-[52ch] tw-text-xs tw-leading-relaxed tw-text-muted">
                  Configure AI providers, vector search, custom commands, and advanced options to
                  customize your AI experience.
                </p>
                <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
                  <span className="tw-rounded-full tw-border tw-border-border tw-bg-modifier-hover tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium tw-text-muted">
                    Obsidian Settings
                  </span>
                  <span className="tw-rounded-full tw-border tw-border-border tw-bg-modifier-hover tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-medium tw-text-muted">
                    {tabs.length} https://github.com/jakebiddle/Hendrik
                  </span>
                </div>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleReset}
              className="tw-gap-1.5 tw-self-start tw-rounded-full tw-border tw-border-border"
            >
              <RotateCcw className="tw-size-3.5" />
              Reset
            </Button>
          </div>
        </div>

        {/* Separator */}
        <div className="tw-h-px tw-bg-[var(--background-modifier-border)]" />

        {/* Settings content with sidebar */}
        <SettingsContent key={resetKey} />
      </div>
    </TabProvider>
  );
};

export default SettingsMainV2;

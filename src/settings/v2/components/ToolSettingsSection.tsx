import React from "react";
import { SettingItem } from "@/components/ui/setting-item";
import { AGENT_MAX_ITERATIONS_LIMIT } from "@/constants";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { useSettingsSearch } from "@/settings/v2/search/SettingsSearchContext";

interface ToolSettingsSectionProps {
  /** Optional active filter query from parent section. */
  filterQuery?: string;
}

export const ToolSettingsSection: React.FC<ToolSettingsSectionProps> = ({ filterQuery }) => {
  const settings = useSettingsValue();
  const registry = ToolRegistry.getInstance();
  const { matches } = useSettingsSearch();

  const enabledToolIds = new Set(settings.autonomousAgentEnabledToolIds || []);
  const normalizedFilterQuery = (filterQuery || "").trim().toLowerCase();

  // Get configurable tools grouped by category
  const toolsByCategory = registry.getToolsByCategory();
  const configurableTools = registry.getConfigurableTools();

  const handleToolToggle = (toolId: string, enabled: boolean) => {
    const newEnabledIds = new Set(enabledToolIds);
    if (enabled) {
      newEnabledIds.add(toolId);
    } else {
      newEnabledIds.delete(toolId);
    }

    updateSetting("autonomousAgentEnabledToolIds", Array.from(newEnabledIds));
  };

  const renderToolsByCategory = () => {
    const categories = Array.from(toolsByCategory.entries()).filter(([_, tools]) =>
      tools.some((t) => configurableTools.includes(t))
    );

    return categories.map(([category, tools]) => {
      const configurableInCategory = tools
        .filter((t) => configurableTools.includes(t))
        .filter(({ metadata }) => {
          if (!normalizedFilterQuery) {
            return true;
          }

          return matches([metadata.displayName, metadata.description, category]);
        });

      if (configurableInCategory.length === 0) return null;

      return (
        <React.Fragment key={category}>
          {configurableInCategory.map(({ metadata }) => (
            <SettingItem
              key={metadata.id}
              type="switch"
              title={metadata.displayName}
              description={metadata.description}
              checked={enabledToolIds.has(metadata.id)}
              onCheckedChange={(checked) => handleToolToggle(metadata.id, checked)}
            />
          ))}
        </React.Fragment>
      );
    });
  };

  const visibleToolsCount = Array.from(toolsByCategory.values())
    .flatMap((tools) => tools.filter((t) => configurableTools.includes(t)))
    .filter(({ metadata }) => {
      if (!normalizedFilterQuery) {
        return true;
      }
      return matches([metadata.displayName, metadata.description]);
    }).length;

  return (
    <>
      <SettingItem
        type="slider"
        title="Max Iterations"
        description="Maximum number of reasoning iterations the autonomous agent can perform. Higher values allow for more complex reasoning but may take longer."
        value={settings.autonomousAgentMaxIterations ?? 8}
        onChange={(value) => {
          updateSetting("autonomousAgentMaxIterations", value);
        }}
        min={1}
        max={AGENT_MAX_ITERATIONS_LIMIT}
        step={1}
      />

      <div className="tw-mt-4 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-p-3">
        <div className="tw-mb-2 tw-text-sm tw-font-medium">Agent Accessible Tools</div>
        <div className="tw-mb-4 tw-text-xs tw-text-muted">
          Toggle which tools the autonomous agent can use
        </div>

        <div className="tw-flex tw-flex-col tw-gap-2">
          {renderToolsByCategory()}
          {normalizedFilterQuery && visibleToolsCount === 0 && (
            <div className="tw-text-xs tw-text-muted">No tools match the current search.</div>
          )}
          {normalizedFilterQuery && visibleToolsCount > 0 && (
            <div className="tw-text-xs tw-text-muted">Only matching tools are shown.</div>
          )}
        </div>
      </div>
    </>
  );
};

import { ChainType } from "@/chainFactory";
import { CustomModel } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { getModelDisplayWithIcons } from "@/components/ui/model-display";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { SettingItem } from "@/components/ui/setting-item";
import { BUILTIN_CHAT_MODELS } from "@/constants";
import ProjectManager from "@/LLMProviders/projectManager";
import { logError } from "@/logger";
import {
  HendrikSettings,
  getModelKeyFromModel,
  setSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { ModelAddDialog } from "@/settings/v2/components/ModelAddDialog";
import { ModelEditModal } from "@/settings/v2/components/ModelEditDialog";
import { ModelTable } from "@/settings/v2/components/ModelTable";
import { SettingsSection } from "@/settings/v2/components/SettingsSection";
import { StatusIndicator } from "@/settings/v2/components/StatusIndicator";
import { ToolSettingsSection } from "@/settings/v2/components/ToolSettingsSection";
import { useSettingsSearch } from "@/settings/v2/search/SettingsSearchContext";
import { checkModelApiKey, omit } from "@/utils";
import { getApiKeyForProvider } from "@/utils/modelUtils";
import { getNeedSetKeyProvider } from "@/utils";
import { SettingKeyProviders } from "@/constants";
import { getPromptFilePath, SystemPromptAddModal } from "@/system-prompts";
import { useSystemPrompts } from "@/system-prompts/state";
import { ArrowUpRight, Bot, FileText, Key, Layers, MessageCircle, Plus } from "lucide-react";
import { Notice } from "obsidian";
import React, { useState } from "react";
import { ApiKeyDialog } from "./ApiKeyDialog";
import { useTab } from "@/contexts/TabContext";

const ChainType2Label: Partial<Record<ChainType, string>> = {
  [ChainType.TOOL_CALLING_CHAIN]: "Hendrik",
  [ChainType.PROJECT_CHAIN]: "Projects (alpha)",
};

export const AISettings: React.FC = () => {
  const settings = useSettingsValue();
  const { setSelectedTab } = useTab();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const prompts = useSystemPrompts();
  const { normalizedQuery } = useSettingsSearch();

  // API key status calculation
  const providers = getNeedSetKeyProvider().map((p) => p as SettingKeyProviders);
  const configuredCount = providers.filter((p) => !!getApiKeyForProvider(p)).length;
  const totalProviders = providers.length;

  // Default model state
  const defaultModelActivated = !!settings.activeModels.find(
    (m) => m.enabled && getModelKeyFromModel(m) === settings.defaultModelKey
  );
  const enableActivatedModels = settings.activeModels
    .filter((m) => m.enabled)
    .map((model) => ({
      label: getModelDisplayWithIcons(model),
      value: getModelKeyFromModel(model),
    }));

  // System prompt state
  const defaultPromptExists = prompts.some(
    (prompt) => prompt.title === settings.defaultSystemPromptTitle
  );
  const displayValue = defaultPromptExists ? settings.defaultSystemPromptTitle : "";

  // Model handlers
  const onCopyModel = (model: CustomModel) => {
    const newModel: CustomModel = {
      ...omit(model, [
        "isBuiltIn",
        "core",
        "projectEnabled",
        "capabilities",
        "displayName",
        "dimensions",
      ]),
      name: `${model.name} (copy)`,
    };
    updateSetting("activeModels", [...settings.activeModels, newModel]);
  };

  const handleModelReorder = (newModels: CustomModel[]) => {
    updateSetting("activeModels", newModels);
  };

  const onDeleteModel = (modelKey: string) => {
    const [modelName, provider] = modelKey.split("|");
    const updatedActiveModels = settings.activeModels.filter(
      (model) => !(model.name === modelName && model.provider === provider)
    );

    let newDefaultModelKey = settings.defaultModelKey;
    if (modelKey === settings.defaultModelKey) {
      const newDefaultModel = updatedActiveModels.find((model) => model.enabled);
      newDefaultModelKey = newDefaultModel
        ? `${newDefaultModel.name}|${newDefaultModel.provider}`
        : "";
    }

    setSettings({
      activeModels: updatedActiveModels,
      defaultModelKey: newDefaultModelKey,
    });
  };

  const handleModelUpdate = (
    isEmbeddingModel: boolean,
    originalModel: CustomModel,
    updatedModel: CustomModel
  ) => {
    const settingField: keyof HendrikSettings = isEmbeddingModel
      ? "activeEmbeddingModels"
      : "activeModels";

    const modelIndex = settings[settingField].findIndex(
      (m) => m.name === originalModel.name && m.provider === originalModel.provider
    );
    if (modelIndex !== -1) {
      const updatedModels = [...settings[settingField]];
      updatedModels[modelIndex] = updatedModel;
      updateSetting(settingField, updatedModels);
    } else {
      new Notice("Could not find model to update");
      logError("Could not find model to update:", originalModel);
    }
  };

  const handleTableUpdate = (updatedModel: CustomModel) => {
    const updatedModels = settings.activeModels.map((m) =>
      m.name === updatedModel.name && m.provider === updatedModel.provider ? updatedModel : m
    );
    updateSetting("activeModels", updatedModels);
  };

  const handleEditModel = (model: CustomModel) => {
    const modal = new ModelEditModal(app, model, false, handleModelUpdate);
    modal.open();
  };

  const handleRefreshChatModels = () => {
    const customModels = settings.activeModels.filter((model) => !model.isBuiltIn);
    const updatedModels = [...BUILTIN_CHAT_MODELS, ...customModels];
    updateSetting("activeModels", updatedModels);
    new Notice("Chat models refreshed successfully");
  };

  return (
    <div className="tw-space-y-6">
      {/* API Keys & Providers */}
      <SettingsSection
        icon={<Key className="tw-size-4" />}
        title="API Keys & Providers"
        description="Configure provider credentials and service access."
        accentColor="var(--color-orange)"
        searchTerms={["API Keys", "providers", "credentials", "Set Keys"]}
        badge={
          <StatusIndicator
            status={configuredCount > 0 ? "active" : "inactive"}
            label={`${configuredCount} of ${totalProviders} configured`}
          />
        }
      >
        <SettingItem
          type="custom"
          title="API Keys"
          description={
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-leading-none">Configure API keys for different AI providers</span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                    <div className="tw-text-sm tw-font-medium tw-text-accent">
                      API key required for chat and search features
                    </div>
                    <div className="tw-text-xs tw-text-muted">
                      To enable chat and search functionality, please provide an API key from your
                      selected provider.
                    </div>
                  </div>
                }
              />
            </div>
          }
        >
          <Button
            onClick={() => {
              new ApiKeyDialog(app, () => setSelectedTab("ai")).open();
            }}
            variant="secondary"
            className="tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 sm:tw-w-auto sm:tw-justify-start"
          >
            Set Keys
            <Key className="tw-size-4" />
          </Button>
        </SettingItem>
      </SettingsSection>

      {/* Chat Models */}
      <SettingsSection
        icon={<MessageCircle className="tw-size-4" />}
        title="Chat Models"
        description="Manage chat models and default model selection."
        accentColor="var(--color-blue)"
        searchTerms={[
          "Chat Models",
          "Default Chat Model",
          "Default Mode",
          ...settings.activeModels.map((model) => model.name),
        ]}
      >
        <ModelTable
          models={settings.activeModels}
          onEdit={(model) => handleEditModel(model)}
          onCopy={(model) => onCopyModel(model)}
          onDelete={onDeleteModel}
          onAdd={() => setShowAddDialog(true)}
          onUpdateModel={handleTableUpdate}
          onReorderModels={(newModels) => handleModelReorder(newModels)}
          onRefresh={handleRefreshChatModels}
          title="Chat Models"
          filterQuery={normalizedQuery}
        />

        <ModelAddDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          onAdd={(model) => {
            const updatedModels = [...settings.activeModels, model];
            updateSetting("activeModels", updatedModels);
          }}
          ping={(model) =>
            ProjectManager.instance.getCurrentChainManager().chatModelManager.ping(model)
          }
        />

        <SettingItem
          type="select"
          title="Default Chat Model"
          description={
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-leading-none">Select the Chat model to use</span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                    <div className="tw-text-sm tw-font-medium tw-text-accent">
                      Default model is OpenRouter Gemini 2.5 Flash
                    </div>
                    <div className="tw-text-xs tw-text-muted">
                      Set your OpenRouter API key in &apos;API keys&apos; to use this model, or
                      select a different model from another provider.
                    </div>
                  </div>
                }
              />
            </div>
          }
          value={defaultModelActivated ? settings.defaultModelKey : "Select Model"}
          onChange={(value) => {
            const selectedModel = settings.activeModels.find(
              (m) => m.enabled && getModelKeyFromModel(m) === value
            );
            if (!selectedModel) return;

            const { hasApiKey, errorNotice } = checkModelApiKey(selectedModel, settings);
            if (!hasApiKey && errorNotice) {
              // Keep selection allowed; error will surface in chat on send
            }
            updateSetting("defaultModelKey", value);
          }}
          options={
            defaultModelActivated
              ? enableActivatedModels
              : [{ label: "Select Model", value: "Select Model" }, ...enableActivatedModels]
          }
          placeholder="Model"
        />

        <SettingItem
          type="select"
          title="Default Mode"
          description={
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-leading-none">Select the default chat mode</span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2">
                    <ul className="tw-pl-4 tw-text-sm tw-text-muted">
                      <li>
                        <strong>Hendrik:</strong> Full-featured AI assistant with chat, vault
                        search, advanced context processing, AI agents, and more.
                      </li>
                    </ul>
                  </div>
                }
              />
            </div>
          }
          value={settings.defaultChainType}
          onChange={(value) => updateSetting("defaultChainType", value as ChainType)}
          options={Object.entries(ChainType2Label).map(([key, value]) => ({
            label: value,
            value: key,
          }))}
        />
      </SettingsSection>

      {/* Context Management */}
      <SettingsSection
        icon={<Layers className="tw-size-4" />}
        title="Context Management"
        description="Configure conversation context window and compaction behavior."
        accentColor="var(--color-cyan)"
        collapsible
        defaultOpen={false}
        searchTerms={[
          "Enable auto-compaction",
          "Conversation turns in context",
          "Auto-compact threshold",
          "Compaction summary length",
          "Default context window",
          "Context pressure indicator",
        ]}
      >
        <SettingItem
          type="switch"
          title="Enable auto-compaction"
          description="Automatically summarize chat history when context grows too large."
          checked={settings.enableAutoCompaction}
          onCheckedChange={(checked: boolean) => updateSetting("enableAutoCompaction", checked)}
        />
        <SettingItem
          type="slider"
          title="Conversation turns in context"
          description="The number of previous conversation turns to include in the context. Default is 15 turns, i.e. 30 messages."
          value={settings.contextTurns}
          onChange={(value) => updateSetting("contextTurns", value)}
          min={1}
          max={50}
          step={1}
        />
        <SettingItem
          type="slider"
          title="Auto-compact threshold"
          description="Automatically summarize context when it exceeds this token count."
          min={64000}
          max={1000000}
          step={64000}
          value={settings.autoCompactThreshold}
          onChange={(value) => updateSetting("autoCompactThreshold", value)}
        />
        <SettingItem
          type="slider"
          title="Compaction summary length"
          description="Target token budget for compaction summaries."
          min={256}
          max={16000}
          step={256}
          value={settings.autoCompactSummaryTokens}
          onChange={(value) => updateSetting("autoCompactSummaryTokens", value)}
        />
        <SettingItem
          type="slider"
          title="Default context window"
          description="Fallback context window size when a model does not define its own limit."
          min={8000}
          max={1000000}
          step={1000}
          value={settings.defaultMaxContextTokens}
          onChange={(value) => updateSetting("defaultMaxContextTokens", value)}
        />
        <SettingItem
          type="switch"
          title="Context pressure indicator"
          description="Show usage vs. context window in the chat header."
          checked={settings.showContextPressureIndicator}
          onCheckedChange={(checked: boolean) =>
            updateSetting("showContextPressureIndicator", checked)
          }
        />
      </SettingsSection>

      {/* System Prompts */}
      <SettingsSection
        icon={<FileText className="tw-size-4" />}
        title="System Prompts"
        description="Configure default system prompt behavior."
        accentColor="var(--color-purple)"
        searchTerms={[
          "Default System Prompt",
          "System Prompts Folder Name",
          ...prompts.map((p) => p.title),
        ]}
      >
        <SettingItem
          type="custom"
          title="Default System Prompt"
          description="Customize the system prompt for all messages, may result in unexpected behavior!"
        >
          <div className="tw-flex tw-items-center tw-gap-2">
            <ObsidianNativeSelect
              value={displayValue}
              onChange={(e) => {
                const value = e.target.value;
                if (!value) return;
                updateSetting("defaultSystemPromptTitle", value);
              }}
              options={prompts.map((prompt) => ({
                label:
                  prompt.title === settings.defaultSystemPromptTitle
                    ? `${prompt.title} (Default)`
                    : prompt.title,
                value: prompt.title,
              }))}
              placeholder="Select system prompt"
              containerClassName="tw-flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (!displayValue) return;
                const filePath = getPromptFilePath(displayValue);
                (app as any).setting.close();
                app.workspace.openLinkText(filePath, "", true);
              }}
              className="tw-size-5 tw-shrink-0 tw-p-0"
              title="Open the source file"
              disabled={!displayValue}
            >
              <ArrowUpRight className="tw-size-5" />
            </Button>
            <Button
              variant="default"
              size="icon"
              onClick={() => {
                const modal = new SystemPromptAddModal(app, prompts);
                modal.open();
              }}
              title="Add new prompt"
            >
              <Plus className="tw-size-4" />
            </Button>
          </div>
        </SettingItem>

        <SettingItem
          type="text"
          title="System Prompts Folder Name"
          description="Folder where system prompts are stored."
          value={settings.userSystemPromptsFolder}
          onChange={(value) => updateSetting("userSystemPromptsFolder", value)}
          placeholder="hendrik/system-prompts"
        />
      </SettingsSection>

      {/* Agent & Tools */}
      <SettingsSection
        icon={<Bot className="tw-size-4" />}
        title="Agent & Tools"
        description="Configure autonomous agent limits and tool access."
        accentColor="var(--color-green)"
        collapsible
        defaultOpen={false}
        searchTerms={["Max Iterations", "Agent Accessible Tools", "tool", "autonomous agent"]}
      >
        <ToolSettingsSection filterQuery={normalizedQuery} />
      </SettingsSection>
    </div>
  );
};

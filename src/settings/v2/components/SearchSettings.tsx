import React, { useState } from "react";

import { CustomModel } from "@/aiParams";
import { RebuildIndexConfirmModal } from "@/components/modals/RebuildIndexConfirmModal";
import { SemanticSearchToggleModal } from "@/components/modals/SemanticSearchToggleModal";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { getModelDisplayWithIcons } from "@/components/ui/model-display";
import { SettingItem } from "@/components/ui/setting-item";
import { BUILTIN_EMBEDDING_MODELS, VAULT_VECTOR_STORE_STRATEGIES } from "@/constants";
import EmbeddingManager from "@/LLMProviders/embeddingManager";
import { logError } from "@/logger";
import {
  HendrikSettings,
  getModelKeyFromModel,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { ModelAddDialog } from "@/settings/v2/components/ModelAddDialog";
import { ModelEditModal } from "@/settings/v2/components/ModelEditDialog";
import { ModelTable } from "@/settings/v2/components/ModelTable";
import { PatternListEditor } from "@/settings/v2/components/PatternListEditor";
import { SettingsSection } from "@/settings/v2/components/SettingsSection";
import { SmartConnectionsStatus } from "@/settings/v2/components/SmartConnectionsStatus";
import { useSettingsSearch } from "@/settings/v2/search/SettingsSearchContext";
import { omit } from "@/utils";
import { Cpu, FolderTree, Gauge, HardDrive, Scan, SlidersHorizontal } from "lucide-react";
import { Notice } from "obsidian";

export const SearchSettings: React.FC = () => {
  const settings = useSettingsValue();
  const [showAddEmbeddingDialog, setShowAddEmbeddingDialog] = useState(false);
  const { normalizedQuery } = useSettingsSearch();

  const handleSetDefaultEmbeddingModel = async (modelKey: string) => {
    if (modelKey === settings.embeddingModelKey) return;

    if (settings.enableSemanticSearchV3) {
      new RebuildIndexConfirmModal(app, async () => {
        updateSetting("embeddingModelKey", modelKey);
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        await VectorStoreManager.getInstance().indexVaultToVectorStore(false);
      }).open();
      return;
    }

    updateSetting("embeddingModelKey", modelKey);
    new Notice("Embedding model saved. Enable Semantic Search to build the index.");
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

  const onDeleteEmbeddingModel = (modelKey: string) => {
    const [modelName, provider] = modelKey.split("|");
    const updatedModels = settings.activeEmbeddingModels.filter(
      (model) => !(model.name === modelName && model.provider === provider)
    );
    updateSetting("activeEmbeddingModels", updatedModels);
  };

  const handleEmbeddingModelUpdate = (updatedModel: CustomModel) => {
    const updatedModels = settings.activeEmbeddingModels.map((m) =>
      m.name === updatedModel.name && m.provider === updatedModel.provider ? updatedModel : m
    );
    updateSetting("activeEmbeddingModels", updatedModels);
  };

  const onCopyEmbeddingModel = (model: CustomModel) => {
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
    updateSetting("activeEmbeddingModels", [...settings.activeEmbeddingModels, newModel]);
  };

  const handleRefreshEmbeddingModels = () => {
    const customModels = settings.activeEmbeddingModels.filter((model) => !model.isBuiltIn);
    const updatedModels = [...BUILTIN_EMBEDDING_MODELS, ...customModels];
    updateSetting("activeEmbeddingModels", updatedModels);
    new Notice("Embedding models refreshed successfully");
  };

  const handleEditEmbeddingModel = (model: CustomModel) => {
    const modal = new ModelEditModal(app, model, true, handleModelUpdate);
    modal.open();
  };

  return (
    <div className="tw-space-y-6">
      {/* Search Provider */}
      <SettingsSection
        icon={<Scan className="tw-size-4" />}
        title="Search Provider"
        description="Choose how Hendrik retrieves source notes."
        accentColor="var(--color-blue)"
        searchTerms={[
          "Use Smart Connections",
          "Enable Semantic Search",
          "Enable Inline Citations",
          "Smart Connections",
        ]}
      >
        <SettingItem
          type="switch"
          title="Use Smart Connections"
          description="When enabled, delegates semantic search to the Smart Connections plugin instead of using the built-in embedding system. Takes priority over built-in semantic search."
          checked={settings.useSmartConnections}
          onCheckedChange={(checked) => updateSetting("useSmartConnections", checked)}
        />

        <SmartConnectionsStatus enabled={settings.useSmartConnections} />

        {!settings.useSmartConnections && (
          <SettingItem
            type="switch"
            title="Enable Semantic Search"
            description="Enable semantic search for meaning-based document retrieval. When disabled, uses fast lexical search only."
            checked={settings.enableSemanticSearchV3}
            onCheckedChange={(checked) => {
              new SemanticSearchToggleModal(
                app,
                async () => {
                  updateSetting("enableSemanticSearchV3", checked);
                  if (checked) {
                    const VectorStoreManager = (await import("@/search/vectorStoreManager"))
                      .default;
                    await VectorStoreManager.getInstance().indexVaultToVectorStore(false);
                  }
                },
                checked
              ).open();
            }}
          />
        )}

        <SettingItem
          type="switch"
          title="Enable Inline Citations (experimental)"
          description="AI responses will include footnote-style citations within the text and numbered sources at the end."
          checked={settings.enableInlineCitations}
          onCheckedChange={(checked) => updateSetting("enableInlineCitations", checked)}
        />
      </SettingsSection>

      {/* Embedding Configuration */}
      {!settings.useSmartConnections && (
        <SettingsSection
          icon={<Cpu className="tw-size-4" />}
          title="Embedding Configuration"
          description="Configure embedding models and indexing behavior."
          accentColor="var(--color-orange)"
          searchTerms={[
            "Embedding Models",
            "Embedding Model",
            "Auto-Index Strategy",
            ...settings.activeEmbeddingModels.map((model) => model.name),
          ]}
        >
          <ModelTable
            models={settings.activeEmbeddingModels}
            onEdit={(model) => handleEditEmbeddingModel(model)}
            onDelete={onDeleteEmbeddingModel}
            onCopy={(model) => onCopyEmbeddingModel(model)}
            onAdd={() => setShowAddEmbeddingDialog(true)}
            onUpdateModel={handleEmbeddingModelUpdate}
            onReorderModels={(newModels) => updateSetting("activeEmbeddingModels", newModels)}
            onRefresh={handleRefreshEmbeddingModels}
            title="Embedding Models"
            filterQuery={normalizedQuery}
          />

          <ModelAddDialog
            open={showAddEmbeddingDialog}
            onOpenChange={setShowAddEmbeddingDialog}
            onAdd={(model) => {
              const updatedModels = [...settings.activeEmbeddingModels, model];
              updateSetting("activeEmbeddingModels", updatedModels);
            }}
            isEmbeddingModel={true}
            ping={(model) => EmbeddingManager.getInstance().ping(model)}
          />

          <SettingItem
            type="select"
            title="Embedding Model"
            description={
              <div className="tw-space-y-2">
                <div className="tw-flex tw-items-center tw-gap-1.5">
                  <span className="tw-font-medium tw-leading-none tw-text-accent">
                    Powers Semantic Vault Search and Relevant Notes.
                  </span>
                  <HelpTooltip
                    content={
                      <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2">
                        <div className="tw-pt-2 tw-text-sm tw-text-muted">
                          This model converts text into vector representations. Changing the
                          embedding model will require rebuilding your vault&#39;s vector index.
                        </div>
                      </div>
                    }
                  />
                </div>
              </div>
            }
            value={settings.embeddingModelKey}
            onChange={handleSetDefaultEmbeddingModel}
            options={settings.activeEmbeddingModels.map((model) => ({
              label: getModelDisplayWithIcons(model),
              value: getModelKeyFromModel(model),
            }))}
            placeholder="Model"
          />

          <SettingItem
            type="select"
            title="Auto-Index Strategy"
            description={
              <div className="tw-flex tw-items-center tw-gap-1.5">
                <span className="tw-leading-none">
                  Decide when you want the vault to be indexed.
                </span>
                <HelpTooltip
                  content={
                    <div className="tw-space-y-2 tw-py-2">
                      <ul className="tw-list-disc tw-space-y-1 tw-pl-2 tw-text-sm">
                        <li>
                          <strong>NEVER:</strong> Manual indexing via command or refresh only
                        </li>
                        <li>
                          <strong>ON STARTUP:</strong> Index updates when plugin loads
                        </li>
                        <li>
                          <strong>ON MODE SWITCH:</strong> Updates when entering QA mode
                          (Recommended)
                        </li>
                      </ul>
                      <p className="tw-text-sm tw-text-callout-warning">
                        Warning: Cost implications for large vaults with paid models
                      </p>
                    </div>
                  }
                />
              </div>
            }
            value={settings.indexVaultToVectorStore}
            onChange={(value) => updateSetting("indexVaultToVectorStore", value)}
            options={VAULT_VECTOR_STORE_STRATEGIES.map((strategy) => ({
              label: strategy,
              value: strategy,
            }))}
            placeholder="Strategy"
          />
        </SettingsSection>
      )}

      {/* Search Tuning */}
      <SettingsSection
        icon={<SlidersHorizontal className="tw-size-4" />}
        title="Search Tuning"
        description="Adjust retrieval ranking behavior."
        accentColor="var(--color-purple)"
        searchTerms={["Max Sources", "Enable Folder and Graph Boosts"]}
      >
        <SettingItem
          type="slider"
          title="Max Sources"
          description="Hendrik finds relevant notes and passes the top N to the LLM. Default is 15."
          min={1}
          max={128}
          step={1}
          value={settings.maxSourceChunks}
          onChange={(value) => updateSetting("maxSourceChunks", value)}
        />

        {!settings.useSmartConnections && (
          <SettingItem
            type="switch"
            title="Enable Folder and Graph Boosts"
            description="Enable folder and graph-based relevance boosts for search results."
            checked={settings.enableLexicalBoosts}
            onCheckedChange={(checked) => updateSetting("enableLexicalBoosts", checked)}
          />
        )}
      </SettingsSection>

      {/* Performance */}
      {!settings.useSmartConnections && settings.enableSemanticSearchV3 && (
        <SettingsSection
          icon={<Gauge className="tw-size-4" />}
          title="Performance"
          description="Control indexing throughput and resource limits."
          accentColor="var(--color-yellow)"
          collapsible
          defaultOpen={false}
          searchTerms={[
            "Requests per Minute",
            "Embedding Batch Size",
            "Number of Partitions",
            "Lexical Search RAM Limit",
          ]}
        >
          <SettingItem
            type="slider"
            title="Requests per Minute"
            description="Default is 60. Decrease if you are rate limited by your embedding provider."
            min={10}
            max={60}
            step={10}
            value={Math.min(settings.embeddingRequestsPerMin, 60)}
            onChange={(value) => updateSetting("embeddingRequestsPerMin", value)}
          />

          <SettingItem
            type="slider"
            title="Embedding Batch Size"
            description="Default is 16. Increase for faster indexing if your provider supports it."
            min={1}
            max={128}
            step={1}
            value={settings.embeddingBatchSize}
            onChange={(value) => updateSetting("embeddingBatchSize", value)}
          />

          <SettingItem
            type="select"
            title="Number of Partitions"
            description="Increase for large vaults. Changes require rebuilding the index."
            value={String(settings.numPartitions || 1)}
            onChange={(value) => updateSetting("numPartitions", Number(value))}
            options={[
              { label: "1", value: "1" },
              { label: "2", value: "2" },
              { label: "4", value: "4" },
              { label: "8", value: "8" },
              { label: "16", value: "16" },
              { label: "32", value: "32" },
              { label: "40", value: "40" },
            ]}
            placeholder="Select partitions"
          />

          <SettingItem
            type="slider"
            title="Lexical Search RAM Limit"
            description="Maximum RAM for full-text search index. Default is 100 MB."
            min={20}
            max={1000}
            step={20}
            value={settings.lexicalSearchRamLimit || 100}
            onChange={(value) => updateSetting("lexicalSearchRamLimit", value)}
            suffix=" MB"
          />
        </SettingsSection>
      )}

      {/* Scope */}
      <SettingsSection
        icon={<FolderTree className="tw-size-4" />}
        title="Scope"
        description="Define inclusion and exclusion patterns for indexing."
        accentColor="var(--color-green)"
        searchTerms={["Exclusions", "Inclusions", settings.qaExclusions, settings.qaInclusions]}
      >
        <SettingItem
          type="custom"
          title="Exclusions"
          description="Exclude folders, tags, note titles or file extensions from being indexed."
        >
          <PatternListEditor
            value={settings.qaExclusions}
            onChange={(value) => updateSetting("qaExclusions", value)}
            filterQuery={normalizedQuery}
          />
        </SettingItem>

        <SettingItem
          type="custom"
          title="Inclusions"
          description="Index only the specified paths, tags, or note titles. Exclusions take precedence."
        >
          <PatternListEditor
            value={settings.qaInclusions}
            onChange={(value) => updateSetting("qaInclusions", value)}
            filterQuery={normalizedQuery}
          />
        </SettingItem>
      </SettingsSection>

      {/* Storage */}
      {!settings.useSmartConnections && (
        <SettingsSection
          icon={<HardDrive className="tw-size-4" />}
          title="Storage"
          description="Configure search index storage options."
          accentColor="var(--color-base-50)"
          collapsible
          defaultOpen={false}
          searchTerms={[
            "Enable Obsidian Sync for Hendrik index",
            "Disable index loading on mobile",
            "sync",
            "mobile",
          ]}
        >
          <SettingItem
            type="switch"
            title="Enable Obsidian Sync for Hendrik index"
            description="Store the semantic index in .obsidian so it syncs with Obsidian Sync."
            checked={settings.enableIndexSync}
            onCheckedChange={(checked) => updateSetting("enableIndexSync", checked)}
          />

          <SettingItem
            type="switch"
            title="Disable index loading on mobile"
            description="Hendrik index won't be loaded on mobile to save resources. Only chat mode will be available."
            checked={settings.disableIndexOnMobile}
            onCheckedChange={(checked) => updateSetting("disableIndexOnMobile", checked)}
          />
        </SettingsSection>
      )}
    </div>
  );
};

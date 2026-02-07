/* eslint-disable tailwindcss/no-custom-classname */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, ArrowUpRight, RefreshCw, RotateCcw, Settings } from "lucide-react";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { ModelParametersEditor } from "@/components/ui/ModelParametersEditor";
import { CustomModel, getModelKey, useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { AGENT_MAX_ITERATIONS_LIMIT } from "@/constants";
import { SettingSlider } from "@/components/ui/setting-slider";
import { getSettings, updateSetting } from "@/settings/model";
import debounce from "lodash.debounce";
import {
  refreshVaultIndex,
  forceReindexVault,
  reloadCurrentProject,
  forceRebuildCurrentProjectContext,
} from "@/components/chat-components/chatActions";
import {
  getDefaultSystemPromptTitle,
  getDisableBuiltinSystemPrompt,
  getPromptFilePath,
  setDisableBuiltinSystemPrompt,
  useSelectedPrompt,
  useSystemPrompts,
} from "@/system-prompts";

/**
 * Optional model parameters that can be reset to global defaults
 * These are model-specific overrides that should be cleared on reset
 */
const RESETTABLE_MODEL_PARAMS: (keyof CustomModel)[] = [
  "topP",
  "frequencyPenalty",
  "reasoningEffort",
  "verbosity",
];

export function ChatSettingsPopover() {
  const settings = getSettings();
  const modelKey = getModelKey();

  // Find the currently selected model (original model)
  const originalModel = settings.activeModels.find(
    (model) => `${model.name}|${model.provider}` === modelKey
  );

  // Local editing state
  const [localModel, setLocalModel] = useState<CustomModel | undefined>(originalModel);

  // System prompt state (session-level, in-memory)
  const prompts = useSystemPrompts();
  const [sessionPrompt, setSessionPrompt] = useSelectedPrompt();
  const globalDefault = getDefaultSystemPromptTitle();
  const [selectedChain] = useChainType();

  /**
   * Check if a prompt title exists in the current prompts list
   */
  const promptExists = (title: string | null | undefined): boolean => {
    if (!title) return false;
    return prompts.some((p) => p.title === title);
  };

  // Display value: use existing prompts only, otherwise show placeholder
  const displayValue = promptExists(sessionPrompt)
    ? sessionPrompt
    : promptExists(globalDefault)
      ? globalDefault
      : "";

  // Read state from session atom
  const [disableBuiltin, setDisableBuiltin] = useState(getDisableBuiltinSystemPrompt());
  const [showConfirmation, setShowConfirmation] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);

  // Update local state when original model changes (e.g., switching models)
  useEffect(() => {
    setLocalModel(originalModel);
  }, [originalModel]);

  // Auto-scroll to confirmation box when it appears
  useEffect(() => {
    if (showConfirmation && confirmationRef.current) {
      confirmationRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [showConfirmation]);

  // Debounced save function - must be defined before handleOpenChange
  // Reference: Command module uses lodash.debounce which has cancel() method
  const debouncedSave = useMemo(
    () =>
      debounce((updatedModel: CustomModel) => {
        const updatedModels = settings.activeModels.map((model) =>
          `${model.name}|${model.provider}` === modelKey ? updatedModel : model
        );
        updateSetting("activeModels", updatedModels);
      }, 500),
    [settings.activeModels, modelKey]
  );

  // Cleanup debounced save on unmount to ensure pending changes are persisted
  useEffect(() => {
    return () => {
      debouncedSave.flush();
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  /**
   * Sync global disableBuiltinSystemPrompt state to local UI state when popover opens
   * This ensures the UI reflects the current state after chat switches (new chat or load history)
   */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        // Flush pending debounced saves when popover closes to ensure changes are persisted
        // Reason: cancel() would discard user's last modification if they close quickly
        debouncedSave.flush();
      }
      if (open) {
        const currentValue = getDisableBuiltinSystemPrompt();
        setDisableBuiltin(currentValue);
        if (!currentValue) {
          setShowConfirmation(false);
        }
      }
    },
    [debouncedSave]
  );

  /**
   * Update model parameters (immediately update UI, delayed save)
   */
  const handleParamChange = useCallback(
    (field: keyof CustomModel, value: any) => {
      if (!localModel) return;

      const updatedModel = { ...localModel, [field]: value };
      setLocalModel(updatedModel);
      debouncedSave(updatedModel);
    },
    [localModel, debouncedSave]
  );

  /**
   * Reset parameters (delete model-specific values, revert to global defaults)
   */
  const handleParamReset = useCallback(
    (field: keyof CustomModel) => {
      if (!localModel) return;

      const updatedModel = { ...localModel };
      delete updatedModel[field];
      setLocalModel(updatedModel);
      debouncedSave(updatedModel);
    },
    [localModel, debouncedSave]
  );

  const handleReset = useCallback(() => {
    // Reset all optional parameters in one operation
    // Reason: Calling handleParamReset multiple times would capture stale localModel
    // Reference: Command module uses single object construction pattern
    if (localModel) {
      const updatedModel = { ...localModel };
      RESETTABLE_MODEL_PARAMS.forEach((key) => delete updatedModel[key]);
      setLocalModel(updatedModel);
      debouncedSave(updatedModel);
    }
    // Reset session prompt to use global default
    setSessionPrompt("");
    setDisableBuiltin(false);
    setShowConfirmation(false);
    // Clear session settings
    setDisableBuiltinSystemPrompt(false);
  }, [localModel, debouncedSave, setSessionPrompt]);

  const handleDisableBuiltinToggle = (checked: boolean) => {
    if (checked) {
      setShowConfirmation(true);
    } else {
      setDisableBuiltin(false);
      setShowConfirmation(false);
      // Update session settings
      setDisableBuiltinSystemPrompt(false);
    }
  };

  const confirmDisableBuiltin = () => {
    setDisableBuiltin(true);
    setShowConfirmation(false);
    // Update session settings
    setDisableBuiltinSystemPrompt(true);
  };

  const cancelDisableBuiltin = () => {
    setShowConfirmation(false);
  };

  /**
   * Open the source file of the currently selected system prompt
   */
  const handleOpenSourceFile = () => {
    if (!displayValue) return;
    const filePath = getPromptFilePath(displayValue);
    app.workspace.openLinkText(filePath, "", true);
  };

  if (!localModel) {
    return null;
  }
  const isProjectMode = selectedChain === ChainType.PROJECT_CHAIN;

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost2" size="icon" title="Settings">
          <Settings className="tw-size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="hendrik-settings-popover tw-w-80 tw-rounded-xl tw-p-0" align="end">
        <div className="hendrik-settings-popover__frame tw-flex tw-max-h-[500px] tw-flex-col">
          {/* Header with Reset */}
          <div className="hendrik-settings-popover__header tw-shrink-0 tw-border-b tw-px-4">
            <div className="tw-flex tw-items-center tw-justify-between">
              <h3 className="hendrik-settings-popover__title tw-text-sm tw-font-semibold">
                Settings
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="hendrik-settings-popover__reset tw-h-7 tw-text-xs"
              >
                <RotateCcw className="tw-mr-1 tw-size-3" />
                Reset
              </Button>
            </div>
          </div>

          {/* Scrollable Content Area */}
          <ScrollArea className="hendrik-settings-popover__scroll tw-flex-1 tw-overflow-y-auto">
            <div className="hendrik-settings-popover__content tw-space-y-3 tw-p-3">
              {/* Display Toggles */}
              <div className="hendrik-settings-section tw-space-y-2">
                <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                  Quick Toggles
                </Label>
                <div className="tw-space-y-1">
                  <div className="hendrik-settings-row tw-flex tw-items-center tw-justify-between tw-py-1">
                    <span className="tw-text-sm">Relevant Notes</span>
                    <SettingSwitch
                      checked={settings.showRelevantNotes}
                      onCheckedChange={(v) => updateSetting("showRelevantNotes", v)}
                    />
                  </div>
                  <div className="hendrik-settings-row tw-flex tw-items-center tw-justify-between tw-py-1">
                    <span className="tw-text-sm">Auto-accept Edits</span>
                    <SettingSwitch
                      checked={settings.autoAcceptEdits}
                      onCheckedChange={(v) => updateSetting("autoAcceptEdits", v)}
                    />
                  </div>
                </div>
              </div>
              <Separator />

              {/* System Prompt */}
              <div className="hendrik-settings-section tw-space-y-2">
                <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                  System Prompt
                </Label>
                <div className="tw-flex tw-items-center tw-gap-2">
                  <ObsidianNativeSelect
                    value={displayValue}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value && promptExists(value)) {
                        setSessionPrompt(value);
                      }
                    }}
                    options={prompts.map((prompt) => ({
                      label:
                        prompt.title === globalDefault ? `${prompt.title} (Default)` : prompt.title,
                      value: prompt.title,
                    }))}
                    placeholder="Select system prompt"
                    containerClassName="tw-flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleOpenSourceFile}
                    className="tw-size-5 tw-shrink-0 tw-p-0"
                    title="Open source file"
                    disabled={!displayValue}
                  >
                    <ArrowUpRight className="tw-size-4" />
                  </Button>
                </div>
                <div className="hendrik-settings-row tw-flex tw-items-center tw-justify-between tw-py-1">
                  <span className="tw-text-sm">Disable Builtin Prompt</span>
                  <SettingSwitch
                    checked={disableBuiltin}
                    onCheckedChange={handleDisableBuiltinToggle}
                    disabled={showConfirmation}
                  />
                </div>
                {(disableBuiltin || showConfirmation) && (
                  <div
                    ref={confirmationRef}
                    className="tw-rounded-md tw-border tw-bg-error/10 tw-p-2 tw-border-error/50"
                  >
                    <div className="tw-flex tw-gap-2">
                      <AlertTriangle className="tw-mt-0.5 tw-size-3 tw-shrink-0 tw-text-error" />
                      <div className="tw-flex-1 tw-space-y-1.5">
                        <div className="tw-text-xs tw-leading-relaxed tw-text-muted">
                          Vault search, web search, and agent mode will become unavailable. Only
                          your custom system prompt will be used.
                        </div>
                        {showConfirmation && (
                          <div className="tw-flex tw-gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={confirmDisableBuiltin}
                              className="tw-h-6 tw-text-xs"
                            >
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelDisableBuiltin}
                              className="tw-h-6 tw-bg-transparent tw-text-xs"
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <div className="tw-text-[10px] tw-italic tw-text-muted">
                  System prompt settings apply to this session only
                </div>
              </div>

              <Separator />

              {/* Agent Controls */}
              <div className="hendrik-settings-section tw-space-y-2">
                <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                  Agent
                </Label>
                <div className="tw-space-y-1">
                  <div className="hendrik-settings-row tw-flex tw-items-center tw-justify-between tw-gap-3 tw-py-1">
                    <span className="tw-text-sm">Max Iterations</span>
                    <div className="tw-min-w-[160px] tw-flex-1">
                      <SettingSlider
                        value={settings.autonomousAgentMaxIterations ?? 8}
                        onChange={(value) => updateSetting("autonomousAgentMaxIterations", value)}
                        min={1}
                        max={AGENT_MAX_ITERATIONS_LIMIT}
                        step={1}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <Separator />

              {/* Model Parameters */}
              <div className="hendrik-settings-section tw-space-y-2">
                <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                  Model Parameters
                </Label>
                <ModelParametersEditor
                  model={localModel}
                  settings={settings}
                  onChange={handleParamChange}
                  onReset={handleParamReset}
                  showTokenLimit={true}
                />
              </div>

              <Separator />

              {/* Actions */}
              <div className="hendrik-settings-section tw-space-y-1">
                <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                  Actions
                </Label>
                {isProjectMode ? (
                  <>
                    <button
                      type="button"
                      className="hendrik-settings-action tw-flex tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5 tw-text-sm hover:tw-bg-interactive-hover"
                      onClick={() => reloadCurrentProject()}
                    >
                      <RefreshCw className="tw-size-3.5" />
                      Reload Project
                    </button>
                    <button
                      type="button"
                      className="hendrik-settings-action hendrik-settings-action--danger tw-flex tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5 tw-text-sm tw-text-error hover:tw-bg-interactive-hover"
                      onClick={() => forceRebuildCurrentProjectContext()}
                    >
                      <AlertTriangle className="tw-size-3.5" />
                      Force Rebuild Context
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="hendrik-settings-action tw-flex tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5 tw-text-sm hover:tw-bg-interactive-hover"
                      onClick={() => refreshVaultIndex()}
                    >
                      <RefreshCw className="tw-size-3.5" />
                      Refresh Vault Index
                    </button>
                    <button
                      type="button"
                      className="hendrik-settings-action hendrik-settings-action--danger tw-flex tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5 tw-text-sm tw-text-error hover:tw-bg-interactive-hover"
                      onClick={() => {
                        const modal = new ConfirmModal(
                          app,
                          () => forceReindexVault(),
                          "This will delete and rebuild your entire vault index from scratch. This operation cannot be undone. Are you sure?",
                          "Force Reindex Vault"
                        );
                        modal.open();
                      }}
                    >
                      <AlertTriangle className="tw-size-3.5" />
                      Force Reindex Vault
                    </button>
                  </>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}

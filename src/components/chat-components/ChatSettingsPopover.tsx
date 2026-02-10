/* eslint-disable tailwindcss/no-custom-classname */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, ArrowUpRight, RefreshCw, RotateCcw, Settings } from "lucide-react";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { getSettings, updateSetting } from "@/settings/model";
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
import {
  CHRONICLE_MODE_NONE,
  getChronicleModeMeta,
  getChronicleModesMeta,
} from "@/system-prompts/chronicleModes";
import { getEffectiveChronicleMode, useSessionChronicleMode } from "@/system-prompts/state";
import { openHendrikSettings } from "@/settings/v2/settingsNavigation";
import { Platform } from "obsidian";

interface ChatSettingsPopoverProps {
  onSelectAgentMode?: () => void;
  onSelectProjectMode?: () => void;
}

/**
 * Resets session-only system prompt settings in chat.
 */
function resetSessionPromptState(
  setSessionPrompt: (value: string) => void,
  setSessionChronicleMode: (value: string) => void,
  setDisableBuiltin: (value: boolean) => void,
  setShowConfirmation: (value: boolean) => void
): void {
  setSessionPrompt("");
  setSessionChronicleMode("");
  setDisableBuiltin(false);
  setShowConfirmation(false);
  setDisableBuiltinSystemPrompt(false);
}

export function ChatSettingsPopover({
  onSelectAgentMode,
  onSelectProjectMode,
}: ChatSettingsPopoverProps) {
  const settings = getSettings();
  const prompts = useSystemPrompts();
  const [sessionPrompt, setSessionPrompt] = useSelectedPrompt();
  const [sessionChronicleMode, setSessionChronicleMode] = useSessionChronicleMode();
  const [selectedChain, setSelectedChain] = useChainType();
  const [disableBuiltin, setDisableBuiltin] = useState(getDisableBuiltinSystemPrompt());
  const [showConfirmation, setShowConfirmation] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);

  const globalDefault = getDefaultSystemPromptTitle();
  const effectiveChronicleMode = getEffectiveChronicleMode();
  const activeModeMeta = getChronicleModeMeta(effectiveChronicleMode);
  const isProjectMode = selectedChain === ChainType.PROJECT_CHAIN;
  const modeValue = isProjectMode ? "projects" : "agent";

  /**
   * Checks whether a prompt title exists in the prompt collection.
   *
   * @param title - Candidate prompt title.
   * @returns True when a prompt with the title exists.
   */
  const promptExists = (title: string | null | undefined): boolean => {
    if (!title) {
      return false;
    }
    return prompts.some((prompt) => prompt.title === title);
  };

  const displayValue = promptExists(sessionPrompt)
    ? sessionPrompt
    : promptExists(globalDefault)
      ? globalDefault
      : "";

  useEffect(() => {
    if (showConfirmation && confirmationRef.current) {
      confirmationRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [showConfirmation]);

  /**
   * Syncs local UI state when popover opens.
   *
   * @param open - Whether popover is opening.
   */
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      return;
    }
    const currentDisableState = getDisableBuiltinSystemPrompt();
    setDisableBuiltin(currentDisableState);
    if (!currentDisableState) {
      setShowConfirmation(false);
    }
  }, []);

  /**
   * Handles toggle for disabling built-in prompt.
   *
   * @param checked - Switch value.
   */
  const handleDisableBuiltinToggle = (checked: boolean): void => {
    if (checked) {
      setShowConfirmation(true);
      return;
    }

    setDisableBuiltin(false);
    setShowConfirmation(false);
    setDisableBuiltinSystemPrompt(false);
  };

  /**
   * Confirms disabling built-in prompt support.
   */
  const confirmDisableBuiltin = (): void => {
    setDisableBuiltin(true);
    setShowConfirmation(false);
    setDisableBuiltinSystemPrompt(true);
  };

  /**
   * Cancels the disable prompt confirmation flow.
   */
  const cancelDisableBuiltin = (): void => {
    setShowConfirmation(false);
  };

  /**
   * Opens prompt source file in Obsidian.
   */
  const handleOpenSourceFile = (): void => {
    if (!displayValue) {
      return;
    }
    const filePath = getPromptFilePath(displayValue);
    app.workspace.openLinkText(filePath, "", true);
  };

  /**
   * Creates a confirmation flow for force reindex.
   */
  const handleForceReindex = (): void => {
    const modal = new ConfirmModal(
      app,
      () => forceReindexVault(),
      "This deletes and rebuilds the full vault index. Continue?",
      "Force Reindex Vault",
      "Continue",
      "Cancel",
      "settings"
    );
    modal.open();
  };

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost2" size="icon" title="Settings">
          <Settings className="tw-size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="hendrik-settings-popover hendrik-settings-menu !tw-z-[10020] !tw-w-[380px] !tw-max-w-[min(94vw,380px)] tw-p-0"
      >
        <div className="hendrik-settings-popover__frame hendrik-settings-menu__frame tw-flex tw-max-h-[min(74vh,760px)] tw-flex-col">
          <div className="hendrik-settings-popover__header tw-shrink-0 tw-border-b tw-px-4">
            <div className="tw-flex tw-items-center tw-justify-between">
              <h3 className="hendrik-settings-popover__title tw-text-sm tw-font-semibold">
                Chat Settings
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  resetSessionPromptState(
                    setSessionPrompt,
                    setSessionChronicleMode,
                    setDisableBuiltin,
                    setShowConfirmation
                  )
                }
                className="hendrik-settings-popover__reset tw-h-7 tw-text-xs"
              >
                <RotateCcw className="tw-mr-1 tw-size-3" />
                Reset Session
              </Button>
            </div>
          </div>

          <ScrollArea className="hendrik-settings-popover__scroll tw-flex-1 tw-overflow-y-auto">
            <div className="hendrik-settings-popover__content tw-space-y-3 tw-p-3">
              <div className="hendrik-settings-section tw-space-y-2">
                <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                  Quick Toggles
                </Label>
                <div className="tw-space-y-1">
                  <div className="hendrik-settings-row tw-flex tw-items-center tw-justify-between tw-py-1">
                    <span className="tw-text-sm">Relevant Notes</span>
                    <SettingSwitch
                      checked={settings.showRelevantNotes}
                      onCheckedChange={(value) => updateSetting("showRelevantNotes", value)}
                    />
                  </div>
                  <div className="hendrik-settings-row tw-flex tw-items-center tw-justify-between tw-py-1">
                    <span className="tw-text-sm">Auto-accept Edits</span>
                    <SettingSwitch
                      checked={settings.autoAcceptEdits}
                      onCheckedChange={(value) => updateSetting("autoAcceptEdits", value)}
                    />
                  </div>
                </div>
              </div>

              {Platform.isMobile && (
                <>
                  <Separator />

                  <div className="hendrik-settings-section tw-space-y-2">
                    <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                      Mode
                    </Label>
                    <ObsidianNativeSelect
                      value={modeValue}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "projects") {
                          if (onSelectProjectMode) {
                            onSelectProjectMode();
                          } else {
                            setSelectedChain(ChainType.PROJECT_CHAIN);
                          }
                          return;
                        }
                        if (onSelectAgentMode) {
                          onSelectAgentMode();
                        } else {
                          setSelectedChain(ChainType.TOOL_CALLING_CHAIN);
                        }
                      }}
                      options={[
                        { label: "Agent", value: "agent" },
                        { label: "Projects", value: "projects" },
                      ]}
                      placeholder="Mode"
                    />
                  </div>
                </>
              )}

              <Separator />

              <div className="hendrik-settings-section tw-space-y-2">
                <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                  System Prompt
                </Label>
                <div className="tw-flex tw-items-center tw-gap-2">
                  <ObsidianNativeSelect
                    value={displayValue}
                    onChange={(event) => {
                      const value = event.target.value;
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
                  <span className="tw-text-sm">Disable Built-in Prompt</span>
                  <SettingSwitch
                    checked={disableBuiltin}
                    onCheckedChange={handleDisableBuiltinToggle}
                    disabled={showConfirmation}
                  />
                </div>
                {(disableBuiltin || showConfirmation) && (
                  <div
                    ref={confirmationRef}
                    // eslint-disable-next-line tailwindcss/classnames-order
                    className="tw-rounded-md tw-border tw-bg-error/10 tw-border-error/50 tw-p-2"
                  >
                    <div className="tw-flex tw-gap-2">
                      <AlertTriangle className="tw-mt-0.5 tw-size-3 tw-shrink-0 tw-text-error" />
                      <div className="tw-flex-1 tw-space-y-1.5">
                        <div className="tw-text-xs tw-leading-relaxed tw-text-muted">
                          Vault search, web search, and agent tools are unavailable when the
                          built-in prompt is disabled.
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
                  Applies to the current chat session only.
                </div>
              </div>

              <Separator />

              <div className="hendrik-settings-section tw-space-y-2">
                <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                  Chronicle Mode
                </Label>
                <ObsidianNativeSelect
                  value={sessionChronicleMode || effectiveChronicleMode}
                  onChange={(event) => {
                    setSessionChronicleMode(event.target.value);
                  }}
                  options={[
                    { label: "None", value: CHRONICLE_MODE_NONE },
                    ...getChronicleModesMeta().map((mode) => ({
                      label: mode.name,
                      value: mode.id,
                    })),
                  ]}
                  containerClassName="tw-flex-1"
                />
                {activeModeMeta && (
                  <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-p-2">
                    <div className="tw-text-xs tw-italic tw-text-muted">
                      {activeModeMeta.flavorText}
                    </div>
                  </div>
                )}
              </div>

              <Separator />

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
                      onClick={handleForceReindex}
                    >
                      <AlertTriangle className="tw-size-3.5" />
                      Force Reindex Vault
                    </button>
                  </>
                )}
              </div>

              <Separator />

              <div className="hendrik-settings-section tw-space-y-1">
                <Label className="hendrik-settings-section__label tw-text-[11px] tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
                  More Settings
                </Label>
                <button
                  type="button"
                  className="hendrik-settings-action tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5 tw-text-sm hover:tw-bg-interactive-hover"
                  onClick={() => openHendrikSettings("ai")}
                >
                  Open AI Settings
                  <ArrowUpRight className="tw-size-3.5" />
                </button>
                <button
                  type="button"
                  className="hendrik-settings-action tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5 tw-text-sm hover:tw-bg-interactive-hover"
                  onClick={() => openHendrikSettings("search")}
                >
                  Open Search Settings
                  <ArrowUpRight className="tw-size-3.5" />
                </button>
                <button
                  type="button"
                  className="hendrik-settings-action tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5 tw-text-sm hover:tw-bg-interactive-hover"
                  onClick={() => openHendrikSettings("advanced")}
                >
                  Open Advanced Settings
                  <ArrowUpRight className="tw-size-3.5" />
                </button>
              </div>
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}

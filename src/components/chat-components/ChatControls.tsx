import { ProjectConfig, useModelKey } from "@/aiParams";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { ChatSettingsPopover } from "@/components/chat-components/ChatSettingsPopover";
import { ContextPressureIndicator } from "@/components/chat-components/ContextPressureIndicator";
import {
  getProjectIconComponent,
  resolveProjectAppearance,
} from "@/components/project/projectAppearance";
import { Button } from "@/components/ui/button";
import { useSettingsValue } from "@/settings/model";
import { findCustomModel } from "@/utils";
import { ArrowLeft, Download, History, MessageCirclePlus, X } from "lucide-react";
import React from "react";
import { TokenCounter } from "./TokenCounter";

export { reloadCurrentProject } from "@/components/chat-components/chatActions";

interface ChatControlsProps {
  onNewChat: () => void;
  onSaveAsNote: () => Promise<void>;
  onLoadHistory: () => void;
  onClosePanel?: () => void;
  chatHistory: ChatHistoryItem[];
  onUpdateChatTitle: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onLoadChat: (id: string) => Promise<void>;
  onOpenSourceFile?: (id: string) => Promise<void>;
  latestTokenCount?: number | null;
  isProjectMode?: boolean;
  activeProject?: ProjectConfig | null;
  viewingProject?: ProjectConfig | null;
  onBackToProjects?: () => void;
  onBackFromViewing?: () => void;
}

/**
 * Top action bar for chat actions, usage metrics, and project identity.
 */
export function ChatControls({
  onNewChat,
  onSaveAsNote,
  onLoadHistory,
  onClosePanel,
  chatHistory,
  onUpdateChatTitle,
  onDeleteChat,
  onLoadChat,
  onOpenSourceFile,
  latestTokenCount,
  isProjectMode,
  activeProject,
  viewingProject,
  onBackToProjects,
  onBackFromViewing,
}: ChatControlsProps): React.ReactElement {
  const settings = useSettingsValue();
  const [currentModelKey] = useModelKey();
  const currentProject = activeProject ?? null;
  const displayProject = currentProject ?? viewingProject ?? null;
  const effectiveModelKey = displayProject?.projectModelKey ?? currentModelKey;
  const projectAppearance = displayProject ? resolveProjectAppearance(displayProject) : null;
  const ProjectIcon = projectAppearance ? getProjectIconComponent(projectAppearance.icon) : null;

  /**
   * Resolve max context tokens for the active model with a global fallback.
   */
  const resolveMaxContextTokens = (): number => {
    try {
      const model = findCustomModel(effectiveModelKey, settings.activeModels);
      return model.maxContextTokens ?? settings.defaultMaxContextTokens;
    } catch {
      return settings.defaultMaxContextTokens;
    }
  };

  const showUsageMetrics = latestTokenCount !== null && latestTokenCount !== undefined;

  return (
    <div className="tw-flex tw-w-full tw-flex-col">
      <div className="hendrik-chat-controls tw-flex tw-w-full tw-items-center">
        <div className="hendrik-chat-controls__left tw-flex tw-items-center tw-gap-2">
          {showUsageMetrics && (
            <div className="hendrik-chat-controls__metrics">
              <ContextPressureIndicator
                show={settings.showContextPressureIndicator}
                tokenCount={latestTokenCount ?? null}
                maxContextTokens={resolveMaxContextTokens()}
              />
              <TokenCounter tokenCount={latestTokenCount ?? null} />
            </div>
          )}
        </div>

        <div className="tw-flex-1" />

        <div className="hendrik-chat-controls__right tw-flex tw-items-center tw-gap-0.5">
          {!isProjectMode && (
            <>
              <Button variant="ghost2" size="icon" title="New Chat" onClick={onNewChat}>
                <MessageCirclePlus className="tw-size-4" />
              </Button>

              <ChatHistoryPopover
                chatHistory={chatHistory}
                onUpdateTitle={onUpdateChatTitle}
                onDeleteChat={onDeleteChat}
                onLoadChat={onLoadChat}
                onOpenSourceFile={onOpenSourceFile}
              >
                <Button variant="ghost2" size="icon" title="Chat History" onClick={onLoadHistory}>
                  <History className="tw-size-4" />
                </Button>
              </ChatHistoryPopover>

              {!settings.autosaveChat && (
                <Button
                  variant="ghost2"
                  size="icon"
                  title="Save Chat as Note"
                  onClick={onSaveAsNote}
                >
                  <Download className="tw-size-4" />
                </Button>
              )}
            </>
          )}

          <ChatSettingsPopover />

          {onClosePanel && (
            <Button variant="ghost2" size="icon" title="Close" onClick={onClosePanel}>
              <X className="tw-size-4" />
            </Button>
          )}
        </div>
      </div>

      {isProjectMode && displayProject && projectAppearance && ProjectIcon && (
        <div
          className="hendrik-chat-controls__project-row"
          title={`Current project: ${displayProject.name}`}
        >
          {(onBackToProjects || onBackFromViewing) && (
            <button
              type="button"
              className="hendrik-chat-controls__project-row-back"
              onClick={onBackToProjects ?? onBackFromViewing}
              title="Back to project list"
            >
              <ArrowLeft className="tw-size-3.5" />
            </button>
          )}
          <span className="hendrik-chat-controls__project-row-label">Working in</span>
          <span className="hendrik-chat-controls__project-row-divider" aria-hidden="true" />
          <span
            className="hendrik-chat-controls__project-row-icon"
            style={{
              backgroundColor: `color-mix(in srgb, ${projectAppearance.color} 14%, var(--background-primary))`,
              color: projectAppearance.color,
            }}
          >
            <ProjectIcon className="tw-size-3.5" />
          </span>
          <span className="hendrik-chat-controls__project-row-name">{displayProject.name}</span>
        </div>
      )}
    </div>
  );
}

import { ProjectConfig, setCurrentProject, useChainType, useModelKey } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import {
  getProjectIconComponent,
  resolveProjectAppearance,
} from "@/components/project/projectAppearance";
import { ChatSettingsPopover } from "@/components/chat-components/ChatSettingsPopover";
import { ContextPressureIndicator } from "@/components/chat-components/ContextPressureIndicator";
import { Button } from "@/components/ui/button";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useSettingsValue } from "@/settings/model";
import { findCustomModel } from "@/utils";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import {
  ArrowLeft,
  Brain,
  ChevronDown,
  Download,
  History,
  LibraryBig,
  MessageCirclePlus,
  X,
} from "lucide-react";
import React from "react";
import { TokenCounter } from "./TokenCounter";

export { reloadCurrentProject } from "@/components/chat-components/chatActions";

interface ChatControlsProps {
  onNewChat: () => void;
  onSaveAsNote: () => Promise<void>;
  onLoadHistory: () => void;
  onModeChange: (mode: ChainType) => void;
  onCloseProject?: () => void;
  onClosePanel?: () => void;
  chatHistory: ChatHistoryItem[];
  onUpdateChatTitle: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onLoadChat: (id: string) => Promise<void>;
  onOpenSourceFile?: (id: string) => Promise<void>;
  latestTokenCount?: number | null;
  /** When true, hides agent-only actions (new chat, history, save, settings). */
  isProjectMode?: boolean;
  /** Current active project when inside a project chat session. */
  activeProject?: ProjectConfig | null;
  /** Callback to navigate back to the project list from within a project chat. */
  onBackToProjects?: () => void;
}

/**
 * Top control bar for mode switching and core chat actions.
 * Clean single-row header with mode selector, actions, and integrated metrics.
 */
export function ChatControls({
  onNewChat,
  onSaveAsNote,
  onLoadHistory,
  onModeChange,
  onCloseProject,
  onClosePanel,
  chatHistory,
  onUpdateChatTitle,
  onDeleteChat,
  onLoadChat,
  onOpenSourceFile,
  latestTokenCount,
  isProjectMode,
  activeProject,
  onBackToProjects,
}: ChatControlsProps) {
  const settings = useSettingsValue();
  const [selectedChain, setSelectedChain] = useChainType();
  const [currentModelKey] = useModelKey();
  const currentProject = activeProject ?? null;
  const effectiveModelKey =
    selectedChain === ChainType.PROJECT_CHAIN
      ? (currentProject?.projectModelKey ?? currentModelKey)
      : currentModelKey;
  const projectAppearance = currentProject ? resolveProjectAppearance(currentProject) : null;
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

  /**
   * Switches between chat modes and preserves project autosave semantics.
   */
  const handleModeChange = async (chainType: ChainType) => {
    const isLeavingProjectMode =
      selectedChain === ChainType.PROJECT_CHAIN && chainType !== ChainType.PROJECT_CHAIN;
    if (isLeavingProjectMode && settings.autosaveChat) {
      await onSaveAsNote();
    }

    setSelectedChain(chainType);
    onModeChange(chainType);
    if (chainType !== ChainType.PROJECT_CHAIN) {
      setCurrentProject(null);
      onCloseProject?.();
    }
  };

  const modeLabel = selectedChain === ChainType.PROJECT_CHAIN ? "Projects" : "Agent";
  const showUsageMetrics = latestTokenCount !== null && latestTokenCount !== undefined;

  return (
    <div className="copilot-chat-controls tw-flex tw-w-full tw-items-center">
      {/* Left: mode selector + usage metrics */}
      <div className="copilot-chat-controls__left tw-flex tw-items-center tw-gap-2">
        {isProjectMode && onBackToProjects && (
          <Button variant="ghost2" size="icon" title="Back to projects" onClick={onBackToProjects}>
            <ArrowLeft className="tw-size-4" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="fit" className="copilot-chat-controls__mode tw-text-sm">
              <span className="tw-flex tw-items-center tw-gap-1.5">
                {selectedChain === ChainType.PROJECT_CHAIN ? (
                  <LibraryBig className="tw-size-4" />
                ) : (
                  <Brain className="tw-size-4" />
                )}
                {modeLabel}
              </span>
              <ChevronDown className="tw-size-3.5 tw-opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="tw-rounded-lg">
            <DropdownMenuItem
              onSelect={() => {
                handleModeChange(ChainType.TOOL_CALLING_CHAIN);
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <Brain className="tw-size-4" />
                Agent
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="tw-flex tw-items-center tw-gap-2"
              onSelect={() => {
                handleModeChange(ChainType.PROJECT_CHAIN);
              }}
            >
              <LibraryBig className="tw-size-4" />
              Projects
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedChain === ChainType.PROJECT_CHAIN &&
          currentProject &&
          projectAppearance &&
          ProjectIcon && (
            <div
              className="copilot-chat-controls__project-header"
              title={`Current project: ${currentProject.name}`}
            >
              <span
                className="copilot-chat-controls__project-header-icon"
                style={{
                  backgroundColor: `color-mix(in srgb, ${projectAppearance.color} 14%, var(--background-primary))`,
                  color: projectAppearance.color,
                }}
              >
                <ProjectIcon className="tw-size-3.5" />
              </span>
              <span className="copilot-chat-controls__project-header-copy">
                <span className="copilot-chat-controls__project-header-label">Project Chat</span>
                <span className="copilot-chat-controls__project-header-name">
                  {currentProject.name}
                </span>
              </span>
            </div>
          )}
        {showUsageMetrics && (
          <div className="copilot-chat-controls__metrics">
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

      {/* Right: actions (agent-only items hidden in project mode) */}
      <div className="copilot-chat-controls__right tw-flex tw-items-center tw-gap-0.5">
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
              <Button variant="ghost2" size="icon" title="Save Chat as Note" onClick={onSaveAsNote}>
                <Download className="tw-size-4" />
              </Button>
            )}

            <ChatSettingsPopover />
          </>
        )}

        {onClosePanel && (
          <Button variant="ghost2" size="icon" title="Close" onClick={onClosePanel}>
            <X className="tw-size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

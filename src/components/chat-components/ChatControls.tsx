import { getCurrentProject, setCurrentProject, useChainType, useModelKey } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { Button } from "@/components/ui/button";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useSettingsValue } from "@/settings/model";
import { findCustomModel } from "@/utils";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import {
  Brain,
  ChevronDown,
  Download,
  History,
  LibraryBig,
  MessageCirclePlus,
  X,
} from "lucide-react";
import React from "react";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { TokenCounter } from "./TokenCounter";
import { ChatSettingsPopover } from "@/components/chat-components/ChatSettingsPopover";
import { ContextPressureIndicator } from "@/components/chat-components/ContextPressureIndicator";

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
}

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
}: ChatControlsProps) {
  const settings = useSettingsValue();
  const [selectedChain, setSelectedChain] = useChainType();
  const [currentModelKey] = useModelKey();
  const currentProject = getCurrentProject();
  const effectiveModelKey =
    selectedChain === ChainType.PROJECT_CHAIN
      ? (currentProject?.projectModelKey ?? currentModelKey)
      : currentModelKey;

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

  const handleModeChange = async (chainType: ChainType) => {
    // If leaving project mode with autosave enabled, save chat BEFORE clearing project context
    // This ensures the chat is saved with the correct project prefix
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

  return (
    <div className="copilot-chat-controls tw-flex tw-w-full tw-items-center tw-justify-between tw-p-1">
      <div className="tw-flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="fit" className="tw-ml-1 tw-text-sm tw-text-muted">
              {(selectedChain === ChainType.TOOL_CALLING_CHAIN ||
                selectedChain === ChainType.LLM_CHAIN ||
                selectedChain === ChainType.VAULT_QA_CHAIN) && (
                <div className="tw-flex tw-items-center tw-gap-1">
                  <Brain className="tw-size-4" />
                  Agent
                </div>
              )}
              {selectedChain === ChainType.PROJECT_CHAIN && "Projects"}
              <ChevronDown className="tw-mt-0.5 tw-size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => {
                handleModeChange(ChainType.TOOL_CALLING_CHAIN);
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-1">
                <Brain className="tw-size-4" />
                Agent
              </div>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="tw-flex tw-items-center tw-gap-1"
              onSelect={() => {
                handleModeChange(ChainType.PROJECT_CHAIN);
              }}
            >
              <LibraryBig className="tw-size-4" />
              Projects
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="tw-flex tw-items-center tw-gap-1">
        <div className="tw-mr-2 tw-flex tw-items-center tw-gap-2">
          <ContextPressureIndicator
            show={settings.showContextPressureIndicator}
            tokenCount={latestTokenCount ?? null}
            maxContextTokens={resolveMaxContextTokens()}
          />
          <TokenCounter tokenCount={latestTokenCount ?? null} />
        </div>
        <Button variant="ghost2" size="icon" title="New Chat" onClick={onNewChat}>
          <MessageCirclePlus className="tw-size-4" />
        </Button>
        <ChatSettingsPopover />
        {!settings.autosaveChat && (
          <Button variant="ghost2" size="icon" title="Save Chat as Note" onClick={onSaveAsNote}>
            <Download className="tw-size-4" />
          </Button>
        )}
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
        {onClosePanel && (
          <Button variant="ghost2" size="icon" title="Close" onClick={onClosePanel}>
            <X className="tw-size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

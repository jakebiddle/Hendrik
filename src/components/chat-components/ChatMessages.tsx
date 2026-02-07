import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import {
  resolveEmptyStateSubtitle,
  resolveEmptyStateTitle,
  resolveRoyalAddress,
} from "@/components/chat-components/companionTone";
import {
  ActiveNoteInsight,
  useActiveNoteInsight,
} from "@/components/chat-components/hooks/useActiveNoteInsight";
import { RelevantNotes } from "@/components/chat-components/RelevantNotes";
import {
  getProjectIconComponent,
  type ResolvedProjectAppearance,
} from "@/components/project/projectAppearance";
import { USER_SENDER } from "@/constants";
import { useChatInput } from "@/context/ChatInputContext";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import { useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import { Folder } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ChatMessagesProps {
  chatHistory: ChatMessage[];
  currentAiMessage: string;
  /** Stable ID for streaming message, shared with final persisted message */
  streamingMessageId?: string | null;
  loading?: boolean;
  loadingMessage?: string;
  app: App;
  onRegenerate: (messageIndex: number) => void;
  onEdit: (messageIndex: number, newMessage: string) => void;
  onDelete: (messageIndex: number) => void;
  showHelperComponents: boolean;
  /** When set, renders a project-specific empty state instead of the generic one. */
  projectName?: string | null;
  /** Appearance (color + icon) for the active project, used by the project empty state. */
  projectAppearance?: ResolvedProjectAppearance | null;
}

interface QuickAction {
  label: string;
  prompt: string;
}

/**
 * Brief archivist-themed phrases shown during the loading dots animation
 * when no specific system loading message is set.
 */
const ARCHIVIST_WAITING_PHRASES = [
  "Turning pages",
  "Ink drying",
  "Cross-referencing",
  "Gathering parchment",
  "Perusing the tomes",
  "Deciphering marginalia",
  "Scanning the index",
  "Unrolling the scrolls",
] as const;

/**
 * Builds compact quick actions tailored to the active note context.
 */
function buildQuickActions(activeNote: ActiveNoteInsight): QuickAction[] {
  const noteReference = activeNote.filePath ? `[[${activeNote.filePath}]]` : "[[<note>]]";

  if (activeNote.fileName) {
    return [
      {
        label: "Summarise note",
        prompt: `Summarise ${noteReference} and call out the key claims and gaps.`,
      },
      {
        label: "Stress-test argument",
        prompt: `Challenge weak assumptions in ${noteReference} and suggest stronger alternatives.`,
      },
      {
        label: "Draft next section",
        prompt: `Draft the next section for ${noteReference} in the same style and structure.`,
      },
    ];
  }

  return [
    {
      label: "Search notes",
      prompt: "Search my notes for the strongest evidence on <topic> @vault",
    },
    {
      label: "Analyze source",
      prompt: "Summarise <url> in 6 concise bullets and call out what matters.",
    },
    {
      label: "Plan next steps",
      prompt: "Turn this goal into a practical, ordered action plan: <goal>",
    },
  ];
}

const ChatMessages = memo(
  ({
    chatHistory,
    currentAiMessage,
    streamingMessageId,
    loading,
    loadingMessage,
    app,
    onRegenerate,
    onEdit,
    onDelete,
    showHelperComponents = true,
    projectName,
    projectAppearance,
  }: ChatMessagesProps) => {
    const [loadingDots, setLoadingDots] = useState("");
    const waitingPhraseRef = useRef(
      ARCHIVIST_WAITING_PHRASES[Math.floor(Math.random() * ARCHIVIST_WAITING_PHRASES.length)]
    );
    const settings = useSettingsValue();
    const chatInput = useChatInput();
    const activeNote = useActiveNoteInsight();

    const hasVisibleMessages = useMemo(
      () => chatHistory.some((message) => message.isVisible),
      [chatHistory]
    );

    const latestUserMessage = useMemo(() => {
      for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
        const message = chatHistory[index];
        if (message.sender === USER_SENDER && message.isVisible) {
          return message.message;
        }
      }

      return null;
    }, [chatHistory]);

    const royalAddress = useMemo(
      () =>
        resolveRoyalAddress({
          userPreferredName: settings.userPreferredName,
          userRoyalTitle: settings.userRoyalTitle,
        }),
      [settings.userPreferredName, settings.userRoyalTitle]
    );

    const emptyToneContext = useMemo(
      () => ({
        activeNote,
        royalAddress,
        hasMessages: false,
        isGenerating: false,
        lastUserMessage: latestUserMessage,
      }),
      [activeNote, royalAddress, latestUserMessage]
    );

    const emptyTitle = useMemo(() => resolveEmptyStateTitle(emptyToneContext), [emptyToneContext]);

    const emptySubtitle = useMemo(
      () => resolveEmptyStateSubtitle(emptyToneContext),
      [emptyToneContext]
    );

    const quickActions = useMemo(() => buildQuickActions(activeNote), [activeNote]);

    // Chat scrolling behavior
    const { containerMinHeight, scrollContainerCallbackRef, getMessageKey } = useChatScrolling({
      chatHistory,
    });

    useEffect(() => {
      let intervalId: NodeJS.Timeout;
      if (loading) {
        // Pick a fresh archivist phrase each time loading begins
        waitingPhraseRef.current =
          ARCHIVIST_WAITING_PHRASES[Math.floor(Math.random() * ARCHIVIST_WAITING_PHRASES.length)];
        intervalId = setInterval(() => {
          setLoadingDots((dots) => (dots.length < 6 ? dots + "." : ""));
        }, 200);
      } else {
        setLoadingDots("");
      }
      return () => clearInterval(intervalId);
    }, [loading]);

    /**
     * Inserts a quick action prompt into the composer using the Lexical flow.
     */
    const handleQuickAction = useCallback(
      (text: string) => {
        chatInput.focusInput();
        window.requestAnimationFrame(() => {
          chatInput.insertTextWithPills(text, true);
        });
      },
      [chatInput]
    );

    if (!hasVisibleMessages && !currentAiMessage) {
      // Project-specific empty state
      if (projectName) {
        const ProjectIcon = projectAppearance
          ? getProjectIconComponent(projectAppearance.icon)
          : Folder;
        const projectColor = projectAppearance?.color ?? "var(--interactive-accent)";

        return (
          <div className="hendrik-chat-empty">
            <div className="hendrik-chat-empty__center">
              <div
                className="hendrik-project-empty__icon"
                aria-hidden="true"
                style={{
                  background: `color-mix(in srgb, ${projectColor} 16%, transparent)`,
                  color: projectColor,
                }}
              >
                <ProjectIcon className="tw-size-6" />
              </div>
              <h2 className="hendrik-chat-empty__title">{projectName}</h2>
              <p className="hendrik-chat-empty__subtitle">
                Ask questions about this project&apos;s context, or use the suggestions below.
              </p>
              <div className="hendrik-chat-empty__actions">
                <button
                  type="button"
                  className="hendrik-chat-empty__action"
                  onClick={() =>
                    handleQuickAction("Summarize the key themes and structure of this project.")
                  }
                >
                  Summarise project
                </button>
                <button
                  type="button"
                  className="hendrik-chat-empty__action"
                  onClick={() =>
                    handleQuickAction("What are the open questions or gaps in this project?")
                  }
                >
                  Find gaps
                </button>
                <button
                  type="button"
                  className="hendrik-chat-empty__action"
                  onClick={() =>
                    handleQuickAction("Draft an outline for the next section of this project.")
                  }
                >
                  Draft outline
                </button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="hendrik-chat-empty">
          <div className="hendrik-chat-empty__center">
            <div className="hendrik-chat-empty__avatar" aria-hidden="true" />
            <h2 className="hendrik-chat-empty__title">{emptyTitle}</h2>
            <p className="hendrik-chat-empty__subtitle">{emptySubtitle}</p>
            <div className="hendrik-chat-empty__actions">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="hendrik-chat-empty__action"
                  onClick={() => handleQuickAction(action.prompt)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
          {showHelperComponents && settings.showRelevantNotes && (
            <div className="hendrik-chat-empty__footer">
              <RelevantNotes defaultOpen={false} key="relevant-notes-before-chat" />
            </div>
          )}
        </div>
      );
    }

    const getLoadingMessage = () => {
      if (loadingMessage) {
        return `${loadingMessage} ${loadingDots}`;
      }
      return `${waitingPhraseRef.current} ${loadingDots}`;
    };

    return (
      // eslint-disable-next-line tailwindcss/no-custom-classname
      <div className="hendrik-chat-stream tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        {showHelperComponents && settings.showRelevantNotes && (
          <div className="hendrik-chat-inline-helpers">
            <RelevantNotes defaultOpen={false} key="relevant-notes-in-chat" />
          </div>
        )}

        <div
          ref={scrollContainerCallbackRef}
          data-testid="chat-messages"
          className="tw-relative tw-flex tw-w-full tw-flex-1 tw-select-text tw-flex-col tw-items-start tw-justify-start tw-overflow-y-auto tw-scroll-smooth tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)]"
        >
          {chatHistory.map((message, index) => {
            const visibleMessages = chatHistory.filter((m) => m.isVisible);
            const isLastMessage = index === visibleMessages.length - 1;
            const shouldApplyMinHeight = isLastMessage && message.sender !== USER_SENDER;

            return (
              message.isVisible && (
                <div
                  key={getMessageKey(message, index)}
                  data-message-key={getMessageKey(message, index)}
                  className="tw-w-full"
                  style={{
                    minHeight: shouldApplyMinHeight ? `${containerMinHeight}px` : "auto",
                  }}
                >
                  <ChatSingleMessage
                    message={message}
                    app={app}
                    isStreaming={false}
                    onRegenerate={() => onRegenerate(index)}
                    onEdit={(newMessage) => onEdit(index, newMessage)}
                    onDelete={() => onDelete(index)}
                    staggerDelayMs={(index % 5) * 12}
                  />
                </div>
              )
            );
          })}
          {(currentAiMessage || loading) && (
            <div
              className="tw-w-full"
              style={{
                minHeight: `${containerMinHeight}px`,
              }}
            >
              <ChatSingleMessage
                key={streamingMessageId ?? "ai_message_streaming"}
                message={{
                  id: streamingMessageId ?? undefined,
                  sender: "AI",
                  message: currentAiMessage || getLoadingMessage(),
                  isVisible: true,
                  timestamp: null,
                }}
                app={app}
                isStreaming={true}
                onDelete={() => {}}
              />
            </div>
          )}
        </div>
      </div>
    );
  }
);

ChatMessages.displayName = "ChatMessages";

export default ChatMessages;

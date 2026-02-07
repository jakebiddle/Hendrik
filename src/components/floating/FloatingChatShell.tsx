import { AppContext, EventTargetContext } from "@/context";
import type HendrikPlugin from "@/main";
import type { ChatUIState } from "@/state/ChatUIState";
import type { FileParserManager } from "@/tools/FileParserManager";
import type ChainManager from "@/LLMProviders/chainManager";
import Chat from "@/components/Chat";
import { cn } from "@/lib/utils";
import { EVENT_NAMES } from "@/constants";
import * as Tooltip from "@radix-ui/react-tooltip";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface FloatingChatShellProps {
  chainManager: ChainManager;
  fileParserManager: FileParserManager;
  plugin: HendrikPlugin;
  chatUIState: ChatUIState;
}

/**
 * Floating launcher + panel shell that hosts the main Hendrik chat UI.
 */
const FloatingChatShell: React.FC<FloatingChatShellProps> = ({
  chainManager,
  fileParserManager,
  plugin,
  chatUIState,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const eventTargetRef = useRef<EventTarget>(new EventTarget());
  const saveHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Duration of the close animation in ms. */
  const CLOSE_DURATION = 300;

  /**
   * Toggle the floating panel visibility.
   */
  const toggleOpen = useCallback(() => {
    if (isOpen || isClosing) {
      setIsClosing(true);
      closingTimerRef.current = setTimeout(() => {
        setIsOpen(false);
        setIsClosing(false);
      }, CLOSE_DURATION);
    } else {
      setIsOpen(true);
    }
  }, [isOpen, isClosing]);

  /**
   * Close the floating panel with animation.
   */
  const closePanel = useCallback(() => {
    if (!isOpen || isClosing) return;
    setIsClosing(true);
    closingTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, CLOSE_DURATION);
  }, [isOpen, isClosing]);

  useEffect(() => {
    return () => {
      if (closingTimerRef.current) clearTimeout(closingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const eventTarget = eventTargetRef.current;
    plugin.registerChatEventTarget(eventTarget);
    eventTarget.dispatchEvent(new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      plugin.unregisterChatEventTarget(eventTarget);
    };
  }, [isOpen, plugin, closePanel]);

  const shellState = isClosing ? "closing" : isOpen ? "true" : "false";

  return (
    <div className="hendrik-floating-shell" data-open={shellState}>
      <div
        className={cn(
          "hendrik-floating-panel",
          isOpen && !isClosing && "hendrik-floating-panel--open",
          isClosing && "hendrik-floating-panel--closing"
        )}
        role="dialog"
        aria-hidden={isOpen && !isClosing ? "false" : "true"}
      >
        <div className="hendrik-floating-panel__content">
          <AppContext.Provider value={plugin.app}>
            <EventTargetContext.Provider value={eventTargetRef.current}>
              <Tooltip.Provider delayDuration={0}>
                <Chat
                  chainManager={chainManager}
                  updateUserMessageHistory={(newMessage) => {
                    plugin.updateUserMessageHistory(newMessage);
                  }}
                  fileParserManager={fileParserManager}
                  plugin={plugin}
                  onSaveChat={(saveFunction) => {
                    saveHandlerRef.current = saveFunction;
                  }}
                  chatUIState={chatUIState}
                  onClosePanel={closePanel}
                />
              </Tooltip.Provider>
            </EventTargetContext.Provider>
          </AppContext.Provider>
        </div>
      </div>

      <button
        type="button"
        className="hendrik-floating-launcher"
        onClick={toggleOpen}
        aria-label={isOpen ? "Close Hendrik" : "Open Hendrik"}
      >
        <span className="hendrik-floating-launcher__badge" aria-hidden="true" />
      </button>
    </div>
  );
};

export default FloatingChatShell;

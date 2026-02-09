import { AppContext, EventTargetContext } from "@/context";
import type HendrikPlugin from "@/main";
import type { ChatUIState } from "@/state/ChatUIState";
import type { FileParserManager } from "@/tools/FileParserManager";
import type ChainManager from "@/LLMProviders/chainManager";
import Chat from "@/components/Chat";
import { cn } from "@/lib/utils";
import { EVENT_NAMES } from "@/constants";
import * as Tooltip from "@radix-ui/react-tooltip";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface FloatingChatShellProps {
  chainManager: ChainManager;
  fileParserManager: FileParserManager;
  plugin: HendrikPlugin;
  chatUIState: ChatUIState;
}

/** Minimum distance (px) the pointer must move before it counts as a drag. */
const DRAG_THRESHOLD = 5;

/** Default offset from viewport edges. */
const DEFAULT_RIGHT = 24;
const DEFAULT_BOTTOM = 24;

/** Size of the launcher button in px. */
const LAUNCHER_SIZE = 54;

/** Gap between launcher and panel in px. */
const SHELL_GAP = 12;

/** Edge padding to keep from the viewport edges. */
const EDGE_MARGIN = 8;

/**
 * Determine which direction the panel should anchor relative to the
 * launcher so it stays fully within the viewport.
 */
function computePanelAnchor(
  right: number,
  bottom: number,
  panelW: number,
  panelH: number,
  vw: number,
  vh: number
): { h: "right" | "left"; v: "above" | "below" } {
  // The launcher's left-edge X position = vw - right - LAUNCHER_SIZE
  const launcherLeftX = vw - right - LAUNCHER_SIZE;
  // Panel right-aligned means its left edge = launcherLeftX + LAUNCHER_SIZE - panelW
  const panelLeftIfRight = launcherLeftX + LAUNCHER_SIZE - panelW;
  // Panel left-aligned means its right edge = launcherLeftX + panelW
  const panelRightIfLeft = launcherLeftX + panelW;

  // Choose horizontal: if right-aligned panel overflows left, flip to left-aligned
  // If left-aligned would overflow right, keep right-aligned (lesser evil)
  const h =
    panelLeftIfRight < EDGE_MARGIN && panelRightIfLeft <= vw - EDGE_MARGIN ? "left" : "right";

  // The launcher's top Y = vh - bottom - LAUNCHER_SIZE
  // Panel above: top edge = launcherTopY - SHELL_GAP - panelH
  const launcherTopY = vh - bottom - LAUNCHER_SIZE;
  const panelTopIfAbove = launcherTopY - SHELL_GAP - panelH;

  // Choose vertical: if panel above overflows top, flip below
  const v = panelTopIfAbove < EDGE_MARGIN ? "below" : "above";

  return { h, v };
}

/**
 * Floating launcher + panel shell that hosts the main Hendrik chat UI.
 * The launcher bubble can be dragged to reposition the chat anywhere on screen.
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

  // ── Drag state ───────────────────────────────────────────────
  const shellRef = useRef<HTMLDivElement>(null);
  const [shellPos, setShellPos] = useState<{ right: number; bottom: number }>({
    right: DEFAULT_RIGHT,
    bottom: DEFAULT_BOTTOM,
  });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    didDrag: boolean;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewportSize, setViewportSize] = useState({
    vw: window.innerWidth,
    vh: window.innerHeight,
  });

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

  // ── Drag handlers ──────────────────────────────────────────
  /**
   * Start tracking a potential drag when the user presses on the launcher.
   */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only primary button
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startRight: shellPos.right,
        startBottom: shellPos.bottom,
        didDrag: false,
      };
    },
    [shellPos]
  );

  /**
   * Move the shell while the pointer is held down past the drag threshold.
   * Clamps the bubble to stay within the viewport.
   */
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.didDrag && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
      return; // haven't moved far enough
    }
    drag.didDrag = true;
    setIsDragging(true);

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Shell is positioned via right/bottom, so invert deltas — clamp to keep bubble on-screen
    const newRight = Math.min(
      vw - LAUNCHER_SIZE - EDGE_MARGIN,
      Math.max(EDGE_MARGIN, drag.startRight - dx)
    );
    const newBottom = Math.min(
      vh - LAUNCHER_SIZE - EDGE_MARGIN,
      Math.max(EDGE_MARGIN, drag.startBottom - dy)
    );
    setShellPos({ right: newRight, bottom: newBottom });
  }, []);

  /**
   * Finish the drag. If the pointer barely moved, treat it as a click.
   */
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setIsDragging(false);

      if (drag?.didDrag) {
        // It was a drag — don't toggle the panel
        e.preventDefault();
        return;
      }
      // It was a click
      toggleOpen();
    },
    [toggleOpen]
  );

  const shellState = isClosing ? "closing" : isOpen ? "true" : "false";

  // ── Track viewport size ────────────────────────────────────
  useEffect(() => {
    const onResize = () => setViewportSize({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Derive shell position & panel anchor from state ────────
  const { shellStyle, panelStyle, panelAnchor } = useMemo(() => {
    const { vw, vh } = viewportSize;
    const { right, bottom } = shellPos;

    // Shell left/top (avoids CSS cascade conflicts with right/bottom rules)
    const left = vw - right - LAUNCHER_SIZE;
    const top = vh - bottom - LAUNCHER_SIZE;

    // Panel anchor direction
    const anchor = computePanelAnchor(right, bottom, 560, 860, vw, vh);

    // Panel inline styles
    const pStyle: React.CSSProperties = {};
    if (anchor.h === "right") {
      pStyle.right = 0;
      pStyle.left = "auto";
    } else {
      pStyle.left = 0;
      pStyle.right = "auto";
    }
    if (anchor.v === "above") {
      pStyle.bottom = "calc(100% + 12px)";
      pStyle.top = "auto";
    } else {
      pStyle.top = "calc(100% + 12px)";
      pStyle.bottom = "auto";
    }
    const originV = anchor.v === "above" ? "bottom" : "top";
    const originH = anchor.h === "right" ? "right" : "left";
    pStyle.transformOrigin = `${originV} ${originH}`;

    return {
      shellStyle: {
        left: `${left}px`,
        top: `${top}px`,
        right: "auto" as const,
        bottom: "auto" as const,
      },
      panelStyle: pStyle,
      panelAnchor: anchor,
    };
  }, [shellPos, viewportSize]);

  return (
    <div
      ref={shellRef}
      className="hendrik-floating-shell"
      data-open={shellState}
      data-panel-h={panelAnchor.h}
      data-panel-v={panelAnchor.v}
      style={shellStyle}
    >
      <div
        className={cn(
          "hendrik-floating-panel",
          isOpen && !isClosing && "hendrik-floating-panel--open",
          isClosing && "hendrik-floating-panel--closing"
        )}
        style={panelStyle}
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
        className={cn(
          "hendrik-floating-launcher",
          isDragging && "hendrik-floating-launcher--dragging"
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-label={isOpen ? "Close Hendrik" : "Open Hendrik"}
      >
        <span className="hendrik-floating-launcher__badge" aria-hidden="true" />
      </button>
    </div>
  );
};

export default FloatingChatShell;

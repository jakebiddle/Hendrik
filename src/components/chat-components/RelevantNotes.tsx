/* eslint-disable tailwindcss/no-custom-classname */
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatInput } from "@/context/ChatInputContext";
import { useActiveFile } from "@/hooks/useActiveFile";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import {
  findRelevantNotes,
  findRelevantNotesViaSC,
  RelevantNoteEntry,
} from "@/search/findRelevantNotes";
import { isSmartConnectionsAvailable } from "@/search/smartConnectionsRetriever";
import { useSettingsValue } from "@/settings/model";
import { ChevronDown, ChevronUp, PlusCircle, RefreshCcw, TriangleAlert } from "lucide-react";
import { Notice, TFile } from "obsidian";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";

interface RelevantNoteRowProps {
  note: RelevantNoteEntry;
  onAddToChat: () => void;
  onNavigateToNote: (openInNewLeaf: boolean) => void;
}

/**
 * Formats similarity scores into a compact percentage for row metadata.
 */
function formatSimilarityScore(score: number | null | undefined): string {
  if (score == null) {
    return "";
  }
  return `${(score * 100).toFixed(0)}% match`;
}

/**
 * Resolves an empty-state message based on source and index availability.
 */
function getEmptyStateMessage(useSmartConnectionsSource: boolean, hasIndex: boolean): string {
  if (useSmartConnectionsSource) {
    return "No related notes found from Smart Connections.";
  }

  if (!hasIndex) {
    return "No index available. Build index to view related notes.";
  }

  return "No relevant notes found.";
}

/**
 * Loads relevant notes using the active retrieval source.
 */
function useRelevantNotes(refresher: number, useSmartConnectionsSource: boolean) {
  const [relevantNotes, setRelevantNotes] = useState<RelevantNoteEntry[]>([]);
  const activeFile = useActiveFile();

  useEffect(() => {
    async function fetchNotes() {
      if (!activeFile?.path) {
        setRelevantNotes([]);
        return;
      }

      if (useSmartConnectionsSource) {
        try {
          const notes = await findRelevantNotesViaSC({ app, filePath: activeFile.path });
          setRelevantNotes(notes);
          return;
        } catch (error) {
          logWarn("Failed to fetch relevant notes via Smart Connections", error);
        }
      }

      try {
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        const db = await VectorStoreManager.getInstance().getDb();
        if (!db) {
          setRelevantNotes([]);
          return;
        }

        const notes = await findRelevantNotes({ db, filePath: activeFile.path });
        setRelevantNotes(notes);
      } catch (error) {
        logWarn("Failed to fetch relevant notes", error);
        setRelevantNotes([]);
      }
    }

    fetchNotes();
  }, [activeFile?.path, refresher, useSmartConnectionsSource]);

  return relevantNotes;
}

/**
 * Determines whether the active note has a local vector index available.
 */
function useHasIndex(notePath: string, refresher: number, useSmartConnectionsSource: boolean) {
  const [hasIndex, setHasIndex] = useState(true);

  useEffect(() => {
    if (!notePath) {
      return;
    }

    if (useSmartConnectionsSource) {
      setHasIndex(true);
      return;
    }

    async function fetchHasIndex() {
      try {
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        const has = await VectorStoreManager.getInstance().hasIndex(notePath);
        setHasIndex(has);
      } catch {
        setHasIndex(false);
      }
    }

    fetchHasIndex();
  }, [notePath, refresher, useSmartConnectionsSource]);

  return hasIndex;
}

/**
 * Single compact relevant-note row used in expanded mode.
 */
function RelevantNoteRow({ note, onAddToChat, onNavigateToNote }: RelevantNoteRowProps) {
  const similarity = formatSimilarityScore(note.metadata.similarityScore ?? null);

  return (
    <div className="copilot-relevant-note-row tw-flex tw-flex-col tw-gap-1 tw-rounded-md tw-px-2 tw-py-1.5">
      <div className="tw-flex tw-items-center tw-gap-2">
        <button
          type="button"
          className="copilot-relevant-note-row__title tw-min-w-0 tw-flex-1 tw-truncate tw-text-left tw-text-sm tw-font-medium tw-text-normal"
          title={note.document.title}
          onClick={(event) => {
            const openInNewLeaf = event.metaKey || event.ctrlKey;
            onNavigateToNote(openInNewLeaf);
          }}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              onNavigateToNote(true);
            }
          }}
        >
          {note.document.title}
        </button>

        {similarity && (
          <span className="copilot-relevant-note-row__score tw-shrink-0 tw-text-[11px] tw-text-muted">
            {similarity}
          </span>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost2"
              size="icon"
              onClick={onAddToChat}
              className="tw-size-6 tw-shrink-0"
            >
              <PlusCircle className="tw-size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add to Chat</TooltipContent>
        </Tooltip>
      </div>

      <div className="copilot-relevant-note-row__path tw-truncate tw-text-xs tw-text-muted">
        {note.document.path}
      </div>
    </div>
  );
}

export const RelevantNotes = memo(
  ({ className, defaultOpen = false }: { className?: string; defaultOpen?: boolean }) => {
    const settings = useSettingsValue();
    const [refresher, setRefresher] = useState(0);
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const activeFile = useActiveFile();
    const chatInput = useChatInput();

    const useSmartConnectionsSource =
      settings.useSmartConnections && isSmartConnectionsAvailable(app);

    const relevantNotes = useRelevantNotes(refresher, useSmartConnectionsSource);
    const hasIndex = useHasIndex(activeFile?.path ?? "", refresher, useSmartConnectionsSource);

    const compactNotes = useMemo(() => relevantNotes.slice(0, 3), [relevantNotes]);
    const visibleRows = useMemo(() => relevantNotes.slice(0, 8), [relevantNotes]);

    /**
     * Navigates to the selected note and preserves split behavior for modifier keys.
     */
    const navigateToNote = useCallback((notePath: string, openInNewLeaf = false) => {
      const file = app.vault.getAbstractFileByPath(notePath);
      if (file instanceof TFile) {
        const leaf = app.workspace.getLeaf(openInNewLeaf);
        leaf.openFile(file);
      }
    }, []);

    /**
     * Inserts a selected note into the chat composer.
     */
    const addToChat = useCallback(
      (notePath: string) => {
        chatInput.focusInput();
        window.requestAnimationFrame(() => {
          chatInput.insertTextWithPills(`[[${notePath}]]`, true);
        });
      },
      [chatInput]
    );

    /**
     * Rebuilds index for the active note when local vector indexing is the source.
     */
    const refreshIndex = useCallback(async () => {
      if (!activeFile || useSmartConnectionsSource) {
        return;
      }

      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      await VectorStoreManager.getInstance().reindexFile(activeFile);
      new Notice(`Refreshed index for ${activeFile.basename}`);
      setRefresher((count) => count + 1);
    }, [activeFile, useSmartConnectionsSource]);

    return (
      <div
        className={cn(
          "copilot-relevant-notes tw-w-full tw-border tw-border-solid tw-border-transparent tw-border-b-border tw-pb-2",
          className
        )}
      >
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="copilot-relevant-notes__header tw-flex tw-items-center tw-justify-between tw-gap-2 tw-pb-2 tw-pl-1">
            <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
              <span className="tw-font-semibold tw-text-normal">Relevant Notes</span>
              <span className="copilot-relevant-notes__source tw-shrink-0 tw-text-[10px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted">
                {useSmartConnectionsSource ? "Smart Connections" : "Vault Index"}
              </span>
              <HelpTooltip
                content="Use matching notes as quick context. Click a title to open it."
                contentClassName="tw-w-64"
                buttonClassName="tw-size-4 tw-text-muted"
              />

              {!useSmartConnectionsSource && !hasIndex && (
                <HelpTooltip content="Note has not been indexed" side="bottom">
                  <TriangleAlert className="tw-size-4 tw-text-warning" />
                </HelpTooltip>
              )}
            </div>

            <div className="tw-flex tw-items-center">
              {!useSmartConnectionsSource && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost2" size="icon" onClick={refreshIndex}>
                      <RefreshCcw className="tw-size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Reindex Current Note</TooltipContent>
                </Tooltip>
              )}

              {relevantNotes.length > 0 && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost2" size="icon">
                    {isOpen ? (
                      <ChevronUp className="tw-size-5" />
                    ) : (
                      <ChevronDown className="tw-size-5" />
                    )}
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>

          {relevantNotes.length === 0 && (
            <div className="copilot-relevant-notes__empty tw-px-1">
              <span className="tw-text-xs tw-text-muted">
                {getEmptyStateMessage(useSmartConnectionsSource, hasIndex)}
              </span>
            </div>
          )}

          {!isOpen && relevantNotes.length > 0 && (
            <div className="copilot-relevant-notes__compact tw-flex tw-flex-wrap tw-gap-1 tw-px-1">
              {compactNotes.map((note) => (
                <button
                  key={note.document.path}
                  type="button"
                  className="copilot-relevant-notes__chip tw-max-w-40 tw-truncate tw-rounded-full tw-px-2 tw-py-0.5 tw-text-xs"
                  title={note.document.title}
                  onClick={(event) => {
                    const openInNewLeaf = event.metaKey || event.ctrlKey;
                    navigateToNote(note.document.path, openInNewLeaf);
                  }}
                >
                  {note.document.title}
                </button>
              ))}
              {relevantNotes.length > compactNotes.length && (
                <span className="copilot-relevant-notes__more tw-text-xs tw-text-muted">
                  +{relevantNotes.length - compactNotes.length} more
                </span>
              )}
            </div>
          )}

          <CollapsibleContent>
            <div className="copilot-relevant-notes__rows tw-flex tw-max-h-60 tw-flex-col tw-gap-1 tw-overflow-y-auto tw-p-1">
              {visibleRows.map((note) => (
                <RelevantNoteRow
                  note={note}
                  key={note.document.path}
                  onAddToChat={() => addToChat(note.document.path)}
                  onNavigateToNote={(openInNewLeaf: boolean) =>
                    navigateToNote(note.document.path, openInNewLeaf)
                  }
                />
              ))}
              {relevantNotes.length > visibleRows.length && (
                <div className="tw-px-2 tw-pt-1 tw-text-xs tw-text-muted">
                  +{relevantNotes.length - visibleRows.length} more related notes
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }
);

RelevantNotes.displayName = "RelevantNotes";

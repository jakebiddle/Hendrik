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

const RELEVANT_NOTES_CACHE_TTL_MS = 60_000;
const HAS_INDEX_CACHE_TTL_MS = 60_000;
const DEFAULT_FETCH_DELAY_MS = 140;

type RelevantNotesSource = "smart-connections" | "vault-index";

interface CacheEntry<T> {
  value: T;
  storedAtMs: number;
}

const relevantNotesCache = new Map<string, CacheEntry<RelevantNoteEntry[]>>();
const relevantNotesInFlight = new Map<string, Promise<RelevantNoteEntry[]>>();
const hasIndexCache = new Map<string, CacheEntry<boolean>>();
const hasIndexInFlight = new Map<string, Promise<boolean>>();

export interface RelevantNoteRowProps {
  note: RelevantNoteEntry;
  showEntityEvidence: boolean;
  onAddToChat: () => void;
  onNavigateToNote: (openInNewLeaf: boolean) => void;
}

/**
 * Builds a stable cache key for note retrieval source and path.
 */
function getRelevantNotesCacheKey(filePath: string, source: RelevantNotesSource): string {
  return `${source}::${filePath}`;
}

/**
 * Returns a cached value if it is still inside the configured TTL.
 */
function getFreshCachedValue<T>(
  cache: Map<string, CacheEntry<T>>,
  cacheKey: string,
  ttlMs: number
): T | null {
  const entry = cache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.storedAtMs > ttlMs) {
    cache.delete(cacheKey);
    return null;
  }

  return entry.value;
}

/**
 * Stores a value in the given cache with a timestamp.
 */
function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, cacheKey: string, value: T): void {
  cache.set(cacheKey, { value, storedAtMs: Date.now() });
}

/**
 * Reuses an in-flight request for the same key, or starts a new request once.
 */
async function getOrStartRequest<T>(
  inFlightCache: Map<string, Promise<T>>,
  cacheKey: string,
  requestFactory: () => Promise<T>
): Promise<T> {
  const existingRequest = inFlightCache.get(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = requestFactory().finally(() => {
    inFlightCache.delete(cacheKey);
  });

  inFlightCache.set(cacheKey, request);
  return request;
}

/**
 * Defers expensive work so mode transitions can render first.
 */
function scheduleDeferredTask(task: () => void, delayMs: number): () => void {
  const timeoutId = globalThis.setTimeout(task, delayMs);
  return () => {
    globalThis.clearTimeout(timeoutId);
  };
}

/**
 * Clears cached relevant-note and index state for a specific note path.
 */
function invalidateRelevantNoteCaches(notePath: string): void {
  if (!notePath) {
    return;
  }

  for (const source of ["smart-connections", "vault-index"] as const) {
    const cacheKey = getRelevantNotesCacheKey(notePath, source);
    relevantNotesCache.delete(cacheKey);
    relevantNotesInFlight.delete(cacheKey);
  }

  hasIndexCache.delete(notePath);
  hasIndexInFlight.delete(notePath);
}

/**
 * Loads relevant notes for a file using the configured source.
 */
async function fetchRelevantNotesForFile({
  filePath,
  useSmartConnectionsSource,
}: {
  filePath: string;
  useSmartConnectionsSource: boolean;
}): Promise<RelevantNoteEntry[]> {
  if (useSmartConnectionsSource) {
    try {
      return await findRelevantNotesViaSC({ app, filePath });
    } catch (error) {
      logWarn("Failed to fetch relevant notes via Smart Connections", error);
    }
  }

  try {
    const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
    const db = await VectorStoreManager.getInstance().getDb();
    if (!db) {
      return [];
    }

    return await findRelevantNotes({ db, filePath });
  } catch (error) {
    logWarn("Failed to fetch relevant notes", error);
    return [];
  }
}

/**
 * Checks if a note has an index in the local vector store.
 */
async function fetchHasIndex(notePath: string): Promise<boolean> {
  try {
    const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
    return await VectorStoreManager.getInstance().hasIndex(notePath);
  } catch {
    return false;
  }
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
    return "No related scrolls uncovered via Smart Connections.";
  }

  if (!hasIndex) {
    return "The archives await cataloguing. Build the index to discover connections.";
  }

  return "No related scrolls uncovered.";
}

/**
 * Loads relevant notes using the active retrieval source.
 */
function useRelevantNotes(refresher: number, useSmartConnectionsSource: boolean, isOpen: boolean) {
  const [relevantNotes, setRelevantNotes] = useState<RelevantNoteEntry[]>([]);
  const activeFile = useActiveFile();

  useEffect(() => {
    const notePath = activeFile?.path;
    if (!notePath) {
      setRelevantNotes([]);
      return;
    }

    const source: RelevantNotesSource = useSmartConnectionsSource
      ? "smart-connections"
      : "vault-index";
    const cacheKey = getRelevantNotesCacheKey(notePath, source);

    const cachedNotes = getFreshCachedValue(
      relevantNotesCache,
      cacheKey,
      RELEVANT_NOTES_CACHE_TTL_MS
    );
    if (cachedNotes) {
      setRelevantNotes(cachedNotes);
      return;
    }

    setRelevantNotes([]);
    let cancelled = false;
    const cancelDeferredFetch = scheduleDeferredTask(
      () => {
        void (async () => {
          const notes = await getOrStartRequest(relevantNotesInFlight, cacheKey, async () => {
            const fetchedNotes = await fetchRelevantNotesForFile({
              filePath: notePath,
              useSmartConnectionsSource,
            });
            setCachedValue(relevantNotesCache, cacheKey, fetchedNotes);
            return fetchedNotes;
          });

          if (!cancelled) {
            setRelevantNotes(notes);
          }
        })();
      },
      isOpen ? 0 : DEFAULT_FETCH_DELAY_MS
    );

    return () => {
      cancelled = true;
      cancelDeferredFetch();
    };
  }, [activeFile?.path, refresher, useSmartConnectionsSource, isOpen]);

  return relevantNotes;
}

/**
 * Determines whether the active note has a local vector index available.
 */
function useHasIndex({
  notePath,
  refresher,
  useSmartConnectionsSource,
  shouldCheck,
}: {
  notePath: string;
  refresher: number;
  useSmartConnectionsSource: boolean;
  shouldCheck: boolean;
}) {
  const [hasIndex, setHasIndex] = useState(true);

  useEffect(() => {
    if (!notePath) {
      setHasIndex(true);
      return;
    }

    if (useSmartConnectionsSource || !shouldCheck) {
      setHasIndex(true);
      return;
    }

    const cachedHasIndex = getFreshCachedValue(hasIndexCache, notePath, HAS_INDEX_CACHE_TTL_MS);
    if (cachedHasIndex !== null) {
      setHasIndex(cachedHasIndex);
      return;
    }

    let cancelled = false;
    const cancelDeferredFetch = scheduleDeferredTask(() => {
      void (async () => {
        const has = await getOrStartRequest(hasIndexInFlight, notePath, async () => {
          const hasLocalIndex = await fetchHasIndex(notePath);
          setCachedValue(hasIndexCache, notePath, hasLocalIndex);
          return hasLocalIndex;
        });

        if (!cancelled) {
          setHasIndex(has);
        }
      })();
    }, DEFAULT_FETCH_DELAY_MS);

    return () => {
      cancelled = true;
      cancelDeferredFetch();
    };
  }, [notePath, refresher, useSmartConnectionsSource, shouldCheck]);

  return hasIndex;
}

/**
 * Single compact relevant-note row used in expanded mode.
 */
export function RelevantNoteRow({
  note,
  showEntityEvidence,
  onAddToChat,
  onNavigateToNote,
}: RelevantNoteRowProps) {
  const similarity = formatSimilarityScore(note.metadata.similarityScore ?? null);
  const entityEvidence = note.metadata.entityEvidence;
  const relationTypes = entityEvidence?.relationTypes || [];
  const showEntityBadges = showEntityEvidence && relationTypes.length > 0;

  return (
    <div className="hendrik-relevant-note-row tw-flex tw-flex-col tw-gap-1 tw-rounded-md tw-px-2 tw-py-1.5">
      <div className="tw-flex tw-items-center tw-gap-2">
        <button
          type="button"
          className="hendrik-relevant-note-row__title tw-min-w-0 tw-flex-1 tw-truncate tw-text-left tw-text-sm tw-font-medium tw-text-normal"
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
          <span className="hendrik-relevant-note-row__score tw-shrink-0 tw-text-[11px] tw-text-muted">
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

      <div className="hendrik-relevant-note-row__path tw-truncate tw-text-xs tw-text-muted">
        {note.document.path}
      </div>

      {showEntityBadges && (
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1">
          {relationTypes.slice(0, 3).map((relation) => (
            <span
              key={relation}
              className="tw-rounded tw-px-1.5 tw-py-0.5 tw-text-[10px] tw-font-medium tw-text-muted tw-bg-muted/40"
            >
              {relation}
            </span>
          ))}
          {typeof entityEvidence?.relationCount === "number" &&
            entityEvidence.relationCount > 0 && (
              <span className="tw-text-[10px] tw-text-muted">
                {entityEvidence.relationCount} graph signals
              </span>
            )}
        </div>
      )}
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

    const relevantNotes = useRelevantNotes(refresher, useSmartConnectionsSource, isOpen);
    const hasIndex = useHasIndex({
      notePath: activeFile?.path ?? "",
      refresher,
      useSmartConnectionsSource,
      shouldCheck: relevantNotes.length === 0,
    });

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
      invalidateRelevantNoteCaches(activeFile.path);
      new Notice(`Refreshed index for ${activeFile.basename}`);
      setRefresher((count) => count + 1);
    }, [activeFile, useSmartConnectionsSource]);

    return (
      <div
        className={cn(
          "hendrik-relevant-notes tw-w-full tw-border tw-border-solid tw-border-transparent tw-border-b-border tw-pb-2",
          className
        )}
      >
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="hendrik-relevant-notes__header tw-flex tw-items-center tw-justify-between tw-gap-2 tw-pb-2 tw-pl-1">
            <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
              <span className="tw-font-semibold tw-text-normal">Relevant Notes</span>
              <span className="hendrik-relevant-notes__source tw-shrink-0 tw-text-[10px] tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted">
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
            <div className="hendrik-relevant-notes__empty tw-px-1">
              <span className="tw-text-xs tw-text-muted">
                {getEmptyStateMessage(useSmartConnectionsSource, hasIndex)}
              </span>
            </div>
          )}

          {!isOpen && relevantNotes.length > 0 && (
            <div className="hendrik-relevant-notes__compact tw-flex tw-flex-wrap tw-gap-1 tw-px-1">
              {compactNotes.map((note) => (
                <button
                  key={note.document.path}
                  type="button"
                  className="hendrik-relevant-notes__chip tw-max-w-full tw-truncate tw-rounded-full tw-px-2 tw-py-0.5 tw-text-xs"
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
                <span className="hendrik-relevant-notes__more tw-text-xs tw-text-muted">
                  +{relevantNotes.length - compactNotes.length} more
                </span>
              )}
            </div>
          )}

          <CollapsibleContent>
            <div className="hendrik-relevant-notes__rows tw-flex tw-max-h-60 tw-flex-col tw-gap-1 tw-overflow-y-auto tw-p-1">
              {visibleRows.map((note) => (
                <RelevantNoteRow
                  note={note}
                  key={note.document.path}
                  showEntityEvidence={settings.enableEntityEvidencePanel}
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

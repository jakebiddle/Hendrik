import { Button } from "@/components/ui/button";
import { ChainType } from "@/chainFactory";
import { logError } from "@/logger";
import ChainManager from "@/LLMProviders/chainManager";
import { ToolCallingChainRunner } from "@/LLMProviders/chainRunner/ToolCallingChainRunner";
import {
  ENTITY_SEMANTIC_PREDICATES,
  ApplySemanticBatchResult,
  SemanticRelationBatchService,
  SemanticRelationProposalStore,
  SemanticRelationProposalSourceAdapter,
  SemanticRelationDraftBatch,
  SemanticRelationDraftRow,
} from "@/search/entityGraph";
import { getSettings } from "@/settings/model";
import { ChatMessage, MessageContext } from "@/types/message";
import { App, Modal, Notice, TFile } from "obsidian";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface HendrikPluginLike {
  chatUIState?: {
    sendMessage: (
      displayText: string,
      context: MessageContext,
      chainType: ChainType,
      includeActiveNote?: boolean,
      includeActiveWebTab?: boolean,
      content?: any[],
      updateLoadingMessage?: (message: string) => void
    ) => Promise<string>;
    getLLMMessage: (id: string) => ChatMessage | undefined;
    deleteMessage: (id: string) => Promise<boolean>;
  };
  projectManager?: {
    getCurrentChainManager?: () => ChainManager;
  };
}

interface SemanticRelationBatchEditorContentProps {
  app: App;
  onClose: () => void;
  includeVaultDrafts: boolean;
  proposalAdapters: SemanticRelationProposalSourceAdapter[];
}

interface SemanticGenerationDiagnostics {
  extractedCount: number;
  acceptedCount: number;
  totalQueued: number;
}

export interface SemanticRelationBatchEditorModalOptions {
  includeVaultDrafts?: boolean;
  proposalAdapters?: SemanticRelationProposalSourceAdapter[];
}

/**
 * Returns a deep-cloned row array for safe in-place editing.
 */
function cloneRows(rows: SemanticRelationDraftRow[]): SemanticRelationDraftRow[] {
  return rows.map((row) => ({ ...row }));
}

/**
 * Creates one default manual draft row.
 */
function createManualRow(seed: number): SemanticRelationDraftRow {
  return {
    id: `manual-${Date.now()}-${seed}`,
    notePath: "",
    sourceField: "relations",
    predicate: "allied_with",
    targetPath: "",
    confidence: 70,
    proposalSource: "manual",
  };
}

/**
 * Builds an AI prompt used to generate semantic relation proposals into the queue.
 */
function buildSemanticProposalGenerationPrompt(): string {
  const allowedPredicates = ENTITY_SEMANTIC_PREDICATES.join(", ");
  return [
    "Analyze the vault and generate semantic worldbuilding relation proposals.",
    "Use available retrieval tools as needed.",
    'When done, call submitSemanticRelationProposals using object args with the shape: {"proposals":[...]}.',
    "Each proposal must include: notePath, predicate, targetPath.",
    `Use ONLY predicate values from this exact list: ${allowedPredicates}.`,
    "Include confidence (0-100) when possible.",
    "Do not write frontmatter directly in this step.",
  ].join(" ");
}

/**
 * Resolves the loaded Hendrik plugin instance from the Obsidian plugin registry.
 */
function getHendrikPlugin(app: App): HendrikPluginLike | null {
  const pluginRegistry = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } })
    .plugins;
  const plugin = pluginRegistry?.plugins?.hendrik;
  if (!plugin || typeof plugin !== "object") {
    return null;
  }

  return plugin as HendrikPluginLike;
}

/**
 * Builds validation warnings for one editable row.
 */
function getRowWarnings(app: App, row: SemanticRelationDraftRow): string[] {
  const warnings: string[] = [];

  if (!row.notePath.trim()) {
    warnings.push("Missing note path");
  }
  if (!row.targetPath.trim()) {
    warnings.push("Missing target path");
  }

  if (row.notePath.trim()) {
    const noteFile = app.vault.getAbstractFileByPath(row.notePath.trim());
    if (!(noteFile instanceof TFile) || noteFile.extension !== "md") {
      warnings.push("Source note not found");
    }
  }

  if (row.targetPath.trim()) {
    const resolvedTarget = app.metadataCache.getFirstLinkpathDest(
      row.targetPath.trim(),
      row.notePath.trim() || ""
    );
    if (!(resolvedTarget instanceof TFile) || resolvedTarget.extension !== "md") {
      warnings.push("Target note not resolved");
    }
  }

  if (
    row.notePath.trim().length > 0 &&
    row.targetPath.trim().length > 0 &&
    row.notePath.trim() === row.targetPath.trim()
  ) {
    warnings.push("Self-relation detected");
  }

  if (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 100) {
    warnings.push("Confidence must be 0-100");
  }

  return warnings;
}

/**
 * Editable semantic relation batch modal content.
 */
function SemanticRelationBatchEditorContent({
  app,
  onClose,
  includeVaultDrafts,
  proposalAdapters,
}: SemanticRelationBatchEditorContentProps): React.ReactElement {
  const service = useMemo(() => new SemanticRelationBatchService(app), [app]);
  const [batches, setBatches] = useState<SemanticRelationDraftBatch[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [rows, setRows] = useState<SemanticRelationDraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applyReport, setApplyReport] = useState<ApplySemanticBatchResult | null>(null);
  const [generationDiagnostics, setGenerationDiagnostics] =
    useState<SemanticGenerationDiagnostics | null>(null);

  /**
   * Loads batches from vault frontmatter.
   */
  const loadBatches = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setApplyReport(null);
    try {
      const nextBatches = await service.buildDraftBatches({
        includeVaultDrafts,
        proposalAdapters,
      });
      setBatches(nextBatches);
      setBatchIndex(0);
      setRows(cloneRows(nextBatches[0]?.rows || []));
    } catch (error) {
      logError("[SemanticRelationBatchEditorModal] Failed to build draft batches", error);
      setLoadError(String(error));
      setBatches([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [includeVaultDrafts, proposalAdapters, service]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const activeBatch = batches[batchIndex] || null;

  /**
   * Changes the active batch index and resets row edits to that batch.
   */
  const switchBatch = (nextIndex: number) => {
    const clampedIndex = Math.min(Math.max(nextIndex, 0), Math.max(0, batches.length - 1));
    setBatchIndex(clampedIndex);
    setRows(cloneRows(batches[clampedIndex]?.rows || []));
  };

  /**
   * Updates one row field by index.
   */
  const updateRow = (rowIndex: number, updates: Partial<SemanticRelationDraftRow>) => {
    setRows((prev) => {
      const next = cloneRows(prev);
      if (!next[rowIndex]) {
        return prev;
      }
      next[rowIndex] = { ...next[rowIndex], ...updates };
      return next;
    });
  };

  /**
   * Removes one row from the current editable batch.
   */
  const removeRow = (rowIndex: number) => {
    setRows((prev) => prev.filter((_, index) => index !== rowIndex));
  };

  /**
   * Adds a new editable row to current batch.
   */
  const addRow = () => {
    setRows((prev) => [...prev, createManualRow(prev.length + 1)]);
  };

  /**
   * Starts a manual editable batch when no draft rows are available.
   */
  const startManualBatch = () => {
    const manualRows = [createManualRow(1)];
    const manualBatch: SemanticRelationDraftBatch = {
      id: "semantic-batch-manual",
      index: 0,
      startRow: 1,
      endRow: manualRows.length,
      totalRows: manualRows.length,
      rows: manualRows,
    };
    setBatches([manualBatch]);
    setBatchIndex(0);
    setRows(cloneRows(manualRows));
    setApplyReport(null);
  };

  /**
   * Applies edited rows for current batch into frontmatter.
   */
  const applyCurrentBatch = async () => {
    setApplying(true);
    try {
      const result = await service.applyEditedBatch(rows);
      setApplyReport(result);
      const errorSuffix = result.errors.length > 0 ? ` Errors: ${result.errors.join(" | ")}` : "";
      new Notice(
        `Applied semantic batch: notes=${result.updatedNotes}, rows=${result.writtenRelations}, skipped=${result.skippedRows}.${errorSuffix}`,
        12000
      );
      await loadBatches();
    } catch (error) {
      logError("[SemanticRelationBatchEditorModal] Failed to apply batch", error);
      new Notice(`Failed to apply batch: ${String(error)}`, 8000);
    } finally {
      setApplying(false);
    }
  };

  /**
   * Runs one AI pass that queues semantic relation proposals, then reloads the draft batches.
   */
  const generateWithAi = async () => {
    setGenerating(true);
    setLoadError(null);
    setGenerationDiagnostics(null);
    let generatedMessageId: string | null = null;
    let streamedResponse = "";

    try {
      const plugin = getHendrikPlugin(app);
      const chainManager = plugin?.projectManager?.getCurrentChainManager?.();
      const chatUIState = plugin?.chatUIState;
      if (!chainManager || !chatUIState) {
        throw new Error("Hendrik chain manager is not available.");
      }

      await chainManager.setChain(ChainType.TOOL_CALLING_CHAIN);

      const emptyContext: MessageContext = {
        notes: [],
        urls: [],
        tags: [],
        folders: [],
        selectedTextContexts: [],
        webTabs: [],
      };

      generatedMessageId = await chatUIState.sendMessage(
        buildSemanticProposalGenerationPrompt(),
        emptyContext,
        ChainType.TOOL_CALLING_CHAIN,
        false,
        false
      );

      const llmMessage = chatUIState.getLLMMessage(generatedMessageId);
      if (!llmMessage) {
        throw new Error("Failed to prepare AI generation message.");
      }

      const proposalStore = SemanticRelationProposalStore.getInstance();
      const beforeCount = proposalStore.getAllProposals().length;

      const runner = new ToolCallingChainRunner(chainManager);

      const abortController = new AbortController();
      await runner.run(
        llmMessage,
        abortController,
        (message) => {
          const nextMessage = String(message || "");
          if (!nextMessage) {
            return;
          }

          if (!streamedResponse) {
            streamedResponse = nextMessage;
            return;
          }

          if (nextMessage.startsWith(streamedResponse)) {
            streamedResponse = nextMessage;
            return;
          }

          streamedResponse += nextMessage;
        },
        (message) => {
          if (typeof message.message === "string" && message.message.trim().length > 0) {
            streamedResponse = message.message;
          }
        },
        { debug: getSettings().debug }
      );

      let acceptedFromResponse = 0;
      let extractedFromResponse = 0;
      if (streamedResponse.trim().length > 0) {
        extractedFromResponse =
          proposalStore.extractSemanticRelationProposalsFromToolText(streamedResponse).length;
        acceptedFromResponse = proposalStore.ingestFromToolOutput(
          "submitSemanticRelationProposals",
          streamedResponse
        );
      }

      const afterCount = proposalStore.getAllProposals().length;
      const addedCount = Math.max(0, afterCount - beforeCount);
      setGenerationDiagnostics({
        extractedCount: extractedFromResponse,
        acceptedCount: acceptedFromResponse,
        totalQueued: afterCount,
      });

      await loadBatches();
      if (addedCount > 0) {
        new Notice(
          `AI semantic proposal generation finished. Added ${addedCount} proposal(s). Accepted ${acceptedFromResponse}/${Math.max(acceptedFromResponse, extractedFromResponse)} from response text.`,
          6000
        );
      } else {
        new Notice(
          "AI generation finished, but no valid proposals were queued. Ensure generated predicates match the allowed semantic predicate list.",
          10000
        );
      }
    } catch (error) {
      logError("[SemanticRelationBatchEditorModal] AI proposal generation failed", error);
      setLoadError(`AI generation failed: ${String(error)}`);
      new Notice(`AI generation failed: ${String(error)}`, 8000);
    } finally {
      try {
        const plugin = getHendrikPlugin(app);
        if (generatedMessageId && plugin?.chatUIState) {
          await plugin.chatUIState.deleteMessage(generatedMessageId);
        }
      } catch (cleanupError) {
        logError(
          "[SemanticRelationBatchEditorModal] Failed to clean generation message",
          cleanupError
        );
      }
      setGenerating(false);
    }
  };

  return (
    <div className="tw-flex tw-max-h-[75vh] tw-min-h-[480px] tw-flex-col tw-gap-3">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-text-sm tw-text-muted">
          Edit semantic relation preview rows before writing to frontmatter.
        </div>
        <div className="tw-flex tw-gap-2">
          <Button
            variant="secondary"
            onClick={() => void generateWithAi()}
            disabled={loading || applying || generating}
          >
            {generating ? "Generating..." : "Generate with AI"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void loadBatches()}
            disabled={loading || applying || generating}
          >
            Refresh Draft
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={applying || generating}>
            Close
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3 tw-text-sm tw-text-muted">
          Building semantic draft batches...
        </div>
      ) : loadError ? (
        <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3 tw-text-sm tw-text-error">
          {loadError}
        </div>
      ) : batches.length === 0 ? (
        <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3 tw-text-sm tw-text-muted">
          <div>No semantic relation rows found from configured sources.</div>
          <div className="tw-mt-2 tw-flex tw-gap-2">
            <Button variant="secondary" onClick={startManualBatch} disabled={applying}>
              Add First Row Manually
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-2">
            <div className="tw-text-sm tw-text-normal">
              Batch {batchIndex + 1} of {batches.length}
              {activeBatch
                ? ` · Rows ${activeBatch.startRow}-${activeBatch.endRow} of ${activeBatch.totalRows}`
                : ""}
            </div>
            <div className="tw-flex tw-gap-2">
              <Button
                variant="secondary"
                onClick={() => switchBatch(batchIndex - 1)}
                disabled={batchIndex <= 0 || applying}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                onClick={() => switchBatch(batchIndex + 1)}
                disabled={batchIndex >= batches.length - 1 || applying}
              >
                Next
              </Button>
            </div>
          </div>

          <div className="tw-overflow-auto tw-rounded-md tw-border tw-border-solid tw-border-border">
            <table className="tw-w-full tw-min-w-[1040px] tw-text-sm">
              <thead className="tw-bg-muted">
                <tr>
                  <th className="tw-p-2 tw-text-left">Note</th>
                  <th className="tw-p-2 tw-text-left">Predicate</th>
                  <th className="tw-p-2 tw-text-left">Target</th>
                  <th className="tw-p-2 tw-text-left">Confidence</th>
                  <th className="tw-p-2 tw-text-left">Source Field</th>
                  <th className="tw-p-2 tw-text-left">Origin</th>
                  <th className="tw-p-2 tw-text-left">Validation</th>
                  <th className="tw-p-2 tw-text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const rowWarnings = getRowWarnings(app, row);
                  return (
                    <tr key={row.id} className="tw-border-t tw-border-solid tw-border-border">
                      <td className="tw-p-2">
                        <input
                          className="tw-h-8 tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-2"
                          value={row.notePath}
                          onChange={(event) =>
                            updateRow(rowIndex, { notePath: event.target.value })
                          }
                          disabled={applying}
                        />
                      </td>
                      <td className="tw-p-2">
                        <select
                          className="tw-h-8 tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-2"
                          value={row.predicate}
                          onChange={(event) =>
                            updateRow(rowIndex, {
                              predicate: event.target
                                .value as SemanticRelationDraftRow["predicate"],
                            })
                          }
                          disabled={applying}
                        >
                          {ENTITY_SEMANTIC_PREDICATES.map((predicate) => (
                            <option key={predicate} value={predicate}>
                              {predicate}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="tw-p-2">
                        <input
                          className="tw-h-8 tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-2"
                          value={row.targetPath}
                          onChange={(event) =>
                            updateRow(rowIndex, { targetPath: event.target.value })
                          }
                          disabled={applying}
                        />
                      </td>
                      <td className="tw-p-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="tw-h-8 tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-2"
                          value={row.confidence}
                          onChange={(event) => {
                            const nextConfidence = Number(event.target.value);
                            updateRow(rowIndex, {
                              confidence: Number.isFinite(nextConfidence)
                                ? Math.max(0, Math.min(100, Math.floor(nextConfidence)))
                                : 0,
                            });
                          }}
                          disabled={applying}
                        />
                      </td>
                      <td className="tw-p-2">
                        <input
                          className="tw-h-8 tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-2"
                          value={row.sourceField}
                          onChange={(event) =>
                            updateRow(rowIndex, { sourceField: event.target.value })
                          }
                          disabled={applying}
                        />
                      </td>
                      <td className="tw-p-2">
                        <span className="tw-inline-flex tw-rounded-md tw-bg-secondary tw-px-2 tw-py-1 tw-text-xs tw-text-muted">
                          {row.proposalSource || "unknown"}
                        </span>
                      </td>
                      <td className="tw-p-2">
                        {rowWarnings.length === 0 ? (
                          <span className="tw-text-xs tw-text-success">Ready</span>
                        ) : (
                          <div className="tw-text-xs tw-text-error">{rowWarnings.join(" · ")}</div>
                        )}
                      </td>
                      <td className="tw-p-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRow(rowIndex)}
                          disabled={applying}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
            <Button variant="secondary" onClick={addRow} disabled={applying}>
              Add Row
            </Button>
            <Button onClick={() => void applyCurrentBatch()} disabled={applying}>
              {applying ? "Applying..." : "Apply Edited Batch"}
            </Button>
          </div>

          {applyReport && (
            <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3 tw-text-sm">
              <div className="tw-font-medium tw-text-normal">
                Apply report · notes {applyReport.updatedNotes} · applied rows{" "}
                {applyReport.writtenRelations} · skipped {applyReport.skippedRows} · errors{" "}
                {applyReport.rowResults.filter((row) => row.status === "error").length}
              </div>
              <div className="tw-mt-2 tw-max-h-40 tw-space-y-1 tw-overflow-auto tw-text-xs tw-text-muted">
                {applyReport.rowResults.slice(0, 40).map((row) => (
                  <div key={`${row.rowId}-${row.status}-${row.targetPath}`}>
                    <span
                      className={
                        row.status === "applied"
                          ? "tw-text-success"
                          : row.status === "error"
                            ? "tw-text-error"
                            : "tw-text-muted"
                      }
                    >
                      [{row.status}]
                    </span>{" "}
                    {row.notePath} → {row.predicate} → {row.targetPath}
                    {row.reason ? ` · ${row.reason}` : ""}
                  </div>
                ))}
                {applyReport.rowResults.length > 40 && (
                  <div>... and {applyReport.rowResults.length - 40} more row results</div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {generationDiagnostics && (
        <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-2 tw-text-xs tw-text-muted">
          AI generation diagnostics · extracted {generationDiagnostics.extractedCount} · accepted{" "}
          {generationDiagnostics.acceptedCount} · total queued {generationDiagnostics.totalQueued}
        </div>
      )}
    </div>
  );
}

/**
 * Obsidian modal wrapper for editable semantic relation batch workflow.
 */
export class SemanticRelationBatchEditorModal extends Modal {
  private root: Root | null = null;
  private includeVaultDrafts: boolean;
  private proposalAdapters: SemanticRelationProposalSourceAdapter[];

  constructor(app: App, options: SemanticRelationBatchEditorModalOptions = {}) {
    super(app);
    this.includeVaultDrafts = options.includeVaultDrafts !== false;
    this.proposalAdapters = options.proposalAdapters || [];
    // @ts-ignore
    this.setTitle("Semantic Relation Batch Editor");
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    this.root = createRoot(contentEl);
    modalEl.addClass("hendrik-semantic-relation-modal-shell");
    this.root.render(
      <SemanticRelationBatchEditorContent
        app={this.app}
        onClose={() => this.close()}
        includeVaultDrafts={this.includeVaultDrafts}
        proposalAdapters={this.proposalAdapters}
      />
    );
  }

  onClose(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.modalEl.removeClass("hendrik-semantic-relation-modal-shell");
  }
}

import { App, Modal } from "obsidian";
import React, { useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { getSettings } from "@/settings/model";

export interface SourceEntry {
  title: string;
  path: string;
  score: number;
  explanation?: {
    lexicalMatches?: Array<{ field: string; query: string }>;
    semanticScore?: number;
    folderBoost?: { boostFactor: number; documentCount: number; folder?: string };
    graphConnections?: {
      score: number;
      backlinks: number;
      coCitations: number;
      sharedTags: number;
    };
    graphBoost?: { boostFactor: number; connections: number };
    entityGraph?: {
      matchedEntities: string[];
      relationTypes: string[];
      hopDepth: number;
      evidenceCount: number;
      relationPaths: string[];
      evidenceRefs: Array<{
        path: string;
        chunkId?: string;
        extractor: string;
      }>;
      scoreContribution: number;
    };
    toolEvidence?: {
      tool: "localSearch" | "findNotesByTitle" | "readNote";
      chunkId?: string;
      query?: string;
      matchScore?: number;
    };
    baseScore?: number;
    finalScore?: number;
  };
}

interface SourcesModalContentProps {
  app: App;
  sources: SourceEntry[];
}

interface NormalizedSourceRow extends SourceEntry {
  id: string;
  displayTitle: string;
  displayPath: string;
  openPath: string;
  hasEntityGraphEvidence: boolean;
  hasToolEvidence: boolean;
  rank: number;
  numericScore: number | null;
  relativeScore: number;
  scoreLabel: string;
}

function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.md(?:[#?].*)?$/i.test(value);
}

function getBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : normalized;
}

function splitTitleWithPath(title: string): { title: string; path: string } {
  const trimmed = title.trim();
  const match = trimmed.match(/^(.*?)\s+\((.+)\)$/);
  if (!match) {
    return { title: trimmed, path: "" };
  }

  const name = match[1].trim();
  const candidatePath = match[2].trim();
  if (!name || !looksLikePath(candidatePath)) {
    return { title: trimmed, path: "" };
  }

  return {
    title: name,
    path: candidatePath,
  };
}

/**
 * Normalize source display fields so long "Title (path/to/file.md)" strings
 * are rendered as readable title + path rows in the modal.
 */
export function normalizeSourceDisplay(source: SourceEntry): NormalizedSourceRow {
  const rawTitle = (source.title || "").trim();
  const rawPath = (source.path || "").trim();
  const split = splitTitleWithPath(rawTitle);

  const normalizedPath = rawPath || split.path || "";
  const fallbackTitle =
    split.title || rawTitle || (normalizedPath ? getBasename(normalizedPath) : "") || "Untitled";

  const displayTitle =
    normalizedPath && fallbackTitle === normalizedPath
      ? getBasename(normalizedPath)
      : fallbackTitle;

  const displayPath = normalizedPath && normalizedPath !== displayTitle ? normalizedPath : "";
  const openPath = normalizedPath || rawPath || rawTitle || source.title || "Untitled";
  const hasEntityGraphEvidence = Boolean(source.explanation?.entityGraph);
  const hasToolEvidence = Boolean(source.explanation?.toolEvidence);

  return {
    ...source,
    id: `${normalizedPath || rawPath || rawTitle || source.title}|${displayTitle}`,
    displayTitle,
    displayPath,
    openPath,
    hasEntityGraphEvidence,
    hasToolEvidence,
    rank: 0,
    numericScore: null,
    relativeScore: 0,
    scoreLabel: "n/a",
  };
}

function toFiniteScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Build ranked source rows with stable order fallback and normalized score metrics
 * for compact relevance visualization in the modal.
 */
export function buildRankedRows(sources: SourceEntry[]): NormalizedSourceRow[] {
  const baseRows = sources.map((source, index) => ({
    ...normalizeSourceDisplay(source),
    __index: index,
  }));

  const hasAnyScore = baseRows.some((row) => toFiniteScore(row.score) !== null);
  const sortedRows = hasAnyScore
    ? [...baseRows].sort((a, b) => {
        const aScore = toFiniteScore(a.score) ?? Number.NEGATIVE_INFINITY;
        const bScore = toFiniteScore(b.score) ?? Number.NEGATIVE_INFINITY;
        if (aScore !== bScore) {
          return bScore - aScore;
        }
        return a.__index - b.__index;
      })
    : baseRows;

  const scoredValues = sortedRows
    .map((row) => toFiniteScore(row.score))
    .filter((score): score is number => score !== null);
  const minScore = scoredValues.length > 0 ? Math.min(...scoredValues) : 0;
  const maxScore = scoredValues.length > 0 ? Math.max(...scoredValues) : 0;
  const scoreRange = maxScore - minScore;

  return sortedRows.map(({ __index: _index, ...row }, index) => {
    const numericScore = toFiniteScore(row.score);
    const relativeScore =
      numericScore === null ? 0 : scoreRange > 0 ? (numericScore - minScore) / scoreRange : 1;
    return {
      ...row,
      rank: index + 1,
      numericScore,
      relativeScore,
      scoreLabel: numericScore === null ? "n/a" : numericScore.toFixed(4),
    };
  });
}

/**
 * Builds explanation details shown for each source row.
 */
export function buildExplanationDetails(explanation: SourceEntry["explanation"]): string[] {
  if (!explanation) {
    return [];
  }

  const details: string[] = [];

  if (explanation.lexicalMatches && explanation.lexicalMatches.length > 0) {
    const fields = new Set(explanation.lexicalMatches.map((match) => match.field));
    const queries = new Set(explanation.lexicalMatches.map((match) => match.query));
    details.push(
      `Lexical: matched "${Array.from(queries).join('", "')}" in ${Array.from(fields).join(", ")}`
    );
  }

  if (explanation.semanticScore !== undefined && explanation.semanticScore > 0) {
    details.push(`Semantic: ${(explanation.semanticScore * 100).toFixed(1)}% similarity`);
  }

  if (explanation.folderBoost) {
    details.push(
      `Folder boost: ${explanation.folderBoost.boostFactor.toFixed(2)}x (${explanation.folderBoost.documentCount} docs in ${explanation.folderBoost.folder || "root"})`
    );
  }

  if (explanation.graphConnections) {
    const connectionParts = [];
    if (explanation.graphConnections.backlinks > 0) {
      connectionParts.push(`${explanation.graphConnections.backlinks} backlinks`);
    }
    if (explanation.graphConnections.coCitations > 0) {
      connectionParts.push(`${explanation.graphConnections.coCitations} co-citations`);
    }
    if (explanation.graphConnections.sharedTags > 0) {
      connectionParts.push(`${explanation.graphConnections.sharedTags} shared tags`);
    }

    if (connectionParts.length > 0) {
      details.push(
        `Graph connections: ${explanation.graphConnections.score.toFixed(1)} score (${connectionParts.join(", ")})`
      );
    }
  }

  if (explanation.graphBoost && !explanation.graphConnections) {
    details.push(
      `Graph boost: ${explanation.graphBoost.boostFactor.toFixed(2)}x (${explanation.graphBoost.connections} connections)`
    );
  }

  if (getSettings().enableEntityEvidencePanel && explanation.entityGraph) {
    const relationTypes =
      explanation.entityGraph.relationTypes && explanation.entityGraph.relationTypes.length > 0
        ? explanation.entityGraph.relationTypes.join(", ")
        : "n/a";
    const matched =
      explanation.entityGraph.matchedEntities && explanation.entityGraph.matchedEntities.length > 0
        ? explanation.entityGraph.matchedEntities.join(", ")
        : "n/a";
    details.push(
      `Entity graph: hop ${explanation.entityGraph.hopDepth}, ${explanation.entityGraph.evidenceCount} evidence refs, relations: ${relationTypes}, matched: ${matched}`
    );

    if (Array.isArray(explanation.entityGraph.relationPaths)) {
      explanation.entityGraph.relationPaths.slice(0, 4).forEach((path) => {
        details.push(`Path: ${path}`);
      });
    }

    if (Array.isArray(explanation.entityGraph.evidenceRefs)) {
      explanation.entityGraph.evidenceRefs.slice(0, 4).forEach((evidence) => {
        const pointer = evidence.chunkId || evidence.path;
        details.push(`Evidence: ${pointer} (${evidence.extractor})`);
      });
    }
  }

  if (getSettings().enableEntityEvidencePanel && !explanation.entityGraph) {
    details.push("Entity graph: no graph evidence attached for this source.");
  }

  if (explanation.toolEvidence) {
    const evidence = explanation.toolEvidence;
    const detailParts = [`Tool evidence: ${evidence.tool}`];
    if (typeof evidence.matchScore === "number") {
      detailParts.push(`score ${evidence.matchScore.toFixed(3)}`);
    }
    if (evidence.chunkId) {
      detailParts.push(`chunk ${evidence.chunkId}`);
    }
    if (evidence.query) {
      detailParts.push(`query "${evidence.query}"`);
    }
    details.push(detailParts.join(" | "));
  }

  if (explanation.baseScore !== explanation.finalScore) {
    details.push(
      `Score: ${explanation.baseScore?.toFixed(4)} -> ${explanation.finalScore?.toFixed(4)}`
    );
  }

  return details;
}

/**
 * Modal content for listing source documents and scoring explanations.
 */
export function SourcesModalContent({
  app,
  sources,
}: SourcesModalContentProps): React.ReactElement {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const showEntityEvidencePanel = getSettings().enableEntityEvidencePanel;

  const rows = useMemo(() => buildRankedRows(sources), [sources]);
  const hasRankedScores = useMemo(() => rows.some((row) => row.numericScore !== null), [rows]);
  const topScore = useMemo(
    () => rows.find((row) => row.numericScore !== null)?.numericScore ?? null,
    [rows]
  );
  const entityGraphCount = useMemo(
    () => rows.filter((row) => row.hasEntityGraphEvidence).length,
    [rows]
  );
  const toolOnlyCount = useMemo(
    () => rows.filter((row) => !row.hasEntityGraphEvidence && row.hasToolEvidence).length,
    [rows]
  );

  /**
   * Opens a source file in the workspace.
   */
  const openSource = (source: NormalizedSourceRow): void => {
    app.workspace.openLinkText(source.openPath, "");
  };

  return (
    <div className="hendrik-sources-modal">
      <div className="hendrik-sources-modal__header">Sources</div>
      {rows.length > 0 && (
        <div className="hendrik-sources-modal__ranking-summary">
          {hasRankedScores
            ? `Ranked by relevance score${topScore !== null ? ` · top ${topScore.toFixed(4)}` : ""}`
            : "Ranked by retrieval order · score unavailable"}
        </div>
      )}
      {showEntityEvidencePanel && (
        <div className="hendrik-sources-modal__status">
          {entityGraphCount > 0
            ? `${entityGraphCount} of ${rows.length} sources include entity graph evidence.`
            : toolOnlyCount > 0
              ? "No entity graph evidence attached; showing retrieval/tool evidence only."
              : "No entity graph evidence attached to this answer."}
        </div>
      )}
      <div className="hendrik-sources-modal__list">
        {rows.map((source) => {
          const details = buildExplanationDetails(source.explanation);
          const expandedDetails = source.displayPath
            ? [`Source path: ${source.displayPath}`, ...details]
            : details;
          const isExpanded = expandedIds.has(source.id);
          const evidenceBadgeLabel = source.hasEntityGraphEvidence
            ? "Entity Graph"
            : source.hasToolEvidence
              ? "Tool Fallback"
              : "No Entity Graph";
          const evidenceBadgeClass = source.hasEntityGraphEvidence
            ? "hendrik-sources-modal__item-badge--entity"
            : source.hasToolEvidence
              ? "hendrik-sources-modal__item-badge--tool"
              : "hendrik-sources-modal__item-badge--none";
          const entitySummary =
            source.hasEntityGraphEvidence && source.explanation?.entityGraph
              ? `Hop ${source.explanation.entityGraph.hopDepth} · ${source.explanation.entityGraph.evidenceCount} refs`
              : null;

          return (
            <div key={source.id} className="hendrik-sources-modal__item">
              <button
                type="button"
                className="hendrik-sources-modal__item-main"
                onClick={() => openSource(source)}
              >
                <div className="hendrik-sources-modal__item-main-top">
                  <div className="hendrik-sources-modal__item-title-wrap">
                    <span className="hendrik-sources-modal__item-title" title={source.displayTitle}>
                      {source.displayTitle}
                    </span>
                    {source.displayPath && (
                      <span className="hendrik-sources-modal__item-path" title={source.displayPath}>
                        {source.displayPath}
                      </span>
                    )}
                  </div>
                  <div className="hendrik-sources-modal__item-rank-block">
                    <span className="hendrik-sources-modal__item-rank">#{source.rank}</span>
                    <span className="hendrik-sources-modal__item-score">{source.scoreLabel}</span>
                  </div>
                </div>
                <div className="hendrik-sources-modal__item-score-track" aria-hidden="true">
                  <span
                    className="hendrik-sources-modal__item-score-fill"
                    style={{
                      width: `${Math.max(6, Math.round(source.relativeScore * 100))}%`,
                    }}
                  />
                </div>
              </button>

              <div className="hendrik-sources-modal__item-footer">
                <div className="hendrik-sources-modal__item-signals">
                  {showEntityEvidencePanel && (
                    <span
                      className={`hendrik-sources-modal__item-badge ${evidenceBadgeClass}`}
                      title={
                        source.hasEntityGraphEvidence
                          ? "Entity graph evidence is attached to this source."
                          : source.hasToolEvidence
                            ? "Source came from deterministic tool fallback without entity-graph evidence."
                            : "Entity graph evidence is not attached for this source."
                      }
                    >
                      {evidenceBadgeLabel}
                    </span>
                  )}
                  {entitySummary && (
                    <span className="hendrik-sources-modal__item-entity-summary">
                      {entitySummary}
                    </span>
                  )}
                </div>
                {expandedDetails.length > 0 && (
                  <button
                    type="button"
                    className="hendrik-sources-modal__item-toggle"
                    onClick={() => {
                      setExpandedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(source.id)) {
                          next.delete(source.id);
                        } else {
                          next.add(source.id);
                        }
                        return next;
                      });
                    }}
                  >
                    {isExpanded ? "Hide details" : "Details"}
                  </button>
                )}
              </div>

              {isExpanded && expandedDetails.length > 0 && (
                <ul className="hendrik-sources-modal__item-details">
                  {expandedDetails.map((detail) => (
                    <li key={detail} className="hendrik-sources-modal__item-detail">
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export class SourcesModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private sources: SourceEntry[]
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    this.root = createRoot(contentEl);
    modalEl.addClass("hendrik-sources-modal-shell");
    this.root.render(<SourcesModalContent app={this.app} sources={this.sources} />);
  }

  onClose(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.modalEl.removeClass("hendrik-sources-modal-shell");
  }
}

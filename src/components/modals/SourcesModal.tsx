import { App, Modal } from "obsidian";
import React, { useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface SourceEntry {
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
    baseScore?: number;
    finalScore?: number;
  };
}

interface SourcesModalContentProps {
  app: App;
  sources: SourceEntry[];
}

/**
 * Builds explanation details shown for each source row.
 */
function buildExplanationDetails(explanation: SourceEntry["explanation"]): string[] {
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
function SourcesModalContent({ app, sources }: SourcesModalContentProps): React.ReactElement {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () =>
      sources.map((source) => ({
        ...source,
        id: `${source.path}|${source.title}`,
        displayText:
          source.path && source.path !== source.title
            ? `${source.title} (${source.path})`
            : source.title,
      })),
    [sources]
  );

  /**
   * Opens a source file in the workspace.
   */
  const openSource = (source: SourceEntry): void => {
    app.workspace.openLinkText(source.path || source.title, "");
  };

  return (
    <div className="hendrik-sources-modal tw-flex tw-flex-col tw-gap-3">
      <div className="hendrik-sources-modal__header">Sources</div>
      <div className="hendrik-sources-modal__list">
        {rows.map((source) => {
          const details = buildExplanationDetails(source.explanation);
          const isExpanded = expandedIds.has(source.id);

          return (
            <div key={source.id} className="hendrik-sources-modal__item">
              <button
                type="button"
                className="hendrik-sources-modal__item-main"
                onClick={() => openSource(source)}
              >
                <span className="hendrik-sources-modal__item-title">{source.displayText}</span>
                {typeof source.score === "number" && (
                  <span className="hendrik-sources-modal__item-score">
                    Relevance {source.score.toFixed(4)}
                  </span>
                )}
              </button>

              {details.length > 0 && (
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
                  {isExpanded ? "Hide details" : "Show details"}
                </button>
              )}

              {isExpanded && details.length > 0 && (
                <ul className="hendrik-sources-modal__item-details">
                  {details.map((detail) => (
                    <li key={detail}>{detail}</li>
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

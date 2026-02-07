import { logInfo, logWarn } from "@/logger";
import { BaseCallbackConfig } from "@langchain/core/callbacks/manager";
import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import { App, TFile } from "obsidian";

/**
 * Shape of the Smart Connections env.smart_sources.lookup() result items.
 * SC returns arrays of {item, score} where item is a SmartEntity with path/key.
 */
interface SCLookupResult {
  item: {
    path: string;
    key: string;
    name?: string;
    data?: {
      path?: string;
    };
  };
  score: number;
}

/**
 * Minimal interface for the Smart Connections plugin env.
 */
interface SmartConnectionsEnv {
  smart_sources: {
    lookup: (params: {
      hypotheticals: string[];
      filter?: { limit?: number };
    }) => Promise<SCLookupResult[] | { error: string }>;
    get: (path: string) => SCEntity | undefined;
  };
  smart_blocks?: {
    lookup: (params: {
      hypotheticals: string[];
      filter?: { limit?: number };
    }) => Promise<SCLookupResult[] | { error: string }>;
  };
}

/**
 * Minimal interface for a Smart Connections entity.
 */
interface SCEntity {
  path: string;
  key: string;
  data?: Record<string, unknown>;
  read?: () => Promise<string>;
}

/**
 * Options for configuring the SmartConnectionsRetriever.
 */
export interface SmartConnectionsRetrieverOptions {
  /** Maximum number of results to return */
  maxK: number;
  /** Minimum similarity score threshold (0-1) */
  minSimilarityScore?: number;
  /** Whether to include block-level results when available */
  includeBlocks?: boolean;
}

/**
 * Checks whether the Smart Connections plugin is installed and has a loaded environment.
 *
 * @param app - Obsidian App instance
 * @returns True if SC is available for queries
 */
export function isSmartConnectionsAvailable(app: App): boolean {
  try {
    const scPlugin = (app as any).plugins?.plugins?.["smart-connections"];
    return Boolean(scPlugin?.env?.smart_sources);
  } catch {
    return false;
  }
}

/**
 * Gets the Smart Connections environment, or null if unavailable.
 *
 * @param app - Obsidian App instance
 * @returns The SC env object or null
 */
function getSmartConnectionsEnv(app: App): SmartConnectionsEnv | null {
  try {
    const scPlugin = (app as any).plugins?.plugins?.["smart-connections"];
    if (scPlugin?.env?.smart_sources) {
      return scPlugin.env as SmartConnectionsEnv;
    }
  } catch {
    // SC not installed or env not ready
  }
  return null;
}

/**
 * Retriever that delegates semantic search to the Smart Connections plugin.
 * When SC is installed and has indexed the vault, this retriever leverages SC's
 * local embeddings and cosine similarity search to find relevant notes.
 *
 * This avoids duplicating embedding work — SC handles all indexing automatically.
 * Results are converted to LangChain Document objects compatible with the chain runners.
 */
export class SmartConnectionsRetriever extends BaseRetriever {
  public lc_namespace = ["smart_connections_retriever"];

  private app: App;
  private options: SmartConnectionsRetrieverOptions;

  /**
   * Creates a new SmartConnectionsRetriever.
   *
   * @param app - Obsidian app instance
   * @param options - Retriever configuration options
   */
  constructor(app: App, options: SmartConnectionsRetrieverOptions) {
    super();
    this.app = app;
    this.options = {
      ...options,
      minSimilarityScore: options.minSimilarityScore ?? 0.1,
      includeBlocks: options.includeBlocks ?? false,
    };
  }

  /**
   * Retrieves relevant documents from Smart Connections' vector store.
   * The query is embedded by SC's model and compared via cosine similarity
   * against all indexed sources.
   *
   * @param query - The search query string
   * @param _config - Optional LangChain callback configuration (unused)
   * @returns Array of Document objects with content and metadata
   */
  public async getRelevantDocuments(
    query: string,
    _config?: BaseCallbackConfig
  ): Promise<Document[]> {
    const env = getSmartConnectionsEnv(this.app);
    if (!env) {
      logWarn("SmartConnectionsRetriever: Smart Connections plugin not available");
      return [];
    }

    try {
      const lookupLimit = Math.min(this.options.maxK * 2, 50); // Fetch extra to allow filtering

      // SC's lookup() embeds the query text and finds nearest neighbors
      const results = await env.smart_sources.lookup({
        hypotheticals: [query],
        filter: { limit: lookupLimit },
      });

      if (!results || !Array.isArray(results)) {
        if (results && typeof results === "object" && "error" in results) {
          logWarn(`SmartConnectionsRetriever: SC lookup error: ${(results as any).error}`);
        }
        return [];
      }

      logInfo(
        `SmartConnectionsRetriever: SC returned ${results.length} results for query "${query.substring(0, 50)}..."`
      );

      // Convert SC results to LangChain Documents
      const documents = await this.convertToDocuments(results);

      // Filter by minimum similarity score and apply maxK limit
      const filtered = documents
        .filter((doc) => (doc.metadata?.score ?? 0) >= (this.options.minSimilarityScore ?? 0))
        .slice(0, this.options.maxK);

      logInfo(`SmartConnectionsRetriever: Returning ${filtered.length} documents after filtering`);

      return filtered;
    } catch (error) {
      logWarn(`SmartConnectionsRetriever: Search failed: ${error}`);
      return [];
    }
  }

  /**
   * Converts SC lookup results into LangChain Document objects.
   * Reads file content from the vault for each result.
   *
   * @param results - SC lookup results with item/score pairs
   * @returns Array of LangChain Documents
   */
  private async convertToDocuments(results: SCLookupResult[]): Promise<Document[]> {
    const documents: Document[] = [];

    for (const result of results) {
      try {
        const filePath = result.item?.path || result.item?.key;
        if (!filePath) continue;

        // Resolve the base file path (SC keys can include block references like "file.md#heading")
        const baseFilePath = filePath.split("#")[0];
        const file = this.app.vault.getAbstractFileByPath(baseFilePath);

        if (!(file instanceof TFile)) continue;

        // Read file content from vault
        const content = await this.app.vault.cachedRead(file);
        if (!content) continue;

        // If the SC result references a specific block/heading, try to extract that section
        const blockRef = filePath.includes("#") ? filePath.split("#").slice(1).join("#") : null;
        const pageContent = blockRef
          ? (this.extractSection(content, blockRef) ?? content)
          : content;

        documents.push(
          new Document({
            pageContent,
            metadata: {
              path: baseFilePath,
              title: file.basename,
              score: result.score,
              rerank_score: result.score,
              source: "smart_connections",
              mtime: file.stat.mtime,
              ctime: file.stat.ctime,
              ...(blockRef ? { blockRef } : {}),
            },
          })
        );
      } catch (error) {
        // Skip individual file read errors
        logWarn(`SmartConnectionsRetriever: Failed to read ${result.item?.path}: ${error}`);
      }
    }

    return documents;
  }

  /**
   * Attempts to extract a specific section from markdown content based on a heading reference.
   * Falls back to full content if the section cannot be found.
   *
   * @param content - Full markdown file content
   * @param blockRef - The heading/block reference (e.g., "Some Heading")
   * @returns The extracted section text, or null if not found
   */
  private extractSection(content: string, blockRef: string): string | null {
    const lines = content.split("\n");
    const normalizedRef = blockRef.toLowerCase().replace(/-/g, " ");

    let startLine = -1;
    let startLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim().toLowerCase();

        if (startLine === -1 && headingText === normalizedRef) {
          startLine = i;
          startLevel = level;
          continue;
        }

        // Stop at a same-level or higher heading
        if (startLine !== -1 && level <= startLevel) {
          return lines.slice(startLine, i).join("\n").trim();
        }
      }
    }

    if (startLine !== -1) {
      return lines.slice(startLine).join("\n").trim();
    }

    return null;
  }
}

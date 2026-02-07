import { logInfo } from "@/logger";
import { getSettings, CopilotSettings } from "@/settings/model";
import { App } from "obsidian";
import {
  SmartConnectionsRetriever,
  isSmartConnectionsAvailable,
} from "./smartConnectionsRetriever";
import { MergedSemanticRetriever } from "./v3/MergedSemanticRetriever";
import { TieredLexicalRetriever } from "./v3/TieredLexicalRetriever";

/**
 * Common options for all retriever types.
 * This interface unifies the configuration across different retriever implementations.
 */
export interface RetrieverOptions {
  /** Minimum similarity score threshold for results (0-1) */
  minSimilarityScore?: number;
  /** Maximum number of results to return */
  maxK: number;
  /** Additional terms to boost in search (defaults to empty array) */
  salientTerms?: string[];
  /** Optional time range filter */
  timeRange?: { startTime: number; endTime: number };
  /** Weight for text/keyword matching vs semantic (0-1) */
  textWeight?: number;
  /** Return all matching results up to a limit */
  returnAll?: boolean;
  /** Return all documents matching tags */
  returnAllTags?: boolean;
  /** Tag terms to filter by */
  tagTerms?: string[];
}

/**
 * Internal options with defaults applied.
 * Used when passing options to concrete retriever implementations.
 */
interface NormalizedRetrieverOptions {
  minSimilarityScore: number;
  maxK: number;
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll: boolean;
  returnAllTags: boolean;
  tagTerms: string[];
}

/**
 * Result type indicating which retriever was selected and why.
 */
export interface RetrieverSelectionResult {
  retriever: DocumentRetriever;
  type: "smart_connections" | "semantic" | "lexical";
  reason: string;
}

/**
 * Normalize options by applying defaults.
 * Ensures all required fields are present with proper types.
 */
function normalizeOptions(options: RetrieverOptions): NormalizedRetrieverOptions {
  const tagTerms = options.tagTerms ?? [];
  const hasTagTerms = tagTerms.length > 0;

  return {
    minSimilarityScore: options.minSimilarityScore ?? 0.1,
    maxK: options.maxK,
    salientTerms: options.salientTerms ?? [],
    timeRange: options.timeRange,
    textWeight: options.textWeight,
    returnAll: hasTagTerms ? true : (options.returnAll ?? false),
    returnAllTags: hasTagTerms,
    tagTerms,
  };
}

/**
 * Common interface for retrievers that can get relevant documents.
 * This is the shared interface for MergedSemanticRetriever and TieredLexicalRetriever.
 */
export interface DocumentRetriever {
  getRelevantDocuments(query: string): Promise<import("@langchain/core/documents").Document[]>;
}

/**
 * Factory for creating retrievers based on current settings.
 * Centralizes the retriever selection logic.
 *
 * Priority order:
 * 1. Smart Connections (if enabled and available)
 * 2. Semantic search / MergedSemanticRetriever (if enabled)
 * 3. Lexical search / TieredLexicalRetriever (default)
 */
export class RetrieverFactory {
  /**
   * Create a retriever based on current settings.
   *
   * @param app - Obsidian app instance
   * @param options - Retriever configuration options
   * @param settings - Optional settings override (defaults to current settings)
   * @returns Object containing the retriever and metadata about selection
   */
  static async createRetriever(
    app: App,
    options: RetrieverOptions,
    settings?: Partial<CopilotSettings>
  ): Promise<RetrieverSelectionResult> {
    const currentSettings = settings ? { ...getSettings(), ...settings } : getSettings();

    // Normalize options with defaults
    const normalizedOptions = normalizeOptions(options);

    // Smart Connections integration - highest priority when enabled
    if (currentSettings.useSmartConnections && isSmartConnectionsAvailable(app)) {
      const retriever = new SmartConnectionsRetriever(app, {
        maxK: normalizedOptions.maxK,
        minSimilarityScore: normalizedOptions.minSimilarityScore,
        includeBlocks: false,
      });
      logInfo("RetrieverFactory: Using SmartConnectionsRetriever (Smart Connections plugin)");
      return {
        retriever,
        type: "smart_connections",
        reason: "Smart Connections plugin is enabled and available",
      };
    }

    // Standard mode: check enableSemanticSearchV3 setting
    if (currentSettings.enableSemanticSearchV3) {
      const retriever = new MergedSemanticRetriever(app, normalizedOptions);
      logInfo("RetrieverFactory: Using MergedSemanticRetriever (semantic search)");
      return {
        retriever,
        type: "semantic",
        reason: "Semantic search is enabled",
      };
    }

    // Default: Lexical search (TieredLexicalRetriever)
    const retriever = new TieredLexicalRetriever(app, normalizedOptions);
    logInfo("RetrieverFactory: Using TieredLexicalRetriever (lexical search)");
    return {
      retriever,
      type: "lexical",
      reason: "Default lexical search",
    };
  }

  /**
   * Create a retriever that forces lexical search regardless of settings.
   * Useful for time-range queries and tag-based searches that work better with lexical.
   *
   * @param app - Obsidian app instance
   * @param options - Retriever configuration options
   * @returns The lexical retriever
   */
  static createLexicalRetriever(app: App, options: RetrieverOptions): TieredLexicalRetriever {
    return new TieredLexicalRetriever(app, normalizeOptions(options));
  }

  /**
   * Create a retriever that forces semantic search regardless of settings.
   * Useful when semantic understanding is specifically needed.
   *
   * @param app - Obsidian app instance
   * @param options - Retriever configuration options
   * @returns The semantic retriever
   */
  static createSemanticRetriever(app: App, options: RetrieverOptions): MergedSemanticRetriever {
    return new MergedSemanticRetriever(app, normalizeOptions(options));
  }

  /**
   * Get the current retriever type based on settings without creating an instance.
   * Useful for UI display or debugging.
   *
   * @param settings - Optional settings override
   * @returns The type of retriever that would be created
   */
  static getRetrieverType(
    settings?: Partial<CopilotSettings>
  ): "smart_connections" | "semantic" | "lexical" {
    const currentSettings = settings ? { ...getSettings(), ...settings } : getSettings();

    // Smart Connections check (runtime availability can't be determined statically)
    if (currentSettings.useSmartConnections) {
      return "smart_connections";
    }

    // Standard mode
    if (currentSettings.enableSemanticSearchV3) {
      return "semantic";
    }

    return "lexical";
  }
}

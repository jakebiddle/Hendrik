import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { Document } from "@langchain/core/documents";
import { App, TFile } from "obsidian";
import { ChunkManager } from "@/search/v3/chunks";
import { EntityGraphIndexManager } from "./EntityGraphIndexManager";
import { EntityGraphExpansionHit, EntityGraphExplanation, ResolvedEntity } from "./types";

/**
 * Result returned by entity-graph document augmentation.
 */
export interface EntityGraphAugmentationResult {
  /** Final merged documents after entity expansion and deduplication. */
  documents: Document[];
  /** Whether the query resolved to entity matches (entity-query mode). */
  entityQueryMode: boolean;
  /** Whether the merged set includes explicit entity-graph evidence entries. */
  hasEntityEvidence: boolean;
  /** Resolved entities from query alias matching. */
  resolvedEntities: ResolvedEntity[];
}

interface EntityGraphAugmentationOptions {
  maxHops: number;
  maxExpandedDocs: number;
}

/**
 * EntityGraphRetriever augments lexical retrieval with deterministic graph neighbors.
 */
export class EntityGraphRetriever {
  private readonly indexManager: EntityGraphIndexManager;

  constructor(
    private app: App,
    private chunkManager: ChunkManager
  ) {
    this.indexManager = EntityGraphIndexManager.getInstance(app);
  }

  /**
   * Augments lexical documents with entity-neighbor evidence documents.
   *
   * @param query - User query string.
   * @param baseDocuments - Base lexical documents.
   * @param options - Graph expansion options.
   * @returns Augmentation result with merged documents and entity-query metadata.
   */
  async augmentDocuments(
    query: string,
    baseDocuments: Document[],
    options: EntityGraphAugmentationOptions
  ): Promise<EntityGraphAugmentationResult> {
    const settings = getSettings();
    if (!settings.enableEntityGraphRetrieval) {
      return {
        documents: baseDocuments,
        entityQueryMode: false,
        hasEntityEvidence: false,
        resolvedEntities: [],
      };
    }

    let resolvedEntities: ResolvedEntity[] = [];
    try {
      resolvedEntities = await this.indexManager.resolveEntities(query);
    } catch (error) {
      logWarn("[EntityGraphRetriever] Failed to resolve query entities", error);
    }

    if (resolvedEntities.length === 0) {
      return {
        documents: baseDocuments,
        entityQueryMode: false,
        hasEntityEvidence: false,
        resolvedEntities: [],
      };
    }

    const maxHops = Math.max(1, Math.floor(options.maxHops || settings.entityGraphMaxHops || 2));
    const maxExpandedDocs = Math.max(
      1,
      Math.floor(options.maxExpandedDocs || settings.entityGraphMaxExpandedDocs || 12)
    );

    const expansionHits = this.indexManager.expandFromResolvedEntities(
      resolvedEntities,
      maxHops,
      maxExpandedDocs
    );

    const graphDocuments = await this.buildGraphEvidenceDocuments(expansionHits);
    const merged = this.mergeDocuments(baseDocuments, graphDocuments, resolvedEntities);

    const hasEntityEvidence = merged.some((doc) =>
      Boolean((doc.metadata as Record<string, unknown> | undefined)?.entityEvidence)
    );

    if (getSettings().debug) {
      logInfo(
        `[EntityGraphRetriever] entityQueryMode=true resolved=${resolvedEntities.length} expansionHits=${expansionHits.length} merged=${merged.length}`
      );
    }

    return {
      documents: merged,
      entityQueryMode: true,
      hasEntityEvidence,
      resolvedEntities,
    };
  }

  /**
   * Converts graph expansion hits to LangChain documents with entity explanations.
   *
   * @param hits - Graph expansion hits.
   * @returns Documents ready for merge with lexical results.
   */
  private async buildGraphEvidenceDocuments(hits: EntityGraphExpansionHit[]): Promise<Document[]> {
    const documents: Document[] = [];

    for (const hit of hits) {
      const file = this.app.vault.getAbstractFileByPath(hit.path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        continue;
      }

      try {
        const chunked = await this.chunkManager.getChunks([file.path]);
        const topChunk = chunked[0];
        const pageContent = topChunk?.content || (await this.app.vault.cachedRead(file));

        if (!pageContent || !pageContent.trim()) {
          continue;
        }

        documents.push(
          new Document({
            pageContent,
            metadata: {
              path: file.path,
              chunkId: topChunk?.id,
              title: file.basename,
              mtime: file.stat.mtime,
              ctime: file.stat.ctime,
              score: hit.score,
              rerank_score: hit.score,
              engine: "entity-graph",
              includeInContext: true,
              explanation: {
                entityGraph: hit.explanation,
                baseScore: hit.score,
                finalScore: hit.score,
              },
              entityEvidence: true,
              isChunk: Boolean(topChunk),
            },
          })
        );
      } catch (error) {
        logWarn(`[EntityGraphRetriever] Failed to build graph document for ${hit.path}`, error);
      }
    }

    return documents;
  }

  /**
   * Merges lexical and graph documents by chunk/path identity while preserving rank order.
   *
   * @param baseDocuments - Existing lexical documents.
   * @param graphDocuments - Graph evidence documents.
   * @param resolvedEntities - Entities that triggered graph mode.
   * @returns Deduplicated merged documents.
   */
  private mergeDocuments(
    baseDocuments: Document[],
    graphDocuments: Document[],
    resolvedEntities: ResolvedEntity[]
  ): Document[] {
    const mergedMap = new Map<string, Document>();

    const upsert = (doc: Document, fromGraph: boolean): void => {
      const key = this.getDocumentKey(doc);
      const existing = mergedMap.get(key);
      if (!existing) {
        mergedMap.set(key, this.applyEntityModeMetadata(doc, resolvedEntities, fromGraph));
        return;
      }

      const existingScore = this.getDocumentScore(existing);
      const incomingScore = this.getDocumentScore(doc);
      const winner = incomingScore > existingScore ? doc : existing;

      const mergedExplanation = this.mergeExplanations(
        existing.metadata?.explanation,
        doc.metadata?.explanation
      );

      const mergedMetadata = {
        ...(winner.metadata || {}),
        explanation: mergedExplanation,
        entityQueryMode: true,
        entityEvidence: Boolean(
          (existing.metadata as Record<string, unknown> | undefined)?.entityEvidence ||
            (doc.metadata as Record<string, unknown> | undefined)?.entityEvidence
        ),
        matchedEntities: resolvedEntities.map((item) => item.canonicalName),
      };

      mergedMap.set(
        key,
        new Document({
          pageContent: winner.pageContent,
          metadata: mergedMetadata,
        })
      );
    };

    for (const doc of baseDocuments) {
      upsert(doc, false);
    }

    for (const doc of graphDocuments) {
      upsert(doc, true);
    }

    return Array.from(mergedMap.values()).sort(
      (a, b) => this.getDocumentScore(b) - this.getDocumentScore(a)
    );
  }

  /**
   * Ensures entity-mode metadata is attached to a document.
   *
   * @param doc - Source document.
   * @param resolvedEntities - Resolved entities for this query.
   * @param fromGraph - Whether document came from graph expansion.
   * @returns New document with entity metadata.
   */
  private applyEntityModeMetadata(
    doc: Document,
    resolvedEntities: ResolvedEntity[],
    fromGraph: boolean
  ): Document {
    const metadata = {
      ...(doc.metadata || {}),
      entityQueryMode: true,
      entityEvidence: fromGraph || Boolean((doc.metadata as any)?.entityEvidence),
      matchedEntities: resolvedEntities.map((item) => item.canonicalName),
    };

    return new Document({
      pageContent: doc.pageContent,
      metadata,
    });
  }

  /**
   * Merges explanation payloads while preserving lexical and entity graph details.
   *
   * @param current - Existing explanation payload.
   * @param incoming - Incoming explanation payload.
   * @returns Merged explanation object.
   */
  private mergeExplanations(current: unknown, incoming: unknown): Record<string, unknown> {
    const currentObj =
      current && typeof current === "object" ? (current as Record<string, unknown>) : {};
    const incomingObj =
      incoming && typeof incoming === "object" ? (incoming as Record<string, unknown>) : {};

    const entityGraph =
      (incomingObj.entityGraph as EntityGraphExplanation | undefined) ||
      (currentObj.entityGraph as EntityGraphExplanation | undefined);

    return {
      ...currentObj,
      ...incomingObj,
      ...(entityGraph ? { entityGraph } : {}),
    };
  }

  /**
   * Computes a stable map key for deduplicating retrieval documents.
   *
   * @param doc - Document to key.
   * @returns Stable dedupe key.
   */
  private getDocumentKey(doc: Document): string {
    const metadata = (doc.metadata || {}) as Record<string, unknown>;
    return String(
      metadata.chunkId || metadata.path || metadata.title || doc.pageContent.slice(0, 64)
    );
  }

  /**
   * Safely extracts document score from metadata.
   *
   * @param doc - Candidate document.
   * @returns Numeric score.
   */
  private getDocumentScore(doc: Document): number {
    const metadata = (doc.metadata || {}) as Record<string, unknown>;
    const score =
      (typeof metadata.rerank_score === "number" && metadata.rerank_score) ||
      (typeof metadata.score === "number" && metadata.score) ||
      0;

    return Number.isFinite(score) ? score : 0;
  }
}

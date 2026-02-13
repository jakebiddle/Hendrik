import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { logInfo, logWarn } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { App, TAbstractFile, TFile } from "obsidian";
import {
  EntityEdge,
  EntityEvidenceRef,
  EntityGraphExpansionHit,
  EntityGraphExplanation,
  EntityNode,
  EntityRelationType,
  EntitySemanticPredicate,
  ResolvedEntity,
} from "./types";
import { parseSemanticPredicate } from "./semanticPredicateUtils";

interface IndexedFileDescriptor {
  path: string;
  title: string;
  mtime: number;
  tags: Set<string>;
  headings: Set<string>;
  outgoingTargets: Set<string>;
  frontmatterTargets: Set<string>;
  aliases: Set<string>;
  semanticRelations: SemanticRelationDescriptor[];
}

interface SemanticRelationDescriptor {
  targetPath: string;
  predicate: EntitySemanticPredicate;
  confidence: number;
  sourceField: string;
}

interface ExpansionAccumulator {
  score: number;
  hopDepth: number;
  relationTypes: Set<EntityRelationType>;
  matchedEntities: Set<string>;
  relationPaths: string[];
  evidenceRefs: EntityEvidenceRef[];
  evidenceCount: number;
}

/**
 * Deterministic entity graph index built from vault metadata and note content signals.
 *
 * This manager intentionally avoids LLM extraction. It relies on links, tags,
 * headings, and configured frontmatter alias/reference fields.
 */
export class EntityGraphIndexManager {
  private static instance: EntityGraphIndexManager | null = null;

  private nodesById = new Map<string, EntityNode>();
  private aliasesToEntityIds = new Map<string, Set<string>>();
  private edgesByFrom = new Map<string, Map<string, EntityEdge>>();
  private edgeIdToFromId = new Map<string, string>();
  private sourcePathToEdgeIds = new Map<string, Set<string>>();
  private descriptorsByPath = new Map<string, IndexedFileDescriptor>();

  private isInitialized = false;
  private rebuildInFlight: Promise<void> | null = null;

  private constructor(private app: App) {
    this.registerVaultListeners();
    this.registerSettingsListeners();
  }

  /**
   * Singleton accessor.
   *
   * @param app - Obsidian app instance.
   * @returns Shared entity graph index manager.
   */
  static getInstance(app: App): EntityGraphIndexManager {
    if (!EntityGraphIndexManager.instance) {
      EntityGraphIndexManager.instance = new EntityGraphIndexManager(app);
    }
    return EntityGraphIndexManager.instance;
  }

  /**
   * Ensures the in-memory entity graph is initialized before read operations.
   */
  async ensureReady(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.rebuild();
  }

  /**
   * Invalidates the current index so it is rebuilt lazily on next use.
   */
  invalidate(): void {
    this.isInitialized = false;
  }

  /**
   * Rebuilds the full entity graph from vault markdown files.
   */
  async rebuild(): Promise<void> {
    if (this.rebuildInFlight) {
      await this.rebuildInFlight;
      return;
    }

    this.rebuildInFlight = (async () => {
      const rebuildStart = Date.now();
      this.clearAllState();

      const { inclusions, exclusions } = getMatchingPatterns();
      const markdownFiles = this.app.vault
        .getMarkdownFiles()
        .filter((file) => shouldIndexFile(file, inclusions, exclusions));

      for (const file of markdownFiles) {
        try {
          const descriptor = this.buildDescriptor(file);
          if (!descriptor) {
            continue;
          }
          this.upsertDescriptor(descriptor);
        } catch (error) {
          logWarn(`[EntityGraphIndexManager] Failed to index ${file.path}`, error);
        }
      }

      this.rebuildDirectRelationEdges();
      this.rebuildSharedRelationEdges();
      this.isInitialized = true;

      logInfo(
        `[EntityGraphIndexManager] Rebuilt graph: nodes=${this.nodesById.size}, aliases=${this.aliasesToEntityIds.size}, edges=${this.getEdgeCount()} (${Date.now() - rebuildStart}ms)`
      );
    })()
      .catch((error) => {
        this.isInitialized = false;
        logWarn("[EntityGraphIndexManager] Rebuild failed", error);
      })
      .finally(() => {
        this.rebuildInFlight = null;
      });

    await this.rebuildInFlight;
  }

  /**
   * Resolves canonical entities from a user query using normalized alias matching.
   *
   * @param query - Raw user query.
   * @returns Ranked resolved entity matches.
   */
  async resolveEntities(query: string): Promise<ResolvedEntity[]> {
    await this.ensureReady();

    const normalizedQuery = this.normalizeAlias(query);
    if (!normalizedQuery) {
      return [];
    }

    const terms = this.generateCandidateAliasTerms(normalizedQuery);
    const scores = new Map<string, { score: number; matchedAlias: string }>();

    for (const term of terms) {
      const entityIds = this.aliasesToEntityIds.get(term);
      if (!entityIds || entityIds.size === 0) {
        continue;
      }

      const score = this.computeTermScore(term);
      for (const entityId of entityIds) {
        const existing = scores.get(entityId);
        if (!existing || score > existing.score) {
          scores.set(entityId, { score, matchedAlias: term });
        }
      }
    }

    return Array.from(scores.entries())
      .map(([entityId, detail]) => {
        const node = this.nodesById.get(entityId);
        if (!node) {
          return null;
        }

        return {
          entityId,
          canonicalName: node.canonicalName,
          matchedAlias: detail.matchedAlias,
          score: detail.score,
        } as ResolvedEntity;
      })
      .filter((entry): entry is ResolvedEntity => entry !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  /**
   * Expands graph neighbors from resolved entities and returns ranked evidence hits.
   *
   * @param resolvedEntities - Resolved query entities.
   * @param maxHops - Maximum graph hop depth.
   * @param maxExpandedDocs - Maximum number of expansion hits to return.
   * @returns Ranked entity-graph expansion hits.
   */
  expandFromResolvedEntities(
    resolvedEntities: ResolvedEntity[],
    maxHops: number,
    maxExpandedDocs: number
  ): EntityGraphExpansionHit[] {
    if (resolvedEntities.length === 0) {
      return [];
    }

    const normalizedMaxHops = Math.max(1, Math.min(4, Math.floor(maxHops || 1)));
    const normalizedMaxExpandedDocs = Math.max(1, Math.min(100, Math.floor(maxExpandedDocs || 1)));

    const resolvedById = new Map(resolvedEntities.map((item) => [item.entityId, item]));
    const queue: Array<{ nodeId: string; hop: number; seed: ResolvedEntity }> = [];
    const visitedStates = new Set<string>();
    const accumulators = new Map<string, ExpansionAccumulator>();

    for (const seed of resolvedEntities) {
      queue.push({ nodeId: seed.entityId, hop: 0, seed });
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      if (current.hop >= normalizedMaxHops) {
        continue;
      }

      const outgoing = this.edgesByFrom.get(current.nodeId);
      if (!outgoing || outgoing.size === 0) {
        continue;
      }

      const currentNode = this.nodesById.get(current.nodeId);

      for (const edge of outgoing.values()) {
        const nextNode = this.nodesById.get(edge.toId);
        if (!nextNode) {
          continue;
        }

        const nextHop = current.hop + 1;
        const transitionScore =
          (current.seed.score * this.getRelationWeight(edge.relation) * edge.confidence) / nextHop;

        const relationLabel =
          edge.relation === "semantic_frontmatter" && edge.semanticPredicate
            ? `${edge.relation}:${edge.semanticPredicate}`
            : edge.relation;

        const relationPath = `${currentNode?.canonicalName || edge.fromId} --${relationLabel}--> ${nextNode.canonicalName}`;

        let accumulator = accumulators.get(edge.toId);
        if (!accumulator) {
          accumulator = {
            score: 0,
            hopDepth: nextHop,
            relationTypes: new Set<EntityRelationType>(),
            matchedEntities: new Set<string>(),
            relationPaths: [],
            evidenceRefs: [],
            evidenceCount: 0,
          };
          accumulators.set(edge.toId, accumulator);
        }

        accumulator.score += transitionScore;
        accumulator.hopDepth = Math.min(accumulator.hopDepth, nextHop);
        accumulator.relationTypes.add(edge.relation);
        accumulator.matchedEntities.add(current.seed.canonicalName);
        if (
          accumulator.relationPaths.length < 6 &&
          !accumulator.relationPaths.includes(relationPath)
        ) {
          accumulator.relationPaths.push(relationPath);
        }

        for (const evidence of edge.evidence) {
          if (
            accumulator.evidenceRefs.length < 16 &&
            !accumulator.evidenceRefs.some(
              (item) =>
                item.path === evidence.path &&
                item.chunkId === evidence.chunkId &&
                item.extractor === evidence.extractor
            )
          ) {
            accumulator.evidenceRefs.push(evidence);
          }
        }
        accumulator.evidenceCount += edge.evidence.length;

        const nextStateKey = `${edge.toId}:${nextHop}:${current.seed.entityId}`;
        if (!visitedStates.has(nextStateKey)) {
          visitedStates.add(nextStateKey);
          queue.push({ nodeId: edge.toId, hop: nextHop, seed: current.seed });
        }
      }
    }

    const hits = Array.from(accumulators.entries())
      .filter(([entityId]) => !resolvedById.has(entityId))
      .map(([entityId, accumulator]) => {
        const node = this.nodesById.get(entityId);
        if (!node) {
          return null;
        }

        const explanation: EntityGraphExplanation = {
          matchedEntities: Array.from(accumulator.matchedEntities),
          relationTypes: Array.from(accumulator.relationTypes),
          hopDepth: accumulator.hopDepth,
          evidenceCount: accumulator.evidenceCount,
          relationPaths: accumulator.relationPaths,
          evidenceRefs: accumulator.evidenceRefs,
          scoreContribution: accumulator.score,
        };

        return {
          path: node.path,
          title: node.canonicalName,
          score: accumulator.score,
          explanation,
        } as EntityGraphExpansionHit;
      })
      .filter((entry): entry is EntityGraphExpansionHit => entry !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, normalizedMaxExpandedDocs);

    return hits;
  }

  /**
   * Returns a node by canonical id.
   *
   * @param entityId - Canonical entity id.
   * @returns Entity node or undefined.
   */
  getNode(entityId: string): EntityNode | undefined {
    return this.nodesById.get(entityId);
  }

  /**
   * Gets all outgoing edges for a node id.
   *
   * @param entityId - Canonical entity id.
   * @returns Outgoing edges from this node.
   */
  getOutgoingEdges(entityId: string): EntityEdge[] {
    return Array.from(this.edgesByFrom.get(entityId)?.values() || []);
  }

  /**
   * Registers vault listeners to keep the graph synchronized with edits.
   */
  private registerVaultListeners(): void {
    const vaultWithEvents = this.app.vault as unknown as {
      on?: (
        eventName: "modify" | "create" | "rename" | "delete",
        callback: (...args: any[]) => unknown
      ) => unknown;
    };

    if (typeof vaultWithEvents.on !== "function") {
      return;
    }

    vaultWithEvents.on("modify", (file: TAbstractFile) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      void this.onFileModified(file);
    });

    vaultWithEvents.on("create", (file: TAbstractFile) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      void this.onFileModified(file);
    });

    vaultWithEvents.on("rename", (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      void this.onFileRenamed(file, oldPath);
    });

    vaultWithEvents.on("delete", (file: TAbstractFile) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      this.removeDescriptor(file.path);
      this.rebuildDirectRelationEdges();
      this.rebuildSharedRelationEdges();
    });
  }

  /**
   * Registers settings listeners to invalidate graph state when alias settings change.
   */
  private registerSettingsListeners(): void {
    subscribeToSettingsChange((prev, next) => {
      const prevAliases = JSON.stringify(prev.entityAliasFields || []);
      const nextAliases = JSON.stringify(next.entityAliasFields || []);
      const prevSemanticFields = JSON.stringify(prev.semanticEntityRelationFields || []);
      const nextSemanticFields = JSON.stringify(next.semanticEntityRelationFields || []);
      if (
        prevAliases !== nextAliases ||
        prev.enableSemanticEntityRelations !== next.enableSemanticEntityRelations ||
        prevSemanticFields !== nextSemanticFields ||
        prev.semanticEntityMinConfidence !== next.semanticEntityMinConfidence
      ) {
        this.invalidate();
      }
    });
  }

  /**
   * Handles note modification/create by upserting descriptor state.
   *
   * @param file - Modified note file.
   */
  private async onFileModified(file: TFile): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    const { inclusions, exclusions } = getMatchingPatterns();
    if (!shouldIndexFile(file, inclusions, exclusions)) {
      this.removeDescriptor(file.path);
      this.rebuildDirectRelationEdges();
      this.rebuildSharedRelationEdges();
      return;
    }

    const descriptor = this.buildDescriptor(file);
    if (!descriptor) {
      return;
    }

    this.upsertDescriptor(descriptor);
    this.rebuildDirectRelationEdges();
    this.rebuildSharedRelationEdges();
  }

  /**
   * Handles note rename by removing old contributions then indexing the new path.
   *
   * @param file - Renamed file reference.
   * @param oldPath - Previous vault-relative path.
   */
  private async onFileRenamed(file: TFile, oldPath: string): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    if (oldPath && oldPath !== file.path) {
      this.removeDescriptor(oldPath);
    }

    await this.onFileModified(file);
  }

  /**
   * Builds a deterministic index descriptor for one note.
   *
   * @param file - Markdown file to index.
   * @returns Indexed descriptor, or null if no metadata cache is available.
   */
  private buildDescriptor(file: TFile): IndexedFileDescriptor | null {
    const fileCache = this.app.metadataCache.getFileCache(file);

    const aliases = new Set<string>();
    aliases.add(this.normalizeAlias(file.basename));
    aliases.add(this.normalizeAlias(file.path));

    const aliasFields = this.getConfiguredAliasFields();
    const frontmatter = fileCache?.frontmatter || {};

    for (const aliasField of aliasFields) {
      const rawValue = (frontmatter as Record<string, unknown>)[aliasField];
      this.extractAliasValues(rawValue).forEach((alias) => aliases.add(alias));
    }

    const tags = new Set<string>(
      (fileCache?.tags || []).map((tag) => this.normalizeAlias(tag.tag))
    );
    const headings = new Set<string>(
      (fileCache?.headings || []).map((heading) => this.normalizeAlias(heading.heading))
    );

    const outgoingTargets = new Set<string>();
    const links = fileCache?.links || [];
    for (const link of links) {
      if (!link?.link) {
        continue;
      }
      const resolved = this.resolveNotePath(link.link, file.path);
      if (resolved && resolved !== file.path) {
        outgoingTargets.add(resolved);
      }
      const normalizedLink = this.normalizeAlias(link.displayText || link.link);
      if (normalizedLink) {
        aliases.add(normalizedLink);
      }
    }

    const frontmatterTargets = new Set<string>();
    this.extractFrontmatterReferenceCandidates(frontmatter).forEach((candidate) => {
      const resolved = this.resolveNotePath(candidate, file.path);
      if (resolved && resolved !== file.path) {
        frontmatterTargets.add(resolved);
      }
    });

    const semanticRelations = this.extractSemanticFrontmatterRelations(frontmatter, file.path);

    return {
      path: file.path,
      title: file.basename,
      mtime: file.stat.mtime,
      tags,
      headings,
      outgoingTargets,
      frontmatterTargets,
      aliases,
      semanticRelations,
    };
  }

  /**
   * Upserts one file descriptor and updates node/alias/direct-edge state.
   *
   * @param descriptor - Descriptor to insert or replace.
   */
  private upsertDescriptor(descriptor: IndexedFileDescriptor): void {
    this.removeDescriptor(descriptor.path);

    const node: EntityNode = {
      id: descriptor.path,
      canonicalName: descriptor.title,
      type: "note",
      aliases: Array.from(descriptor.aliases),
      path: descriptor.path,
      mtime: descriptor.mtime,
      tags: Array.from(descriptor.tags),
    };

    this.nodesById.set(node.id, node);
    this.descriptorsByPath.set(descriptor.path, descriptor);

    for (const alias of descriptor.aliases) {
      this.addAlias(alias, node.id);
    }
  }

  /**
   * Removes all contributions associated with one source path.
   *
   * @param path - Source note path to remove.
   */
  private removeDescriptor(path: string): void {
    const existingDescriptor = this.descriptorsByPath.get(path);
    if (!existingDescriptor) {
      return;
    }

    for (const alias of existingDescriptor.aliases) {
      this.removeAlias(alias, path);
    }

    this.removeEdgesFromSourcePath(path);
    this.removeEdgesReferencingNode(path);

    this.nodesById.delete(path);
    this.descriptorsByPath.delete(path);
  }

  /**
   * Rebuilds shared-tag and heading-cooccurrence edges from active descriptors.
   */
  private rebuildSharedRelationEdges(): void {
    this.removeEdgesByRelation("shared_tag");
    this.removeEdgesByRelation("heading_cooccurrence");

    const tagGroups = new Map<string, string[]>();
    const headingGroups = new Map<string, string[]>();

    for (const descriptor of this.descriptorsByPath.values()) {
      for (const tag of descriptor.tags) {
        if (!tag || tag.length < 2) {
          continue;
        }
        const normalizedTag = tag.startsWith("#") ? tag : `#${tag}`;
        const group = tagGroups.get(normalizedTag) || [];
        group.push(descriptor.path);
        tagGroups.set(normalizedTag, group);
      }

      for (const heading of descriptor.headings) {
        if (!heading || heading.length < 3) {
          continue;
        }
        const group = headingGroups.get(heading) || [];
        group.push(descriptor.path);
        headingGroups.set(heading, group);
      }
    }

    this.buildPairwiseSharedEdges(tagGroups, "shared_tag", 0.7);
    this.buildPairwiseSharedEdges(headingGroups, "heading_cooccurrence", 0.55);
  }

  /**
   * Rebuilds direct link/backlink/frontmatter edges from active descriptors.
   */
  private rebuildDirectRelationEdges(): void {
    this.removeEdgesByRelation("wiki_link");
    this.removeEdgesByRelation("backlink");
    this.removeEdgesByRelation("frontmatter_reference");
    this.removeEdgesByRelation("semantic_frontmatter");
    this.sourcePathToEdgeIds.clear();

    for (const descriptor of this.descriptorsByPath.values()) {
      const linkEvidence: EntityEvidenceRef = {
        path: descriptor.path,
        chunkId: `${descriptor.path}#0`,
        mtime: descriptor.mtime,
        extractor: "wiki_link",
      };

      for (const targetPath of descriptor.outgoingTargets) {
        this.addEdge(descriptor.path, targetPath, "wiki_link", 0.95, linkEvidence, descriptor.path);
        this.addEdge(
          targetPath,
          descriptor.path,
          "backlink",
          0.9,
          {
            ...linkEvidence,
            extractor: "backlink",
          },
          descriptor.path
        );
      }

      const frontmatterEvidence: EntityEvidenceRef = {
        path: descriptor.path,
        chunkId: `${descriptor.path}#0`,
        mtime: descriptor.mtime,
        extractor: "frontmatter_reference",
      };

      for (const targetPath of descriptor.frontmatterTargets) {
        this.addEdge(
          descriptor.path,
          targetPath,
          "frontmatter_reference",
          0.9,
          frontmatterEvidence,
          descriptor.path
        );
      }

      const semanticEvidence: EntityEvidenceRef = {
        path: descriptor.path,
        chunkId: `${descriptor.path}#0`,
        mtime: descriptor.mtime,
        extractor: "semantic_frontmatter",
      };

      for (const semanticRelation of descriptor.semanticRelations) {
        this.addEdge(
          descriptor.path,
          semanticRelation.targetPath,
          "semantic_frontmatter",
          semanticRelation.confidence,
          semanticEvidence,
          descriptor.path,
          semanticRelation.predicate
        );
      }
    }
  }

  /**
   * Creates pairwise shared-relation edges for grouped descriptors.
   *
   * @param groups - Group map keyed by normalized group label.
   * @param relation - Shared relation type.
   * @param confidence - Relation confidence score.
   */
  private buildPairwiseSharedEdges(
    groups: Map<string, string[]>,
    relation: "shared_tag" | "heading_cooccurrence",
    confidence: number
  ): void {
    const MAX_GROUP_SIZE = 24;

    for (const paths of groups.values()) {
      const uniquePaths = Array.from(new Set(paths)).slice(0, MAX_GROUP_SIZE);
      if (uniquePaths.length < 2) {
        continue;
      }

      for (let i = 0; i < uniquePaths.length; i++) {
        for (let j = i + 1; j < uniquePaths.length; j++) {
          const fromPath = uniquePaths[i];
          const toPath = uniquePaths[j];
          const fromNode = this.nodesById.get(fromPath);
          const toNode = this.nodesById.get(toPath);
          if (!fromNode || !toNode) {
            continue;
          }

          const evidenceBase: EntityEvidenceRef = {
            path: fromPath,
            chunkId: `${fromPath}#0`,
            mtime: fromNode.mtime,
            extractor: relation,
          };

          this.addEdge(fromPath, toPath, relation, confidence, evidenceBase);
          this.addEdge(toPath, fromPath, relation, confidence, {
            path: toPath,
            chunkId: `${toPath}#0`,
            mtime: toNode.mtime,
            extractor: relation,
          });
        }
      }
    }
  }

  /**
   * Adds an edge to the adjacency map.
   *
   * @param fromId - Source node id.
   * @param toId - Destination node id.
   * @param relation - Relation type.
   * @param confidence - Confidence score.
   * @param evidence - Evidence record.
   * @param sourcePath - Optional source path used for direct edge removal tracking.
   */
  private addEdge(
    fromId: string,
    toId: string,
    relation: EntityRelationType,
    confidence: number,
    evidence: EntityEvidenceRef,
    sourcePath?: string,
    semanticPredicate?: EntitySemanticPredicate
  ): void {
    if (fromId === toId) {
      return;
    }

    if (!this.nodesById.has(fromId) || !this.nodesById.has(toId)) {
      return;
    }

    const edgeId = `${fromId}|${relation}${semanticPredicate ? `:${semanticPredicate}` : ""}|${toId}`;
    let outgoing = this.edgesByFrom.get(fromId);
    if (!outgoing) {
      outgoing = new Map<string, EntityEdge>();
      this.edgesByFrom.set(fromId, outgoing);
    }

    const existing = outgoing.get(edgeId);
    if (!existing) {
      outgoing.set(edgeId, {
        id: edgeId,
        fromId,
        toId,
        relation,
        confidence: Math.max(0.1, Math.min(1, confidence)),
        semanticPredicate,
        evidence: [evidence],
      });
      this.edgeIdToFromId.set(edgeId, fromId);
    } else if (
      !existing.evidence.some(
        (item) =>
          item.path === evidence.path &&
          item.chunkId === evidence.chunkId &&
          item.extractor === evidence.extractor
      )
    ) {
      existing.evidence.push(evidence);
    }

    if (sourcePath) {
      let edgeIds = this.sourcePathToEdgeIds.get(sourcePath);
      if (!edgeIds) {
        edgeIds = new Set<string>();
        this.sourcePathToEdgeIds.set(sourcePath, edgeIds);
      }
      edgeIds.add(edgeId);
    }
  }

  /**
   * Removes edges recorded for one source path.
   *
   * @param path - Source path whose direct edge contributions should be removed.
   */
  private removeEdgesFromSourcePath(path: string): void {
    const edgeIds = this.sourcePathToEdgeIds.get(path);
    if (!edgeIds) {
      return;
    }

    for (const edgeId of edgeIds) {
      const fromId = this.edgeIdToFromId.get(edgeId);
      if (!fromId) {
        continue;
      }
      const outgoing = this.edgesByFrom.get(fromId);
      if (!outgoing) {
        continue;
      }
      outgoing.delete(edgeId);
      this.edgeIdToFromId.delete(edgeId);
      if (outgoing.size === 0) {
        this.edgesByFrom.delete(fromId);
      }
    }

    this.sourcePathToEdgeIds.delete(path);
  }

  /**
   * Removes all edges whose source or destination references a node.
   *
   * @param nodeId - Node id that was removed.
   */
  private removeEdgesReferencingNode(nodeId: string): void {
    // Remove all outgoing from node.
    const outgoing = this.edgesByFrom.get(nodeId);
    if (outgoing) {
      for (const edgeId of outgoing.keys()) {
        this.edgeIdToFromId.delete(edgeId);
      }
      this.edgesByFrom.delete(nodeId);
    }

    // Remove all incoming to node.
    for (const [fromId, edgeMap] of this.edgesByFrom.entries()) {
      for (const [edgeId, edge] of edgeMap.entries()) {
        if (edge.toId === nodeId) {
          edgeMap.delete(edgeId);
          this.edgeIdToFromId.delete(edgeId);
        }
      }
      if (edgeMap.size === 0) {
        this.edgesByFrom.delete(fromId);
      }
    }
  }

  /**
   * Removes all edges for a specific relation type.
   *
   * @param relation - Relation type to remove.
   */
  private removeEdgesByRelation(relation: EntityRelationType): void {
    for (const [fromId, edgeMap] of this.edgesByFrom.entries()) {
      for (const [edgeId, edge] of edgeMap.entries()) {
        if (edge.relation !== relation) {
          continue;
        }
        edgeMap.delete(edgeId);
        this.edgeIdToFromId.delete(edgeId);
      }

      if (edgeMap.size === 0) {
        this.edgesByFrom.delete(fromId);
      }
    }
  }

  /**
   * Clears all in-memory graph state.
   */
  private clearAllState(): void {
    this.nodesById.clear();
    this.aliasesToEntityIds.clear();
    this.edgesByFrom.clear();
    this.edgeIdToFromId.clear();
    this.sourcePathToEdgeIds.clear();
    this.descriptorsByPath.clear();
  }

  /**
   * Adds one alias mapping.
   *
   * @param alias - Normalized alias.
   * @param entityId - Canonical entity id.
   */
  private addAlias(alias: string, entityId: string): void {
    const normalized = this.normalizeAlias(alias);
    if (!normalized) {
      return;
    }

    const bucket = this.aliasesToEntityIds.get(normalized) || new Set<string>();
    bucket.add(entityId);
    this.aliasesToEntityIds.set(normalized, bucket);
  }

  /**
   * Removes one alias mapping.
   *
   * @param alias - Normalized alias.
   * @param entityId - Canonical entity id.
   */
  private removeAlias(alias: string, entityId: string): void {
    const normalized = this.normalizeAlias(alias);
    const bucket = this.aliasesToEntityIds.get(normalized);
    if (!bucket) {
      return;
    }

    bucket.delete(entityId);
    if (bucket.size === 0) {
      this.aliasesToEntityIds.delete(normalized);
    }
  }

  /**
   * Gets configured frontmatter alias field names from settings.
   */
  private getConfiguredAliasFields(): string[] {
    const fields = getSettings().entityAliasFields;
    if (!Array.isArray(fields)) {
      return [];
    }

    return fields
      .map((field) => field.trim())
      .filter((field) => field.length > 0)
      .slice(0, 24);
  }

  /**
   * Returns whether semantic relation extraction from frontmatter is enabled.
   */
  private isSemanticRelationExtractionEnabled(): boolean {
    return getSettings().enableSemanticEntityRelations === true;
  }

  /**
   * Gets configured semantic relation field names from settings.
   */
  private getConfiguredSemanticRelationFields(): string[] {
    const fields = getSettings().semanticEntityRelationFields;
    if (!Array.isArray(fields)) {
      return [];
    }

    return fields
      .map((field) => field.trim())
      .filter((field) => field.length > 0)
      .slice(0, 24);
  }

  /**
   * Gets semantic confidence threshold from settings (0-100).
   */
  private getSemanticMinimumConfidence(): number {
    const configured = Number(getSettings().semanticEntityMinConfidence);
    if (isNaN(configured)) {
      return 70;
    }

    return Math.min(100, Math.max(0, Math.floor(configured)));
  }

  /**
   * Extracts semantic worldbuilding relations from frontmatter.
   *
   * Supports canonical relation-array fields (configured via settings) and fixed convenience keys.
   */
  private extractSemanticFrontmatterRelations(
    frontmatter: unknown,
    sourcePath: string
  ): SemanticRelationDescriptor[] {
    if (!this.isSemanticRelationExtractionEnabled()) {
      return [];
    }

    if (!frontmatter || typeof frontmatter !== "object") {
      return [];
    }

    const minimumConfidence = this.getSemanticMinimumConfidence();
    const fixedKeyPredicates: Readonly<Record<string, EntitySemanticPredicate>> = {
      parentOf: "parent_of",
      childOf: "child_of",
      siblingOf: "sibling_of",
      spouseOf: "spouse_of",
      houseOf: "house_of",
      alliedWith: "allied_with",
      rivalOf: "rival_of",
      rules: "rules",
      ruledBy: "ruled_by",
      vassalOf: "vassal_of",
      overlordOf: "overlord_of",
      memberOf: "member_of",
      leads: "leads",
      founded: "founded",
      foundedBy: "founded_by",
      locatedIn: "located_in",
      governs: "governs",
      borders: "borders",
      partOf: "part_of",
      participatedIn: "participated_in",
      occurredAt: "occurred_at",
      duringEra: "during_era",
      wields: "wields",
      boundTo: "bound_to",
      artifactOf: "artifact_of",
    };

    const frontmatterRecord = frontmatter as Record<string, unknown>;
    const extracted: SemanticRelationDescriptor[] = [];

    for (const configuredField of this.getConfiguredSemanticRelationFields()) {
      this.collectSemanticRelationsFromValue(
        frontmatterRecord[configuredField],
        sourcePath,
        configuredField,
        undefined,
        minimumConfidence,
        extracted
      );
    }

    Object.entries(fixedKeyPredicates).forEach(([fieldName, predicate]) => {
      this.collectSemanticRelationsFromValue(
        frontmatterRecord[fieldName],
        sourcePath,
        fieldName,
        predicate,
        minimumConfidence,
        extracted
      );
    });

    const dedupedByKey = new Map<string, SemanticRelationDescriptor>();
    for (const relation of extracted) {
      const key = `${relation.targetPath}|${relation.predicate}`;
      const existing = dedupedByKey.get(key);
      if (!existing || relation.confidence > existing.confidence) {
        dedupedByKey.set(key, relation);
      }
    }

    return Array.from(dedupedByKey.values());
  }

  /**
   * Collects semantic relations recursively from one frontmatter value.
   */
  private collectSemanticRelationsFromValue(
    value: unknown,
    sourcePath: string,
    sourceField: string,
    defaultPredicate: EntitySemanticPredicate | undefined,
    minimumConfidence: number,
    out: SemanticRelationDescriptor[]
  ): void {
    if (value === undefined || value === null) {
      return;
    }

    if (typeof value === "string") {
      if (!defaultPredicate) {
        return;
      }

      this.resolveSemanticRelationTargets(value, sourcePath).forEach((targetPath) => {
        out.push({
          targetPath,
          predicate: defaultPredicate,
          confidence: this.normalizeSemanticConfidence(undefined, minimumConfidence),
          sourceField,
        });
      });
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) =>
        this.collectSemanticRelationsFromValue(
          entry,
          sourcePath,
          sourceField,
          defaultPredicate,
          minimumConfidence,
          out
        )
      );
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    const predicate = parseSemanticPredicate(
      record.predicate || record.relation || record.type || defaultPredicate
    );
    if (!predicate) {
      return;
    }

    const confidence = this.normalizeSemanticConfidence(record.confidence, minimumConfidence);
    const rawTarget = record.target || record.to || record.entity || record.path || record.note;
    this.resolveSemanticRelationTargets(rawTarget, sourcePath).forEach((targetPath) => {
      out.push({
        targetPath,
        predicate,
        confidence,
        sourceField,
      });
    });
  }

  /**
   * Resolves relation targets from mixed target values.
   */
  private resolveSemanticRelationTargets(value: unknown, sourcePath: string): string[] {
    const candidates = new Set<string>();

    const visit = (input: unknown) => {
      if (typeof input === "string") {
        const wikiLinkMatches = input.match(/\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]/g) || [];
        if (wikiLinkMatches.length > 0) {
          for (const rawMatch of wikiLinkMatches) {
            const inner = rawMatch.replace(/^\[\[/, "").replace(/\]\]$/, "");
            const [pathPart] = inner.split("|");
            const normalized = pathPart.split("#")[0].trim();
            if (normalized) {
              candidates.add(normalized);
            }
          }
          return;
        }

        const trimmed = input.trim();
        if (trimmed.length > 0) {
          candidates.add(trimmed);
        }
        return;
      }

      if (Array.isArray(input)) {
        input.forEach(visit);
        return;
      }

      if (input && typeof input === "object") {
        Object.values(input as Record<string, unknown>).forEach(visit);
      }
    };

    visit(value);

    const resolved = new Set<string>();
    candidates.forEach((candidate) => {
      const targetPath = this.resolveNotePath(candidate, sourcePath);
      if (targetPath && targetPath !== sourcePath) {
        resolved.add(targetPath);
      }
    });

    return Array.from(resolved);
  }

  /**
   * Normalizes relation confidence values to [0.1, 1].
   */
  private normalizeSemanticConfidence(value: unknown, defaultPercent: number): number {
    const parsedValue = Number(value);
    if (isNaN(parsedValue)) {
      return Math.max(0.1, Math.min(1, defaultPercent / 100));
    }

    if (parsedValue <= 1) {
      return Math.max(0.1, Math.min(1, parsedValue));
    }

    return Math.max(0.1, Math.min(1, parsedValue / 100));
  }

  /**
   * Extracts normalized alias values from a frontmatter value.
   *
   * @param value - Raw frontmatter alias field value.
   * @returns Normalized aliases.
   */
  private extractAliasValues(value: unknown): string[] {
    const aliases = new Set<string>();

    const visit = (input: unknown) => {
      if (typeof input === "string") {
        const normalized = this.normalizeAlias(input);
        if (normalized) {
          aliases.add(normalized);
        }
        return;
      }

      if (Array.isArray(input)) {
        input.forEach(visit);
      }
    };

    visit(value);

    return Array.from(aliases);
  }

  /**
   * Extracts link-like frontmatter reference candidates recursively.
   *
   * @param frontmatter - Raw frontmatter object.
   * @returns Potential link candidates.
   */
  private extractFrontmatterReferenceCandidates(frontmatter: unknown): string[] {
    const candidates = new Set<string>();

    const visit = (value: unknown) => {
      if (typeof value === "string") {
        const wikiLinkMatches = value.match(/\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]/g) || [];
        for (const rawMatch of wikiLinkMatches) {
          const inner = rawMatch.replace(/^\[\[/, "").replace(/\]\]$/, "");
          const [pathPart] = inner.split("|");
          const normalized = pathPart.split("#")[0].trim();
          if (normalized) {
            candidates.add(normalized);
          }
        }

        if (!wikiLinkMatches.length) {
          const trimmed = value.trim();
          if (trimmed.length > 0 && (trimmed.includes("/") || trimmed.endsWith(".md"))) {
            candidates.add(trimmed);
          }
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      if (value && typeof value === "object") {
        Object.values(value as Record<string, unknown>).forEach(visit);
      }
    };

    visit(frontmatter);
    return Array.from(candidates);
  }

  /**
   * Resolves a note reference candidate to a vault-relative note path.
   *
   * @param candidate - Raw candidate path/link.
   * @param sourcePath - Source note path used for Obsidian link resolution.
   * @returns Resolved note path or null.
   */
  private resolveNotePath(candidate: string, sourcePath: string): string | null {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }

    const resolved = this.app.metadataCache.getFirstLinkpathDest(trimmed, sourcePath);
    if (resolved instanceof TFile && resolved.extension === "md") {
      return resolved.path;
    }

    return null;
  }

  /**
   * Normalizes an alias/token for deterministic matching.
   *
   * @param value - Raw alias string.
   * @returns Normalized alias string.
   */
  private normalizeAlias(value: string): string {
    return String(value || "")
      .toLowerCase()
      .replace(/[[\](){}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Generates candidate alias terms (full query + n-grams) for matching.
   *
   * @param normalizedQuery - Normalized query text.
   * @returns Candidate terms ordered from strongest to weakest.
   */
  private generateCandidateAliasTerms(normalizedQuery: string): string[] {
    const candidates = new Set<string>();
    candidates.add(normalizedQuery);

    let tokens: string[] = [];
    try {
      tokens = normalizedQuery.match(/[\p{L}\p{N}_-]+/gu) || [];
    } catch {
      tokens = normalizedQuery.match(/[a-z0-9_-]+/g) || [];
    }

    const maxTokens = Math.min(tokens.length, 18);
    const clippedTokens = tokens.slice(0, maxTokens);

    for (let n = Math.min(4, clippedTokens.length); n >= 1; n--) {
      for (let i = 0; i + n <= clippedTokens.length; i++) {
        const phrase = clippedTokens
          .slice(i, i + n)
          .join(" ")
          .trim();
        if (phrase.length >= 2) {
          candidates.add(phrase);
        }
      }
    }

    return Array.from(candidates);
  }

  /**
   * Computes a resolution score for a candidate term.
   *
   * @param term - Candidate alias term.
   * @returns Relative score used to rank entity matches.
   */
  private computeTermScore(term: string): number {
    const tokenCount = term.split(" ").filter(Boolean).length;
    return tokenCount * 10 + Math.min(10, term.length / 4);
  }

  /**
   * Returns relation weight used by graph expansion scoring.
   *
   * @param relation - Relation type.
   * @returns Relation weight multiplier.
   */
  private getRelationWeight(relation: EntityRelationType): number {
    switch (relation) {
      case "wiki_link":
        return 1.0;
      case "frontmatter_reference":
        return 0.95;
      case "backlink":
        return 0.9;
      case "shared_tag":
        return 0.7;
      case "heading_cooccurrence":
        return 0.55;
      case "semantic_frontmatter":
        return 0.92;
      default:
        return 0.5;
    }
  }

  /**
   * Returns total edge count across adjacency maps.
   */
  private getEdgeCount(): number {
    let count = 0;
    for (const edgeMap of this.edgesByFrom.values()) {
      count += edgeMap.size;
    }
    return count;
  }
}

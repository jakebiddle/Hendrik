/**
 * Supported deterministic relation types used by the entity graph.
 */
export type EntityRelationType =
  | "wiki_link"
  | "backlink"
  | "shared_tag"
  | "frontmatter_reference"
  | "heading_cooccurrence"
  | "semantic_frontmatter";

/**
 * Canonical semantic predicates for worldbuilding-oriented relationships.
 */
export type EntitySemanticPredicate =
  | "parent_of"
  | "child_of"
  | "sibling_of"
  | "spouse_of"
  | "house_of"
  | "allied_with"
  | "rival_of"
  | "rules"
  | "ruled_by"
  | "vassal_of"
  | "overlord_of"
  | "member_of"
  | "leads"
  | "founded"
  | "founded_by"
  | "located_in"
  | "governs"
  | "borders"
  | "part_of"
  | "participated_in"
  | "occurred_at"
  | "during_era"
  | "wields"
  | "bound_to"
  | "artifact_of";

/**
 * Enumerates semantic predicates for UI options and validation.
 */
export const ENTITY_SEMANTIC_PREDICATES: EntitySemanticPredicate[] = [
  "parent_of",
  "child_of",
  "sibling_of",
  "spouse_of",
  "house_of",
  "allied_with",
  "rival_of",
  "rules",
  "ruled_by",
  "vassal_of",
  "overlord_of",
  "member_of",
  "leads",
  "founded",
  "founded_by",
  "located_in",
  "governs",
  "borders",
  "part_of",
  "participated_in",
  "occurred_at",
  "during_era",
  "wields",
  "bound_to",
  "artifact_of",
];

/**
 * Evidence pointer that explains where a relation was extracted from.
 */
export interface EntityEvidenceRef {
  /** Vault-relative note path that produced this evidence. */
  path: string;
  /** Optional chunk identifier for direct chunk-level evidence linking. */
  chunkId?: string;
  /** Source note modification time when the evidence was extracted. */
  mtime: number;
  /** Deterministic extractor identifier (e.g. "wiki_link", "shared_tag"). */
  extractor: EntityRelationType;
}

/**
 * Canonical entity node derived from a note.
 */
export interface EntityNode {
  /** Stable canonical ID (vault-relative note path). */
  id: string;
  /** Display-friendly canonical name (usually note basename). */
  canonicalName: string;
  /** High-level entity type for future extensibility. */
  type: "note";
  /** Normalized aliases mapped to this node. */
  aliases: string[];
  /** Back-reference to the canonical note path. */
  path: string;
  /** Last known note mtime used for indexing freshness. */
  mtime: number;
  /** Optional tags detected from metadata cache. */
  tags: string[];
}

/**
 * Directed relation edge between two entity nodes.
 */
export interface EntityEdge {
  /** Deterministic edge id `{from}|{relation}|{to}`. */
  id: string;
  /** Source entity id. */
  fromId: string;
  /** Destination entity id. */
  toId: string;
  /** Deterministic relation type. */
  relation: EntityRelationType;
  /** Confidence score in range [0, 1]. */
  confidence: number;
  /** Optional semantic predicate for semantic-frontmatter edges. */
  semanticPredicate?: EntitySemanticPredicate;
  /** Evidence references for auditing and UI drilldown. */
  evidence: EntityEvidenceRef[];
}

/**
 * Resolved entity match from a user query.
 */
export interface ResolvedEntity {
  /** Canonical entity id. */
  entityId: string;
  /** Canonical display name for rendering. */
  canonicalName: string;
  /** Query alias that matched the entity. */
  matchedAlias: string;
  /** Relative resolution score for ranking (higher is stronger match). */
  score: number;
}

/**
 * Per-document entity graph explanation surfaced in search/source UIs.
 */
export interface EntityGraphExplanation {
  /** Canonical entities that triggered graph expansion. */
  matchedEntities: string[];
  /** Relation types that connected this document to matched entities. */
  relationTypes: EntityRelationType[];
  /** Minimum hop distance from matched entities to this document. */
  hopDepth: number;
  /** Number of relation edges contributing to this match. */
  evidenceCount: number;
  /** Human-readable relation paths (short strings for UI display). */
  relationPaths: string[];
  /** Structured evidence refs for drilldown and debugging. */
  evidenceRefs: EntityEvidenceRef[];
  /** Blended graph score contribution used by retrieval merge. */
  scoreContribution: number;
}

/**
 * Internal graph expansion result used by the retriever.
 */
export interface EntityGraphExpansionHit {
  /** Target note path. */
  path: string;
  /** Canonical name of target note. */
  title: string;
  /** Computed graph relevance score. */
  score: number;
  /** Explanation payload to surface in metadata/UI. */
  explanation: EntityGraphExplanation;
}

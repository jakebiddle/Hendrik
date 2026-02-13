import { parseSemanticPredicate } from "./semanticPredicateUtils";
import {
  SemanticRelationProposal,
  SemanticRelationProposalSourceAdapter,
} from "./SemanticRelationBatchService";

const MAX_STORED_PROPOSALS = 2000;

/**
 * Session-scoped store for semantic relation proposals extracted from AI/tool outputs.
 */
export class SemanticRelationProposalStore {
  private static instance: SemanticRelationProposalStore | null = null;

  private proposals = new Map<string, SemanticRelationProposal>();

  /**
   * Returns shared singleton instance.
   */
  static getInstance(): SemanticRelationProposalStore {
    if (!SemanticRelationProposalStore.instance) {
      SemanticRelationProposalStore.instance = new SemanticRelationProposalStore();
    }

    return SemanticRelationProposalStore.instance;
  }

  /**
   * Ingests one tool output payload and stores any semantic relation proposals found.
   */
  ingestFromToolOutput(toolName: string, payload: unknown): number {
    const extracted = extractSemanticRelationProposalsFromPayload(payload);
    return this.ingestProposals(extracted, `tool:${toolName}`);
  }

  /**
   * Extracts proposal candidates from tool/LLM output payloads without mutating store state.
   */
  extractSemanticRelationProposalsFromToolText(payload: unknown): SemanticRelationProposal[] {
    return extractSemanticRelationProposalsFromPayload(payload);
  }

  /**
   * Ingests explicit proposal arrays and returns number accepted.
   */
  ingestProposals(proposals: SemanticRelationProposal[], defaultSourceField: string): number {
    if (!Array.isArray(proposals) || proposals.length === 0) {
      return 0;
    }

    const normalizedProposals = proposals
      .map((proposal) => normalizeProposalCandidate(proposal))
      .filter((proposal): proposal is SemanticRelationProposal => proposal !== null)
      .map((proposal) => ({
        ...proposal,
        sourceField:
          typeof proposal.sourceField === "string" && proposal.sourceField.trim().length > 0
            ? proposal.sourceField.trim()
            : defaultSourceField,
      }));

    if (normalizedProposals.length === 0) {
      return 0;
    }

    const dedupedByKey = new Map<string, SemanticRelationProposal>();
    normalizedProposals.forEach((proposal) => {
      const key = this.getProposalKey(proposal);
      const existing = dedupedByKey.get(key);
      if (!existing) {
        dedupedByKey.set(key, proposal);
        return;
      }

      const existingConfidence = Number(existing.confidence) || 0;
      const nextConfidence = Number(proposal.confidence) || 0;
      if (nextConfidence >= existingConfidence) {
        dedupedByKey.set(key, proposal);
      }
    });

    let acceptedCount = 0;
    dedupedByKey.forEach((proposal, key) => {
      const existing = this.proposals.get(key);
      if (!existing) {
        this.proposals.set(key, proposal);
        acceptedCount += 1;
        return;
      }

      const existingConfidence = Number(existing.confidence) || 0;
      const nextConfidence = Number(proposal.confidence) || 0;
      if (nextConfidence >= existingConfidence) {
        this.proposals.set(key, proposal);
        acceptedCount += 1;
      }
    });

    this.enforceCapacity();
    return acceptedCount;
  }

  /**
   * Returns all currently buffered semantic relation proposals.
   */
  getAllProposals(): SemanticRelationProposal[] {
    return Array.from(this.proposals.values());
  }

  /**
   * Clears the proposal store.
   */
  clear(): void {
    this.proposals.clear();
  }

  /**
   * Creates a stable dedupe key for one proposal.
   */
  private getProposalKey(proposal: SemanticRelationProposal): string {
    return `${proposal.notePath}|${String(proposal.predicate)}|${proposal.targetPath}`;
  }

  /**
   * Enforces max in-memory capacity.
   */
  private enforceCapacity(): void {
    if (this.proposals.size <= MAX_STORED_PROPOSALS) {
      return;
    }

    const keys = Array.from(this.proposals.keys());
    const excess = this.proposals.size - MAX_STORED_PROPOSALS;
    for (let index = 0; index < excess; index++) {
      this.proposals.delete(keys[index]);
    }
  }
}

/**
 * Builds the default adapter that surfaces proposals extracted from tool outputs.
 */
export function createToolOutputSemanticRelationAdapter(): SemanticRelationProposalSourceAdapter {
  return {
    id: "tool-output-semantic-relations",
    label: "Tool Output Proposals",
    getProposals: () => SemanticRelationProposalStore.getInstance().getAllProposals(),
  };
}

/**
 * Extracts semantic relation proposal records from untrusted tool payload shapes.
 */
export function extractSemanticRelationProposalsFromPayload(
  payload: unknown
): SemanticRelationProposal[] {
  const proposalCandidates = collectProposalCandidates(payload);
  const dedupedProposals = new Map<string, SemanticRelationProposal>();

  proposalCandidates.forEach((candidate) => {
    const normalized = normalizeProposalCandidate(candidate);
    if (normalized) {
      const key = getProposalIdentityKey(normalized);
      const existing = dedupedProposals.get(key);
      if (!existing) {
        dedupedProposals.set(key, normalized);
        return;
      }

      const existingConfidence = Number(existing.confidence) || 0;
      const nextConfidence = Number(normalized.confidence) || 0;
      if (nextConfidence >= existingConfidence) {
        dedupedProposals.set(key, normalized);
      }
    }
  });

  return Array.from(dedupedProposals.values());
}

/**
 * Creates a stable identity key for proposal-level deduplication.
 */
function getProposalIdentityKey(proposal: SemanticRelationProposal): string {
  return `${proposal.notePath}|${String(proposal.predicate)}|${proposal.targetPath}`;
}

/**
 * Collects arrays of candidate proposal objects from nested payload containers.
 */
function collectProposalCandidates(payload: unknown): unknown[] {
  const queues: unknown[] = [payload];
  const collected: unknown[] = [];

  while (queues.length > 0) {
    const current = queues.shift();

    if (typeof current === "string") {
      const parsed = tryParseJsonPayload(current);
      if (parsed !== null) {
        queues.push(parsed);
      }

      extractEmbeddedJsonCandidatesFromText(current).forEach((candidate) => {
        queues.push(candidate);
      });

      extractToolCallPayloadsFromText(current).forEach((extracted) => {
        queues.push(extracted);
      });
      continue;
    }

    if (Array.isArray(current)) {
      current.forEach((item) => {
        if (isProposalLikeObject(item)) {
          collected.push(item);
        }
      });
      continue;
    }

    if (!current || typeof current !== "object") {
      continue;
    }

    const record = current as Record<string, unknown>;
    const candidateArrays: unknown[] = [
      record.semanticRelationProposals,
      record.semantic_relations,
      record.relationProposals,
      record.relations,
      record.proposals,
      record.items,
    ];

    candidateArrays.forEach((candidate) => {
      if (Array.isArray(candidate)) {
        queues.push(candidate);
      }
    });

    const nestedObjects: unknown[] = [record.data, record.result, record.payload];
    nestedObjects.forEach((nested) => {
      if (nested && typeof nested === "object") {
        queues.push(nested);
      }
    });
  }

  return collected;
}

/**
 * Checks whether an unknown value looks like one relation proposal candidate.
 */
function isProposalLikeObject(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const hasPredicate = typeof record.predicate === "string" || typeof record.relation === "string";
  const hasTarget =
    typeof record.target === "string" ||
    typeof record.targetPath === "string" ||
    typeof record.to === "string";
  const hasSource =
    typeof record.notePath === "string" ||
    typeof record.sourcePath === "string" ||
    typeof record.path === "string" ||
    typeof record.fromPath === "string";

  return hasPredicate && hasTarget && hasSource;
}

/**
 * Normalizes one candidate object to the canonical proposal format.
 */
function normalizeProposalCandidate(value: unknown): SemanticRelationProposal | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const notePath = normalizePathField(
    record.notePath || record.sourcePath || record.path || record.fromPath || record.from
  );
  const targetPath = normalizePathField(
    record.targetPath || record.target || record.to || record.entity
  );
  const predicate = parseSemanticPredicate(record.predicate || record.relation || record.type);

  if (!notePath || !targetPath || !predicate) {
    return null;
  }

  const normalized: SemanticRelationProposal = {
    notePath,
    targetPath,
    predicate,
    confidence: normalizeConfidence(record.confidence),
  };

  if (typeof record.sourceField === "string" && record.sourceField.trim().length > 0) {
    normalized.sourceField = record.sourceField.trim();
  }

  return normalized;
}

/**
 * Normalizes path fields and wiki-link path wrappers.
 */
function normalizePathField(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const wikiMatch = trimmed.match(/^\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]$/);
  const corePath = wikiMatch ? wikiMatch[1] : trimmed;
  const withoutSection = corePath.split("#")[0].split("|")[0].trim();
  if (!withoutSection) {
    return "";
  }

  return withoutSection.endsWith(".md") ? withoutSection : `${withoutSection}.md`;
}

/**
 * Normalizes confidence values to 0-100.
 */
function normalizeConfidence(value: unknown): number | undefined {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  if (parsed <= 1) {
    return Math.min(100, Math.max(0, Math.floor(parsed * 100)));
  }

  return Math.min(100, Math.max(0, Math.floor(parsed)));
}

/**
 * Parses JSON payloads, including encoded marker values (`ENC:...`).
 */
function tryParseJsonPayload(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const attempts: string[] = [trimmed];
  if (trimmed.startsWith("ENC:")) {
    try {
      attempts.push(decodeURIComponent(trimmed.slice(4)));
    } catch {
      // No-op: keep fallback parse attempts.
    }
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // Continue trying next variant.
    }

    const unescaped = attempt
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r");

    if (unescaped !== attempt) {
      try {
        return JSON.parse(unescaped);
      } catch {
        // Continue trying next variant.
      }
    }
  }

  return null;
}

/**
 * Extracts parseable JSON object/array fragments from arbitrary text.
 */
function extractEmbeddedJsonCandidatesFromText(value: string): unknown[] {
  if (!value || typeof value !== "string") {
    return [];
  }

  const candidates: unknown[] = [];
  const starts: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{" || value[index] === "[") {
      starts.push(index);
    }
  }

  starts.forEach((start) => {
    const fragment = extractBalancedJsonPayload(value, start);
    if (!fragment) {
      return;
    }

    const parsed = tryParseJsonPayload(fragment);
    if (parsed !== null) {
      candidates.push(parsed);
    }
  });

  return candidates;
}

/**
 * Extracts structured payloads from plain-text tool-call renderings.
 */
function extractToolCallPayloadsFromText(value: string): unknown[] {
  if (!value || !/submitSemanticRelationProposals/i.test(value)) {
    return [];
  }

  const parsedPayloads: unknown[] = [];
  const marker = /submitSemanticRelationProposals/gi;

  let match: RegExpExecArray | null;
  while ((match = marker.exec(value)) !== null) {
    const payloadStart = findFirstJsonStart(value, match.index + match[0].length);
    if (payloadStart < 0) {
      continue;
    }

    const payloadText = extractBalancedJsonPayload(value, payloadStart);
    if (!payloadText) {
      continue;
    }

    const parsed = tryParseJsonPayload(payloadText);
    if (parsed !== null) {
      parsedPayloads.push(parsed);
    }
  }

  return parsedPayloads;
}

/**
 * Finds the first JSON object/array start index at or after a given offset.
 */
function findFirstJsonStart(value: string, fromIndex: number): number {
  for (let index = fromIndex; index < value.length; index += 1) {
    const char = value[index];
    if (char === "{" || char === "[") {
      return index;
    }
  }

  return -1;
}

/**
 * Extracts a balanced JSON object/array segment from text.
 */
function extractBalancedJsonPayload(value: string, startIndex: number): string {
  const opening = value[startIndex];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : "";
  if (!closing) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opening) {
      depth += 1;
      continue;
    }

    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

import { getSettings } from "@/settings/model";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { logWarn } from "@/logger";
import { App, TFile } from "obsidian";
import { ENTITY_SEMANTIC_PREDICATES, EntitySemanticPredicate } from "./types";
import { parseSemanticPredicate } from "./semanticPredicateUtils";

/**
 * Editable row shown in semantic relation preview batches.
 */
export interface SemanticRelationDraftRow {
  id: string;
  notePath: string;
  sourceField: string;
  predicate: EntitySemanticPredicate;
  targetPath: string;
  confidence: number;
  proposalSource?: string;
}

/**
 * Grouped batch of editable semantic relation rows.
 */
export interface SemanticRelationDraftBatch {
  id: string;
  index: number;
  startRow: number;
  endRow: number;
  totalRows: number;
  rows: SemanticRelationDraftRow[];
}

/**
 * One semantic relation proposal produced by an adapter (for example an AI pass).
 */
export interface SemanticRelationProposal {
  notePath: string;
  predicate: EntitySemanticPredicate | string;
  targetPath: string;
  confidence?: number;
  sourceField?: string;
}

/**
 * Adapter contract for injecting proposal rows into the batch editor pipeline.
 */
export interface SemanticRelationProposalSourceAdapter {
  id: string;
  label?: string;
  getProposals: () => Promise<SemanticRelationProposal[]> | SemanticRelationProposal[];
}

/**
 * Options controlling which proposal sources are included in generated batches.
 */
export interface SemanticDraftBatchBuildOptions {
  includeVaultDrafts?: boolean;
  proposalAdapters?: SemanticRelationProposalSourceAdapter[];
}

/**
 * Result summary after applying one edited batch to frontmatter.
 */
export interface ApplySemanticBatchResult {
  updatedNotes: number;
  writtenRelations: number;
  skippedRows: number;
  errors: string[];
  rowResults: ApplySemanticBatchRowResult[];
}

/**
 * Per-row apply outcome for semantic batch persistence.
 */
export interface ApplySemanticBatchRowResult {
  rowId: string;
  notePath: string;
  targetPath: string;
  predicate: EntitySemanticPredicate;
  status: "applied" | "skipped" | "error";
  reason?: string;
}

/**
 * Service for generating, editing, and applying semantic relation frontmatter batches.
 */
export class SemanticRelationBatchService {
  constructor(private app: App) {}

  /**
   * Builds editable semantic relation draft batches from vault frontmatter.
   */
  async buildDraftBatches(
    options: SemanticDraftBatchBuildOptions = {}
  ): Promise<SemanticRelationDraftBatch[]> {
    const rows: SemanticRelationDraftRow[] = [];
    const includeVaultDrafts = options.includeVaultDrafts !== false;
    if (includeVaultDrafts) {
      rows.push(...(await this.collectDraftRows()));
    }

    rows.push(...(await this.collectRowsFromAdapters(options.proposalAdapters || [])));

    const dedupedRows = this.dedupeDraftRows(rows);
    const batchSize = this.getBatchSize();

    if (dedupedRows.length === 0) {
      return [];
    }

    const batches: SemanticRelationDraftBatch[] = [];
    for (let start = 0; start < dedupedRows.length; start += batchSize) {
      const endExclusive = Math.min(start + batchSize, dedupedRows.length);
      const index = batches.length;
      batches.push({
        id: `semantic-batch-${index + 1}`,
        index,
        startRow: start + 1,
        endRow: endExclusive,
        totalRows: dedupedRows.length,
        rows: dedupedRows.slice(start, endExclusive),
      });
    }

    return batches;
  }

  /**
   * Applies one edited batch into canonical frontmatter relation arrays.
   */
  async applyEditedBatch(rows: SemanticRelationDraftRow[]): Promise<ApplySemanticBatchResult> {
    const errors: string[] = [];
    const rowResults: ApplySemanticBatchRowResult[] = [];
    const validRows = rows.filter((row) => {
      const validationErrors = this.validateDraftRow(row);
      if (validationErrors.length === 0) {
        return true;
      }

      rowResults.push({
        rowId: row.id,
        notePath: row.notePath,
        targetPath: row.targetPath,
        predicate: row.predicate,
        status: "skipped",
        reason: validationErrors.join("; "),
      });
      return false;
    });
    const skippedRows = rows.length - validRows.length;

    const rowsByNotePath = new Map<string, SemanticRelationDraftRow[]>();
    for (const row of validRows) {
      const bucket = rowsByNotePath.get(row.notePath) || [];
      bucket.push(row);
      rowsByNotePath.set(row.notePath, bucket);
    }

    const canonicalField = this.getCanonicalRelationField();
    let updatedNotes = 0;
    let writtenRelations = 0;

    for (const [notePath, noteRows] of rowsByNotePath.entries()) {
      const abstractFile = this.app.vault.getAbstractFileByPath(notePath);
      if (!(abstractFile instanceof TFile) || abstractFile.extension !== "md") {
        errors.push(`Missing markdown note: ${notePath}`);
        noteRows.forEach((row) => {
          rowResults.push({
            rowId: row.id,
            notePath: row.notePath,
            targetPath: row.targetPath,
            predicate: row.predicate,
            status: "error",
            reason: "Missing markdown note",
          });
        });
        continue;
      }

      try {
        await this.app.fileManager.processFrontMatter(abstractFile, (frontmatter) => {
          const existingRelations = this.normalizeCanonicalRelations(frontmatter[canonicalField]);
          const relationMap = new Map<string, FrontmatterRelationRecord>();

          for (const relation of existingRelations) {
            relationMap.set(this.getRelationMapKey(relation), relation);
          }

          for (const row of noteRows) {
            const normalized: FrontmatterRelationRecord = {
              predicate: row.predicate,
              target: this.toWikiLink(row.targetPath),
              confidence: row.confidence,
              sourceField: row.sourceField,
            };
            relationMap.set(this.getRelationMapKey(normalized), normalized);
          }

          frontmatter[canonicalField] = Array.from(relationMap.values());
        });

        updatedNotes += 1;
        writtenRelations += noteRows.length;
        noteRows.forEach((row) => {
          rowResults.push({
            rowId: row.id,
            notePath: row.notePath,
            targetPath: row.targetPath,
            predicate: row.predicate,
            status: "applied",
          });
        });
      } catch (error) {
        const errorMessage = `Failed to update ${notePath}: ${String(error)}`;
        errors.push(errorMessage);
        noteRows.forEach((row) => {
          rowResults.push({
            rowId: row.id,
            notePath: row.notePath,
            targetPath: row.targetPath,
            predicate: row.predicate,
            status: "error",
            reason: errorMessage,
          });
        });
      }
    }

    return {
      updatedNotes,
      writtenRelations,
      skippedRows,
      errors,
      rowResults,
    };
  }

  /**
   * Collects semantic relation rows from all indexable markdown files.
   */
  private async collectDraftRows(): Promise<SemanticRelationDraftRow[]> {
    const rows: SemanticRelationDraftRow[] = [];
    const { inclusions, exclusions } = getMatchingPatterns();
    const markdownFiles = this.app.vault
      .getMarkdownFiles()
      .filter((file) => shouldIndexFile(file, inclusions, exclusions));

    for (const file of markdownFiles) {
      try {
        const fileCache = this.app.metadataCache.getFileCache(file);
        const frontmatter = fileCache?.frontmatter;
        if (!frontmatter || typeof frontmatter !== "object") {
          continue;
        }

        const noteRows = this.extractRowsFromFrontmatter(
          file.path,
          frontmatter as Record<string, unknown>
        );
        rows.push(...noteRows);
      } catch (error) {
        logWarn(`[SemanticRelationBatchService] Failed to inspect ${file.path}`, error);
      }
    }

    return rows;
  }

  /**
   * Collects semantic relation rows from injected proposal adapters.
   */
  private async collectRowsFromAdapters(
    proposalAdapters: SemanticRelationProposalSourceAdapter[]
  ): Promise<SemanticRelationDraftRow[]> {
    const rows: SemanticRelationDraftRow[] = [];
    const minimumConfidence = this.getMinimumConfidence();

    for (const adapter of proposalAdapters) {
      if (!adapter || typeof adapter.getProposals !== "function") {
        continue;
      }

      try {
        const proposals = await adapter.getProposals();
        if (!Array.isArray(proposals)) {
          continue;
        }

        proposals.forEach((proposal, index) => {
          const predicate = parsePredicate(proposal.predicate);
          if (!predicate) {
            return;
          }

          const notePath = this.normalizePathCandidate(proposal.notePath, proposal.notePath, true);
          const targetPath = this.normalizePathCandidate(
            proposal.targetPath,
            notePath || proposal.notePath,
            false
          );
          if (!notePath || !targetPath) {
            return;
          }

          rows.push({
            id: `adapter:${adapter.id}:${index}:${predicate}:${targetPath}`,
            notePath,
            sourceField:
              typeof proposal.sourceField === "string" && proposal.sourceField.trim().length > 0
                ? proposal.sourceField.trim()
                : `adapter:${adapter.id}`,
            predicate,
            targetPath,
            confidence: normalizeConfidence(proposal.confidence, minimumConfidence),
            proposalSource: adapter.label || adapter.id,
          });
        });
      } catch (error) {
        logWarn(`[SemanticRelationBatchService] Adapter failed: ${adapter.id}`, error);
      }
    }

    return rows;
  }

  /**
   * Deduplicates rows by note/predicate/target while preserving highest confidence.
   */
  private dedupeDraftRows(rows: SemanticRelationDraftRow[]): SemanticRelationDraftRow[] {
    const deduped = new Map<string, SemanticRelationDraftRow>();

    rows.forEach((row) => {
      const key = `${row.notePath}|${row.predicate}|${row.targetPath}`;
      const existing = deduped.get(key);
      if (!existing || row.confidence > existing.confidence) {
        deduped.set(key, row);
      }
    });

    return Array.from(deduped.values()).sort((left, right) => {
      if (left.notePath !== right.notePath) {
        return left.notePath.localeCompare(right.notePath);
      }
      if (left.predicate !== right.predicate) {
        return left.predicate.localeCompare(right.predicate);
      }
      return left.targetPath.localeCompare(right.targetPath);
    });
  }

  /**
   * Extracts semantic relation rows from one frontmatter object.
   */
  private extractRowsFromFrontmatter(
    notePath: string,
    frontmatter: Record<string, unknown>
  ): SemanticRelationDraftRow[] {
    const rows: SemanticRelationDraftRow[] = [];
    const minimumConfidence = this.getMinimumConfidence();

    for (const fieldName of this.getRelationFields()) {
      this.collectRowsFromValue(
        notePath,
        fieldName,
        frontmatter[fieldName],
        undefined,
        minimumConfidence,
        "vault-frontmatter",
        rows
      );
    }

    for (const [fieldName, predicate] of Object.entries(getFixedFieldPredicateMap())) {
      this.collectRowsFromValue(
        notePath,
        fieldName,
        frontmatter[fieldName],
        predicate,
        minimumConfidence,
        "vault-frontmatter",
        rows
      );
    }

    const deduped = new Map<string, SemanticRelationDraftRow>();
    for (const row of rows) {
      const key = `${row.notePath}|${row.predicate}|${row.targetPath}`;
      const existing = deduped.get(key);
      if (!existing || row.confidence > existing.confidence) {
        deduped.set(key, row);
      }
    }

    return Array.from(deduped.values());
  }

  /**
   * Recursively collects rows from one frontmatter field value.
   */
  private collectRowsFromValue(
    notePath: string,
    sourceField: string,
    value: unknown,
    defaultPredicate: EntitySemanticPredicate | undefined,
    minimumConfidence: number,
    proposalSource: string,
    out: SemanticRelationDraftRow[]
  ): void {
    if (value === undefined || value === null) {
      return;
    }

    if (typeof value === "string") {
      if (!defaultPredicate) {
        return;
      }

      this.resolveTargets(value, notePath).forEach((targetPath) => {
        out.push({
          id: this.createRowId(notePath, defaultPredicate, targetPath),
          notePath,
          sourceField,
          predicate: defaultPredicate,
          targetPath,
          confidence: minimumConfidence,
          proposalSource,
        });
      });
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) =>
        this.collectRowsFromValue(
          notePath,
          sourceField,
          entry,
          defaultPredicate,
          minimumConfidence,
          proposalSource,
          out
        )
      );
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    const predicate = parsePredicate(
      record.predicate || record.relation || record.type || defaultPredicate
    );
    if (!predicate) {
      return;
    }

    const confidence = normalizeConfidence(record.confidence, minimumConfidence);
    const targetValue = record.target || record.to || record.entity || record.path || record.note;
    this.resolveTargets(targetValue, notePath).forEach((targetPath) => {
      out.push({
        id: this.createRowId(notePath, predicate, targetPath),
        notePath,
        sourceField,
        predicate,
        targetPath,
        confidence,
        proposalSource,
      });
    });
  }

  /**
   * Resolves target paths from strings, arrays, or nested objects.
   */
  private resolveTargets(value: unknown, sourcePath: string): string[] {
    const rawCandidates = new Set<string>();

    const visit = (input: unknown) => {
      if (typeof input === "string") {
        const wikiLinkMatches = input.match(/\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]/g) || [];
        if (wikiLinkMatches.length > 0) {
          for (const rawMatch of wikiLinkMatches) {
            const inner = rawMatch.replace(/^\[\[/, "").replace(/\]\]$/, "");
            const [pathPart] = inner.split("|");
            const normalized = pathPart.split("#")[0].trim();
            if (normalized) {
              rawCandidates.add(normalized);
            }
          }
          return;
        }

        const trimmed = input.trim();
        if (trimmed.length > 0) {
          rawCandidates.add(trimmed);
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
    rawCandidates.forEach((candidate) => {
      const file =
        this.app.metadataCache.getFirstLinkpathDest(candidate, sourcePath) ||
        (!candidate.endsWith(".md")
          ? this.app.metadataCache.getFirstLinkpathDest(`${candidate}.md`, sourcePath)
          : null);
      if (file instanceof TFile && file.extension === "md" && file.path !== sourcePath) {
        resolved.add(file.path);
      }
    });

    return Array.from(resolved);
  }

  /**
   * Normalizes path-like candidates from adapters and resolves against metadata when possible.
   */
  private normalizePathCandidate(
    value: string,
    sourcePath: string,
    allowSelfReference: boolean
  ): string {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }

    const wikiMatch = raw.match(/^\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]$/);
    const normalizedCandidate = wikiMatch
      ? wikiMatch[1].trim()
      : raw.split("|")[0].split("#")[0].trim();
    if (!normalizedCandidate) {
      return "";
    }

    const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(
      normalizedCandidate,
      sourcePath
    );
    if (resolvedFile instanceof TFile && resolvedFile.extension === "md") {
      if (!allowSelfReference && resolvedFile.path === sourcePath) {
        return "";
      }
      return resolvedFile.path;
    }

    if (normalizedCandidate.includes("/") || normalizedCandidate.endsWith(".md")) {
      const withExtension = normalizedCandidate.endsWith(".md")
        ? normalizedCandidate
        : `${normalizedCandidate}.md`;
      if (!allowSelfReference && withExtension === sourcePath) {
        return "";
      }
      return withExtension;
    }

    return normalizedCandidate;
  }

  /**
   * Returns whether a row is valid for persistence.
   */
  private isValidDraftRow(row: SemanticRelationDraftRow): boolean {
    return this.validateDraftRow(row).length === 0;
  }

  /**
   * Validates one draft row and returns reasons when invalid.
   */
  private validateDraftRow(row: SemanticRelationDraftRow): string[] {
    const reasons: string[] = [];

    if (!row.notePath || !row.targetPath || !row.sourceField) {
      reasons.push("Missing required fields");
    }

    if (!ENTITY_SEMANTIC_PREDICATES.includes(row.predicate)) {
      reasons.push("Invalid predicate");
    }

    if (!(Number.isFinite(row.confidence) && row.confidence >= 0 && row.confidence <= 100)) {
      reasons.push("Confidence out of range");
    }

    return reasons;
  }

  /**
   * Gets configured semantic batch size.
   */
  private getBatchSize(): number {
    const configured = Number(getSettings().semanticEntityBatchSize);
    if (isNaN(configured)) {
      return 25;
    }

    return Math.min(200, Math.max(5, Math.floor(configured)));
  }

  /**
   * Gets configured minimum semantic confidence.
   */
  private getMinimumConfidence(): number {
    const configured = Number(getSettings().semanticEntityMinConfidence);
    if (isNaN(configured)) {
      return 70;
    }

    return Math.min(100, Math.max(0, Math.floor(configured)));
  }

  /**
   * Gets configured semantic relation fields.
   */
  private getRelationFields(): string[] {
    const configured = getSettings().semanticEntityRelationFields;
    if (!Array.isArray(configured)) {
      return ["relations"];
    }

    const normalized = configured
      .filter((field): field is string => typeof field === "string")
      .map((field) => field.trim())
      .filter((field) => field.length > 0)
      .slice(0, 24);

    return normalized.length > 0 ? normalized : ["relations"];
  }

  /**
   * Gets the canonical frontmatter field used to persist relation arrays.
   */
  private getCanonicalRelationField(): string {
    return this.getRelationFields()[0] || "relations";
  }

  /**
   * Converts a path into a wiki-link target string.
   */
  private toWikiLink(path: string): string {
    return `[[${path.replace(/\.md$/i, "")}]]`;
  }

  /**
   * Creates a stable key for frontmatter relation deduplication.
   */
  private getRelationMapKey(relation: FrontmatterRelationRecord): string {
    return `${relation.predicate}|${relation.target}`;
  }

  /**
   * Creates a deterministic draft row id.
   */
  private createRowId(
    notePath: string,
    predicate: EntitySemanticPredicate,
    targetPath: string
  ): string {
    return `${notePath}::${predicate}::${targetPath}`;
  }

  /**
   * Normalizes existing canonical relation arrays from frontmatter.
   */
  private normalizeCanonicalRelations(value: unknown): FrontmatterRelationRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const records: FrontmatterRelationRecord[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const record = item as Record<string, unknown>;
      const predicate = parsePredicate(record.predicate || record.relation || record.type);
      if (!predicate) {
        continue;
      }

      const target = typeof record.target === "string" ? record.target.trim() : "";
      if (!target) {
        continue;
      }

      records.push({
        predicate,
        target,
        confidence: Math.min(100, Math.max(0, Math.floor(Number(record.confidence) || 0))),
        sourceField:
          typeof record.sourceField === "string" && record.sourceField.trim().length > 0
            ? record.sourceField.trim()
            : "relations",
      });
    }

    return records;
  }
}

interface FrontmatterRelationRecord {
  predicate: EntitySemanticPredicate;
  target: string;
  confidence: number;
  sourceField: string;
}

/**
 * Maps convenience frontmatter keys to canonical predicates.
 */
function getFixedFieldPredicateMap(): Readonly<Record<string, EntitySemanticPredicate>> {
  return {
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
}

/**
 * Parses a predicate candidate into a canonical predicate value.
 */
function parsePredicate(value: unknown): EntitySemanticPredicate | null {
  return parseSemanticPredicate(value);
}

/**
 * Normalizes confidence values to 0-100 scale.
 */
function normalizeConfidence(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  if (isNaN(parsed)) {
    return defaultValue;
  }

  if (parsed <= 1) {
    return Math.min(100, Math.max(0, Math.floor(parsed * 100)));
  }

  return Math.min(100, Math.max(0, Math.floor(parsed)));
}

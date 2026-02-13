import { logInfo } from "@/logger";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { CompactionNoOpReason, CompactionResult, ParsedContextItem } from "@/types/compaction";
import { getSettings } from "@/settings/model";
import { HumanMessage } from "@langchain/core/messages";

interface CompactionOptions {
  targetCharCount?: number;
}

interface SummarizationProgress {
  summaries: Map<number, string>;
  replacements: Map<number, string>;
  estimatedLength: number;
  attemptedCount: number;
  failedCount: number;
  highFailureRate: boolean;
}

/**
 * ContextCompactor - Compresses large context using map-reduce summarization.
 *
 * ## How It Works
 *
 * When context attached to a user message exceeds a configurable threshold (in tokens),
 * this class automatically compresses it using a map-reduce pattern:
 *
 * ### 1. PARSE Phase
 * The XML-structured context is parsed into discrete items. Each context block
 * (note_context, active_note, url_content, etc.) becomes a separate item with:
 * - type: The XML tag name
 * - path: File path or URL
 * - title: Note/page title
 * - content: The actual text content
 * - metadata: Additional info (ctime, mtime)
 *
 * ### 2. MAP Phase (Parallel Summarization)
 * Candidate items are ranked by size and summarized in descending order.
 * - Uses low temperature (0.1) for deterministic output
 * - Max 3 concurrent requests to avoid API overload
 * - Failed summarizations keep original content
 * - Stops early once target budget is reached (when provided)
 * - If >50% fail, compaction aborts entirely (fail-safe)
 *
 * ### 3. REDUCE Phase (Rebuild)
 * Summarized items are recombined into the original XML structure.
 * - Preserves all metadata (title, path, timestamps)
 * - Marks summarized content with [SUMMARIZED] prefix
 * - Maintains item order for consistent citations
 *
 * ## Configuration
 *
 * The threshold is set in Settings > QA > Auto-Compact Threshold (in tokens).
 * Internally converted to chars using 4 chars/token estimate.
 * Set to 0 to disable auto-compaction.
 *
 * ## Example
 *
 * Before (500k chars):
 * ```xml
 * <note_context>
 *   <title>Research Notes</title>
 *   <path>notes/research.md</path>
 *   <content>[... 50,000 chars of content ...]</content>
 * </note_context>
 * ```
 *
 * After (~5k chars):
 * ```xml
 * <note_context>
 *   <title>Research Notes</title>
 *   <path>notes/research.md</path>
 *   <content>[SUMMARIZED]
 *   Key findings: ... (concise summary preserving main ideas)
 *   </content>
 * </note_context>
 * ```
 */
export class ContextCompactor {
  private static instance: ContextCompactor;
  private chatModelManager: ChatModelManager;

  /** Base item-size threshold used when there is no budget pressure. */
  private readonly BASE_MIN_ITEM_SIZE = 50000;
  /** Minimum floor so adaptive threshold can include medium-size blocks under pressure. */
  private readonly MIN_ITEM_SIZE_FLOOR = 4000;
  /** Max parallel LLM calls */
  private readonly MAX_CONCURRENCY = 3;
  /** Low temperature for deterministic summaries */
  private readonly TEMPERATURE = 0.1;
  /** Max chars per item before truncation */
  private readonly MAX_ITEM_SIZE = 500000;

  /** XML block types to parse */
  private readonly BLOCK_TYPES = [
    "note_context",
    "active_note",
    "url_content",
    "selected_text",
    "embedded_note",
    "embedded_pdf",
    "web_tab_context",
    "active_web_tab",
    "youtube_video_context",
  ];

  private readonly PROMPT = `Summarize the following content, preserving:
- Key concepts and main ideas
- Important facts, names, and dates
- Technical details relevant for Q&A

Keep the summary concise but information-dense. Output only the summary.

Title: {title}
Path: {path}

Content:
{content}

Summary:`;

  private constructor() {
    this.chatModelManager = ChatModelManager.getInstance();
  }

  static getInstance(): ContextCompactor {
    if (!ContextCompactor.instance) {
      ContextCompactor.instance = new ContextCompactor();
    }
    return ContextCompactor.instance;
  }

  /**
   * Compact context using map-reduce summarization.
   */
  async compact(content: string, options: CompactionOptions = {}): Promise<CompactionResult> {
    const originalCharCount = content.length;
    const targetCharCount = this.normalizeTargetCharCount(options.targetCharCount);
    logInfo(
      `[ContextCompactor] Starting compaction of ${originalCharCount} chars` +
        (targetCharCount !== null ? ` (target <= ${targetCharCount})` : "")
    );

    // Parse XML into items
    const items = this.parseItems(content);
    if (items.length === 0) {
      return this.noOpResult(content, "no_items", { targetCharCount });
    }

    // Context already fits the requested target (if present), no compaction needed.
    if (targetCharCount !== null && originalCharCount <= targetCharCount) {
      return this.noOpResult(content, "no_reduction", {
        itemsProcessed: items.length,
        targetCharCount,
      });
    }

    const candidateIndexes = this.selectCandidateIndexes(items, originalCharCount, targetCharCount);
    if (candidateIndexes.length === 0) {
      return this.noOpResult(content, "no_candidates", {
        itemsProcessed: items.length,
        targetCharCount,
      });
    }

    // Map: summarize candidate items in ranked batches
    const summaryProgress = await this.summarizeCandidates(
      items,
      candidateIndexes,
      originalCharCount,
      targetCharCount
    );
    if (summaryProgress.highFailureRate) {
      return this.noOpResult(content, "high_failure_rate", {
        itemsProcessed: items.length,
        itemsSummarized: summaryProgress.summaries.size,
        targetCharCount,
      });
    }

    if (summaryProgress.summaries.size === 0) {
      return this.noOpResult(content, "no_reduction", {
        itemsProcessed: items.length,
        targetCharCount,
      });
    }

    // Reduce: rebuild with summaries
    const compacted = this.rebuild(content, items, summaryProgress.replacements);
    if (compacted.length >= originalCharCount) {
      return this.noOpResult(content, "no_reduction", {
        itemsProcessed: items.length,
        itemsSummarized: summaryProgress.summaries.size,
        targetCharCount,
      });
    }

    const targetMet = targetCharCount !== null ? compacted.length <= targetCharCount : undefined;

    logInfo(
      `[ContextCompactor] Done: ${originalCharCount} -> ${compacted.length} chars ` +
        `(${((1 - compacted.length / originalCharCount) * 100).toFixed(0)}% reduction)` +
        (targetCharCount !== null ? `, targetMet=${String(targetMet)}` : "")
    );

    return {
      content: compacted,
      wasCompacted: true,
      originalCharCount,
      compactedCharCount: compacted.length,
      itemsProcessed: items.length,
      itemsSummarized: summaryProgress.summaries.size,
      targetCharCount: targetCharCount ?? undefined,
      targetMet,
    };
  }

  /**
   * Normalizes a target size into a non-negative integer, or null when absent.
   * @param targetCharCount - Optional target content size in characters
   * @returns Normalized target size, or null
   */
  private normalizeTargetCharCount(targetCharCount?: number): number | null {
    if (typeof targetCharCount !== "number" || !Number.isFinite(targetCharCount)) {
      return null;
    }

    return Math.max(0, Math.floor(targetCharCount));
  }

  /**
   * Creates a no-op compaction result when no compaction was performed.
   * @param content - The original content that was not compacted
   * @param noOpReason - Structured reason for why compaction was skipped
   * @param details - Optional counters and target metadata for diagnostics
   * @returns A CompactionResult indicating no changes were made
   */
  private noOpResult(
    content: string,
    noOpReason: CompactionNoOpReason,
    details: {
      itemsProcessed?: number;
      itemsSummarized?: number;
      targetCharCount?: number | null;
    } = {}
  ): CompactionResult {
    const targetCharCount =
      typeof details.targetCharCount === "number" ? details.targetCharCount : undefined;
    const targetMet = targetCharCount !== undefined ? content.length <= targetCharCount : undefined;

    logInfo(
      `[ContextCompactor] No-op (${noOpReason})` +
        (targetCharCount !== undefined ? ` target=${targetCharCount}` : "")
    );

    return {
      content,
      wasCompacted: false,
      originalCharCount: content.length,
      compactedCharCount: content.length,
      itemsProcessed: details.itemsProcessed ?? 0,
      itemsSummarized: details.itemsSummarized ?? 0,
      noOpReason,
      targetCharCount,
      targetMet,
    };
  }

  /**
   * Resolve candidate-size profile for the configured compaction mode.
   *
   * Conservative mode keeps more raw lore by targeting larger items first.
   * Aggressive mode includes smaller items under pressure.
   */
  private resolveCompactionModeProfile(): { baseMinItemSize: number; minItemFloor: number } {
    const mode = getSettings().contextCompactionMode;

    if (mode === "conservative") {
      return {
        baseMinItemSize: 80000,
        minItemFloor: 12000,
      };
    }

    if (mode === "aggressive") {
      return {
        baseMinItemSize: 32000,
        minItemFloor: 2000,
      };
    }

    return {
      baseMinItemSize: this.BASE_MIN_ITEM_SIZE,
      minItemFloor: this.MIN_ITEM_SIZE_FLOOR,
    };
  }

  /**
   * Resolve adaptive minimum item size based on compaction pressure.
   * @param originalCharCount - Original content size
   * @param targetCharCount - Target size requested by caller
   * @returns Minimum item size to summarize
   */
  private resolveAdaptiveMinItemSize(
    originalCharCount: number,
    targetCharCount: number | null
  ): number {
    const profile = this.resolveCompactionModeProfile();

    if (targetCharCount === null || originalCharCount <= 0) {
      return profile.baseMinItemSize;
    }

    const ratio = Math.min(Math.max(targetCharCount / originalCharCount, 0), 1);
    const pressureScale = Math.max(0.08, ratio * ratio);
    const adaptiveThreshold = Math.floor(profile.baseMinItemSize * pressureScale);
    return Math.max(profile.minItemFloor, adaptiveThreshold);
  }

  /**
   * Select candidate item indexes ordered by descending size.
   * @param items - Parsed context items
   * @param originalCharCount - Original content size
   * @param targetCharCount - Target size requested by caller
   * @returns Candidate indexes sorted by decreasing content length
   */
  private selectCandidateIndexes(
    items: ParsedContextItem[],
    originalCharCount: number,
    targetCharCount: number | null
  ): number[] {
    const minItemSize = this.resolveAdaptiveMinItemSize(originalCharCount, targetCharCount);

    const candidates = items
      .map((item, index) => ({ index, size: item.content.length }))
      .filter(({ size }) => size >= minItemSize)
      .sort((a, b) => b.size - a.size)
      .map(({ index }) => index);

    logInfo(
      `[ContextCompactor] Candidate threshold=${minItemSize}, candidates=${candidates.length}/${items.length}`
    );

    return candidates;
  }

  /**
   * Parse XML content into discrete items.
   * Filters out nested blocks to avoid overlapping replacements.
   */
  private parseItems(content: string): ParsedContextItem[] {
    const items: ParsedContextItem[] = [];

    for (const type of this.BLOCK_TYPES) {
      const regex = new RegExp(`<${type}>[\\s\\S]*?<\\/${type}>`, "g");
      let match;
      while ((match = regex.exec(content)) !== null) {
        const item = this.parseBlock(match[0], type, match.index);
        if (item) items.push(item);
      }
    }

    // Sort by start index
    items.sort((a, b) => a.startIndex - b.startIndex);

    // Filter out nested items (fully contained within another item)
    // This prevents overlapping replacements that corrupt indices
    return items.filter(
      (item, i) =>
        !items.some(
          (other, j) =>
            i !== j && other.startIndex <= item.startIndex && other.endIndex >= item.endIndex
        )
    );
  }

  /**
   * Parses a single XML block into a ParsedContextItem.
   * @param block - The raw XML block string
   * @param type - The type of context block (e.g., 'note_context', 'active_note')
   * @param startIndex - The character index where this block starts in the original content
   * @returns A ParsedContextItem or null if parsing fails
   */
  private parseBlock(block: string, type: string, startIndex: number): ParsedContextItem | null {
    const extract = (tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block)?.[1] || "";
    const extractContent = (): string => {
      const openTag = "<content>";
      const closeTag = "</content>";
      const start = block.indexOf(openTag);
      const end = block.lastIndexOf(closeTag);
      if (start === -1 || end === -1 || end < start) {
        return "";
      }
      return block.slice(start + openTag.length, end);
    };

    const path = extract("path") || extract("url");
    const title = extract("title") || path.split("/").pop() || "Untitled";
    const innerContent = extractContent();

    return {
      type,
      path,
      title,
      content: innerContent,
      metadata: { ctime: extract("ctime"), mtime: extract("mtime") },
      originalXml: block,
      startIndex,
      endIndex: startIndex + block.length,
    };
  }

  /**
   * Map phase: summarize candidate items in parallel batches.
   * Stops early when the estimated compacted size reaches the requested target.
   */
  private async summarizeCandidates(
    items: ParsedContextItem[],
    candidateIndexes: number[],
    originalCharCount: number,
    targetCharCount: number | null
  ): Promise<SummarizationProgress> {
    const summaries = new Map<number, string>();
    const replacements = new Map<number, string>();
    let estimatedLength = originalCharCount;
    let attemptedCount = 0;
    let failedCount = 0;

    logInfo(`[ContextCompactor] Summarizing up to ${candidateIndexes.length} candidate items`);

    // Process in batches
    for (let i = 0; i < candidateIndexes.length; i += this.MAX_CONCURRENCY) {
      if (targetCharCount !== null && estimatedLength <= targetCharCount) {
        break;
      }

      const batch = candidateIndexes.slice(i, i + this.MAX_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (index) => {
          const item = items[index];
          try {
            return { index, summary: await this.summarize(item) };
          } catch (e) {
            logInfo(`[ContextCompactor] Failed to summarize item ${index}:`, e);
            return { index, summary: null };
          }
        })
      );

      results.forEach(({ index, summary }) => {
        attemptedCount += 1;
        if (!summary) {
          failedCount += 1;
          return;
        }

        summaries.set(index, summary);
        const replacement = this.buildBlock(items[index], summary);
        replacements.set(index, replacement);
        estimatedLength += replacement.length - items[index].originalXml.length;
      });

      // Abort if too many failures
      if (attemptedCount > 0 && failedCount / attemptedCount > 0.5) {
        logInfo(`[ContextCompactor] High failure rate, aborting compaction`);
        return {
          summaries,
          replacements,
          estimatedLength,
          attemptedCount,
          failedCount,
          highFailureRate: true,
        };
      }
    }

    return {
      summaries,
      replacements,
      estimatedLength,
      attemptedCount,
      failedCount,
      highFailureRate: false,
    };
  }

  /**
   * Summarizes a single context item using the LLM.
   * @param item - The parsed context item to summarize
   * @returns The summarized content string
   */
  private async summarize(item: ParsedContextItem): Promise<string> {
    let content = item.content;
    if (content.length > this.MAX_ITEM_SIZE) {
      content = content.slice(0, this.MAX_ITEM_SIZE) + "\n[TRUNCATED]";
    }

    const prompt = this.PROMPT.replace("{title}", item.title)
      .replace("{path}", item.path)
      .replace("{content}", content);

    const model = await this.chatModelManager.getChatModelWithTemperature(this.TEMPERATURE);
    const response = await model.invoke([new HumanMessage(prompt)]);

    return typeof response.content === "string" ? response.content.trim() : "";
  }

  /**
   * Reduce phase: rebuild content with summaries.
   */
  private rebuild(
    original: string,
    items: ParsedContextItem[],
    replacements: Map<number, string>
  ): string {
    let result = original;

    // Process from end to preserve indices
    Array.from(replacements.keys())
      .sort((a, b) => b - a)
      .forEach((index) => {
        const item = items[index];
        const newBlock = replacements.get(index)!;
        result = result.slice(0, item.startIndex) + newBlock + result.slice(item.endIndex);
      });

    return result;
  }

  /** Block types that use <url> instead of <path> */
  private readonly URL_BASED_TYPES = [
    "url_content",
    "web_tab_context",
    "active_web_tab",
    "youtube_video_context",
  ];

  /**
   * Builds an XML block from a parsed item with its summary content.
   * @param item - The original parsed context item
   * @param summary - The summarized content to include
   * @returns The rebuilt XML block string with summary
   */
  private buildBlock(item: ParsedContextItem, summary: string): string {
    const parts = [`<${item.type}>`];

    if (item.title) parts.push(`<title>${item.title}</title>`);
    if (item.path) {
      const tag = this.URL_BASED_TYPES.includes(item.type) ? "url" : "path";
      parts.push(`<${tag}>${item.path}</${tag}>`);
    }
    if (item.metadata.ctime) parts.push(`<ctime>${item.metadata.ctime}</ctime>`);
    if (item.metadata.mtime) parts.push(`<mtime>${item.metadata.mtime}</mtime>`);
    parts.push(`<content>[SUMMARIZED]\n${summary}</content>`);
    parts.push(`</${item.type}>`);

    return parts.join("\n");
  }
}

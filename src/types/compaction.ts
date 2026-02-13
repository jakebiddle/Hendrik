/**
 * Structured reason for no-op compaction outcomes.
 */
export type CompactionNoOpReason =
  | "no_items"
  | "no_candidates"
  | "high_failure_rate"
  | "no_reduction";

/**
 * Result of context compaction operation
 */
export interface CompactionResult {
  /** Compacted content string (XML-formatted) */
  content: string;
  /** Whether compaction was performed */
  wasCompacted: boolean;
  /** Original character count */
  originalCharCount: number;
  /** Final character count after compaction */
  compactedCharCount: number;
  /** Number of context items processed */
  itemsProcessed: number;
  /** Number of items that were summarized */
  itemsSummarized: number;
  /** Requested target size for compacted content (chars) */
  targetCharCount?: number;
  /** Whether compaction reached the requested target size */
  targetMet?: boolean;
  /** Structured reason when compaction performed no changes */
  noOpReason?: CompactionNoOpReason;
}

/**
 * Parsed context item from XML content
 */
export interface ParsedContextItem {
  /** XML tag name (note_context, active_note, url_content, etc.) */
  type: string;
  /** Full path or identifier */
  path: string;
  /** Title/name for display */
  title: string;
  /** Raw content string */
  content: string;
  /** Additional metadata (mtime, ctime, etc.) */
  metadata: Record<string, string>;
  /** Original full XML block */
  originalXml: string;
  /** Start index in the original content */
  startIndex: number;
  /** End index in the original content */
  endIndex: number;
}

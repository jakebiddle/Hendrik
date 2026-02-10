import ChatModelManager from "@/LLMProviders/chatModelManager";
import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { parseReasoningBlock } from "@/LLMProviders/chainRunner/utils/AgentReasoningState";
import { HumanMessage } from "@langchain/core/messages";
/**
 * Utility functions for safely processing chat history from LangChain memory
 */

export interface ProcessedMessage {
  role: "user" | "assistant";
  content: any; // string or MessageContent[]
}

/**
 * Remove serialized agent reasoning metadata from assistant string history entries.
 *
 * @param content - Message content from history.
 * @returns Sanitized content with reasoning marker removed when present.
 */
function sanitizeAssistantHistoryContent(content: any): any {
  if (typeof content !== "string") {
    return content;
  }

  const parsedReasoning = parseReasoningBlock(content);
  if (!parsedReasoning?.hasReasoning) {
    return content;
  }

  return parsedReasoning.contentAfter;
}

/**
 * Safely process raw history from LangChain memory, handling both BaseMessage
 * objects and legacy formats while preserving multimodal content
 *
 * @param rawHistory Array of messages from memory.loadMemoryVariables()
 * @returns Array of processed messages safe for LLM consumption
 */
export function processRawChatHistory(rawHistory: any[]): ProcessedMessage[] {
  const messages: ProcessedMessage[] = [];

  for (const message of rawHistory) {
    if (!message) continue;

    // Check if this is a BaseMessage with _getType method
    if (typeof message._getType === "function") {
      const messageType = message._getType();

      // Only process human and AI messages
      if (messageType === "human") {
        messages.push({ role: "user", content: message.content });
      } else if (messageType === "ai") {
        messages.push({
          role: "assistant",
          content: sanitizeAssistantHistoryContent(message.content),
        });
      }
      // Skip system messages and unknown types
    } else if (message.content !== undefined) {
      // Fallback for other message formats - try to infer role
      const role = inferMessageRole(message);
      if (role) {
        messages.push({
          role,
          content:
            role === "assistant"
              ? sanitizeAssistantHistoryContent(message.content)
              : message.content,
        });
      }
    }
  }

  return messages;
}

/**
 * Try to infer the role from various message format properties
 * @returns 'user' | 'assistant' | null
 */
function inferMessageRole(message: any): "user" | "assistant" | null {
  // Check various properties that might indicate the role
  if (message.role === "human" || message.role === "user" || message.sender === "user") {
    return "user";
  } else if (message.role === "ai" || message.role === "assistant" || message.sender === "AI") {
    return "assistant";
  }

  // Can't determine role
  return null;
}

/**
 * Add processed chat history to messages array for LLM consumption
 * This is a convenience function that combines processing and adding
 *
 * @param rawHistory Raw history from memory
 * @param messages Target messages array to add to
 */
export function addChatHistoryToMessages(
  rawHistory: any[],
  messages: Array<{ role: string; content: any }>
): void {
  const processedHistory = processRawChatHistory(rawHistory);
  for (const msg of processedHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }
}

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

/** Marker used to detect compacted summaries in history. */
const COMPACTION_MARKER = "<summary>";

/**
 * Result of chat history compaction.
 */
interface ChatHistoryCompactionResult {
  wasCompacted: boolean;
  summaryText: string | null;
  processedHistory: ProcessedMessage[];
}

/**
 * Extract text content from potentially multimodal message content.
 * Replaces non-text content (images) with placeholder.
 */
function extractTextContent(content: any): string {
  if (typeof content === "string") {
    return content;
  } else if (Array.isArray(content)) {
    // Extract text from multimodal content, skip image_url payloads
    const textParts = content
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.text || "")
      .join(" ");
    return textParts || "[Image content]";
  }
  return String(content || "");
}

/**
 * Estimate token usage for chat history using a 4 chars/token heuristic.
 */
function estimateHistoryTokens(processedHistory: ProcessedMessage[]): number {
  const totalChars = processedHistory
    .map((msg) => extractTextContent(msg.content))
    .join("\n").length;
  return Math.ceil(totalChars / 4);
}

/**
 * Build a plain-text transcript for summarization.
 */
function buildTranscript(processedHistory: ProcessedMessage[]): string {
  return processedHistory
    .map((msg) => {
      const label = msg.role === "user" ? "User" : "Assistant";
      return `${label}: ${extractTextContent(msg.content)}`.trim();
    })
    .join("\n\n");
}

/**
 * Normalize model output into a <summary> block for compaction persistence.
 */
function normalizeSummaryBlock(rawSummary: string): string {
  const trimmed = rawSummary.trim();
  if (!trimmed) return "";
  if (trimmed.includes(COMPACTION_MARKER)) return trimmed;
  return `<summary>\n${trimmed}\n</summary>`;
}

/**
 * Detect whether the chat history already contains a compaction summary.
 */
function hasCompactionSummary(processedHistory: ProcessedMessage[]): boolean {
  return processedHistory.some((msg) => {
    if (msg.role !== "assistant") return false;
    const content = typeof msg.content === "string" ? msg.content : extractTextContent(msg.content);
    return content.includes(COMPACTION_MARKER);
  });
}

/**
 * Summarize chat history using the current chat model.
 */
async function summarizeChatHistory(
  processedHistory: ProcessedMessage[],
  summaryTokenTarget: number
): Promise<string> {
  const transcript = buildTranscript(processedHistory);
  const prompt = `You have written a partial transcript for an ongoing task. Summarize the transcript so work can continue later when raw history is unavailable.

Include:
- Task overview and goals
- Current state and key decisions
- Important discoveries, constraints, and errors resolved
- Next steps
- Preferences or context to preserve

Target length: about ${summaryTokenTarget} tokens.
Wrap the summary in <summary></summary> tags.

Transcript:\n${transcript}`;

  const modelManager = ChatModelManager.getInstance();
  const model = await modelManager.getChatModelWithTemperature(0.1);
  const response = await model.invoke([new HumanMessage(prompt)]);

  return typeof response.content === "string" ? response.content.trim() : "";
}

/**
 * Compact chat history when it exceeds the configured threshold.
 */
async function compactChatHistoryIfNeeded(
  processedHistory: ProcessedMessage[]
): Promise<ChatHistoryCompactionResult> {
  const settings = getSettings();
  if (!settings.enableAutoCompaction || settings.autoCompactThreshold <= 0) {
    return { wasCompacted: false, summaryText: null, processedHistory };
  }

  if (processedHistory.length === 0) {
    return { wasCompacted: false, summaryText: null, processedHistory };
  }

  if (hasCompactionSummary(processedHistory)) {
    return { wasCompacted: false, summaryText: null, processedHistory };
  }

  const estimatedTokens = estimateHistoryTokens(processedHistory);
  if (estimatedTokens < settings.autoCompactThreshold) {
    return { wasCompacted: false, summaryText: null, processedHistory };
  }

  logInfo(
    `[ChatHistoryCompaction] Triggered at ~${estimatedTokens} tokens (threshold ${settings.autoCompactThreshold}).`
  );

  const rawSummary = await summarizeChatHistory(
    processedHistory,
    settings.autoCompactSummaryTokens
  );
  const summaryText = normalizeSummaryBlock(rawSummary);
  if (!summaryText) {
    logWarn("[ChatHistoryCompaction] Empty summary result, skipping compaction.");
    return { wasCompacted: false, summaryText: null, processedHistory };
  }

  return {
    wasCompacted: true,
    summaryText,
    processedHistory: [{ role: "assistant", content: summaryText }],
  };
}

/**
 * Convert processed messages to text-only format for question condensing
 * This extracts just the text content from potentially multimodal messages
 *
 * @param processedMessages Messages processed by processRawChatHistory
 * @returns Array of text-only chat history entries
 */
export function processedMessagesToTextOnly(
  processedMessages: ProcessedMessage[]
): ChatHistoryEntry[] {
  return processedMessages.map((msg) => ({
    role: msg.role,
    content: extractTextContent(msg.content),
  }));
}

/**
 * Tool output structure for size estimation
 */
export interface ToolOutput {
  tool: string;
  output: string | object;
}

/**
 * Estimates the size of formatted tool outputs without actually formatting them.
 * Used to include tool output size in compaction threshold calculations.
 *
 * Tool outputs are formatted as:
 * ```
 * # Additional context:
 *
 * <toolName>
 * {content}
 * </toolName>
 * ```
 *
 * @param toolOutputs - Array of tool outputs with tool name and output content
 * @returns Estimated character count of formatted tool outputs
 */
export function estimateToolOutputSize(toolOutputs: ToolOutput[]): number {
  if (toolOutputs.length === 0) return 0;

  // Estimate: "# Additional context:\n\n" prefix
  let size = "# Additional context:\n\n".length;

  for (let i = 0; i < toolOutputs.length; i++) {
    const output = toolOutputs[i];
    const content =
      typeof output.output === "string" ? output.output : JSON.stringify(output.output);
    // Format: <tool>\n{content}\n</tool>
    size += `<${output.tool}>\n`.length + content.length + `\n</${output.tool}>`.length;
    // Join separator: \n\n between outputs
    if (i < toolOutputs.length - 1) {
      size += 2;
    }
  }

  return size;
}

/**
 * Result of extracting conversation turns from processed history.
 */
export interface ExtractedTurns {
  /** Complete user-assistant turn pairs */
  turns: Array<{ user: string; assistant: string }>;
  /** Trailing user message without assistant response (e.g., after aborted generation) */
  trailingUserMessage: string | null;
}

/**
 * Extract conversation turns from processed chat history.
 * Handles both complete turn pairs and trailing unpaired user messages.
 * Scans sequentially for user→assistant pairs to handle histories that may
 * start with an assistant message (e.g., when BufferWindowMemory slices mid-conversation).
 *
 * @param processedHistory - Processed chat history messages
 * @returns Object with turns array and optional trailing user message
 */
export function extractConversationTurns(processedHistory: ProcessedMessage[]): ExtractedTurns {
  const turns: Array<{ user: string; assistant: string }> = [];
  let trailingUserMessage: string | null = null;

  // Scan sequentially for user→assistant pairs
  let i = 0;
  while (i < processedHistory.length) {
    const msg = processedHistory[i];

    if (msg?.role === "user") {
      // Found a user message, look for the following assistant message
      const nextMsg = processedHistory[i + 1];
      if (nextMsg?.role === "assistant") {
        turns.push({
          user: extractTextContent(msg.content),
          assistant: extractTextContent(nextMsg.content),
        });
        i += 2; // Skip both messages
      } else {
        // User message without following assistant (trailing or orphaned)
        // If this is the last message, it's a trailing user message
        if (i === processedHistory.length - 1) {
          trailingUserMessage = extractTextContent(msg.content);
        }
        i += 1;
      }
    } else {
      // Skip assistant messages that aren't paired with a preceding user message
      // (e.g., at the start of a window slice)
      i += 1;
    }
  }

  return { turns, trailingUserMessage };
}

/**
 * Load chat history from memory and add to messages array.
 * This is the single entry point for all chain runners to use.
 *
 * NOTE: Chat history compaction was intentionally removed for simplicity.
 * A previous implementation would summarize older conversation turns when
 * total context exceeded a threshold. This was removed because:
 * 1. It added complexity (LLM calls for summarization)
 * 2. Context compaction in ContextManager already handles large context
 * 3. BufferWindowMemory already limits conversation history length
 *
 * If chat history compaction is needed in the future, consider:
 * - Extracting conversation turns with extractConversationTurns()
 * - Summarizing older turns while keeping recent ones intact
 * - Using the same autoCompactThreshold setting for consistency
 *
 * @param memory - LangChain memory instance
 * @param messages - Target messages array (system message should already be added)
 * @returns The processed history that was added
 */
export async function loadAndAddChatHistory(
  memory: any,
  messages: Array<{ role: string; content: any }>
): Promise<ProcessedMessage[]> {
  const memoryVariables = await memory.loadMemoryVariables({});
  const rawHistory = memoryVariables.history || [];

  if (!rawHistory.length) {
    return [];
  }

  let processedHistory = processRawChatHistory(rawHistory);

  const compactionResult = await compactChatHistoryIfNeeded(processedHistory);
  if (compactionResult.wasCompacted && compactionResult.summaryText) {
    try {
      await memory.clear();
      await memory.saveContext(
        { input: "Conversation summary" },
        { output: compactionResult.summaryText }
      );
    } catch (error) {
      logWarn("[ChatHistoryCompaction] Failed to persist compacted history:", error);
    }
    processedHistory = compactionResult.processedHistory;
  }

  // Add history messages directly
  for (const msg of processedHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  return processedHistory;
}

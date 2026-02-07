import { getSettings } from "@/settings/model";
import {
  getEffectiveUserPrompt,
  getSystemPrompt,
  getSystemPromptWithMemory,
} from "@/system-prompts/systemPromptBuilder";
import { ChainType } from "@/chainFactory";
import { getCurrentProject, type ProjectConfig } from "@/aiParams";
import { logInfo, logWarn } from "@/logger";
import { ChatMessage, MessageContext, WebTabContext } from "@/types/message";
import { processPrompt, type ProcessedPromptResult } from "@/commands/customCommandUtils";
import { FileParserManager } from "@/tools/FileParserManager";
import ChainManager from "@/LLMProviders/chainManager";
import ProjectManager from "@/LLMProviders/projectManager";
import { updateChatMemory } from "@/chatUtils";
import HendrikPlugin from "@/main";
import { ContextManager } from "./ContextManager";
import { MessageRepository } from "./MessageRepository";
import { ChatPersistenceManager } from "./ChatPersistenceManager";
import { ACTIVE_WEB_TAB_MARKER, USER_SENDER } from "@/constants";
import { TFile, Vault } from "obsidian";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import {
  normalizeUrlForMatching,
  normalizeUrlString,
  sanitizeWebTabContexts,
} from "@/utils/urlNormalization";

const APPROX_CHARS_PER_TOKEN = 4;
const MIN_RESERVED_COMPLETION_TOKENS = 512;
const MIN_RESERVED_HEADROOM_TOKENS = 1024;

/**
 * ChatManager - Central business logic coordinator
 *
 * This is the main business logic hub that coordinates all chat operations.
 * It orchestrates MessageRepository, ContextManager, and LLM chain operations
 * while providing a clean API for UI components.
 */
export class ChatManager {
  private contextManager: ContextManager;
  private projectMessageRepos: Map<string, MessageRepository> = new Map();
  private defaultProjectKey = "defaultProjectKey";
  private lastKnownProjectId: string | null = null;
  private persistenceManager: ChatPersistenceManager;
  private onMessageCreatedCallback?: (messageId: string) => void;

  constructor(
    private messageRepo: MessageRepository,
    private chainManager: ChainManager,
    private fileParserManager: FileParserManager,
    private plugin: HendrikPlugin
  ) {
    this.contextManager = ContextManager.getInstance();
    // Initialize default project repository
    this.projectMessageRepos.set(this.defaultProjectKey, messageRepo);
    // Initialize persistence manager with default repository
    this.persistenceManager = new ChatPersistenceManager(plugin.app, messageRepo, chainManager);
  }

  /**
   * Get the current project's message repository
   * Automatically detects project changes and handles repository switching
   */
  private getCurrentMessageRepo(): MessageRepository {
    const currentProjectId = this.plugin.projectManager.getCurrentProjectId();
    const projectKey = currentProjectId ?? this.defaultProjectKey;

    // Detect if project has changed
    if (this.lastKnownProjectId !== currentProjectId) {
      logInfo(
        `[ChatManager] Project changed from ${this.lastKnownProjectId} to ${currentProjectId}`
      );
      this.lastKnownProjectId = currentProjectId;
    }

    // Create a new repository for this project if it doesn't exist
    if (!this.projectMessageRepos.has(projectKey)) {
      logInfo(`[ChatManager] Creating new message repository for project: ${projectKey}`);
      const newRepo = new MessageRepository();
      this.projectMessageRepos.set(projectKey, newRepo);
    }

    const currentRepo = this.projectMessageRepos.get(projectKey)!;

    // Update persistence manager to use current repository
    this.persistenceManager = new ChatPersistenceManager(
      this.plugin.app,
      currentRepo,
      this.chainManager
    );

    return currentRepo;
  }

  /**
   * Set callback for when a message is created (before context processing)
   */
  setOnMessageCreatedCallback(callback: (messageId: string) => void): void {
    this.onMessageCreatedCallback = callback;
  }

  /**
   * Process system prompt template variables using the same engine as custom commands.
   * Supports: {activeNote}, {[[Note Title]]}, {#tag1, #tag2}, {folder/path}
   *
   * Note: JSON-like content (e.g., {"foo": "bar"}) is handled by processPrompt internally,
   * which checks if the variable name starts with '"' and skips processing.
   * Empty braces `{}` are treated as literals in system prompts.
   *
   * @param prompt - Raw system prompt text
   * @param vault - Vault used to resolve note/tag templates
   * @param activeNote - Active note used for {activeNote} resolution
   * @returns Processed prompt and included files discovered during processing
   */
  private async processSystemPromptTemplates(
    prompt: string,
    vault: Vault,
    activeNote: TFile | null
  ): Promise<ProcessedPromptResult> {
    // Quick skip if no curly braces present
    if (!prompt.includes("{") || !prompt.includes("}")) {
      return { processedPrompt: prompt, includedFiles: [] };
    }

    // Respect enableCustomPromptTemplating setting
    const settings = getSettings();
    if (!settings.enableCustomPromptTemplating) {
      return { processedPrompt: prompt, includedFiles: [] };
    }

    try {
      // Reason: selectedText is empty because system prompts don't use selection context
      // skipEmptyBraces is true to treat {} as literal in system prompts
      const result = await processPrompt(prompt, "", vault, activeNote, true);

      // Only trim when the template engine actually ran to avoid mutating user-provided whitespace
      return {
        processedPrompt: result.processedPrompt.trimEnd(),
        includedFiles: result.includedFiles,
      };
    } catch (error) {
      logWarn("[ChatManager] Error processing system prompt templates:", error);
      // Return original prompt on error to avoid breaking the chat
      return { processedPrompt: prompt, includedFiles: [] };
    }
  }

  /**
   * Inject a processed user custom prompt into the system prompt returned by `getSystemPrompt()`.
   *
   * - If `<user_custom_instructions>` block exists, replaces its inner content.
   * - If builtin system prompt is disabled (i.e., system prompt equals `userCustomPrompt`),
   *   replaces the entire system prompt with the processed user prompt.
   * - Otherwise, returns the original system prompt unchanged.
   *
   * This ensures DEFAULT_SYSTEM_PROMPT is never template-processed.
   */
  private injectProcessedUserCustomPromptIntoSystemPrompt(params: {
    systemPromptWithoutMemory: string;
    userCustomPrompt: string;
    processedUserCustomPrompt: string;
  }): string {
    const { systemPromptWithoutMemory, userCustomPrompt, processedUserCustomPrompt } = params;

    // Note: trimEnd() is now done in processSystemPromptTemplates only when templates are processed
    const userInstructionsBlockRegex =
      /<user_custom_instructions>\n[\s\S]*?\n<\/user_custom_instructions>/;

    if (userInstructionsBlockRegex.test(systemPromptWithoutMemory)) {
      // Use function replacement to avoid $ being interpreted as special replacement patterns
      return systemPromptWithoutMemory.replace(
        userInstructionsBlockRegex,
        () =>
          `<user_custom_instructions>\n${processedUserCustomPrompt}\n</user_custom_instructions>`
      );
    }

    // disableBuiltin === true -> getSystemPrompt() returns userCustomPrompt as-is
    if (systemPromptWithoutMemory === userCustomPrompt) {
      return processedUserCustomPrompt;
    }

    logInfo(
      "[ChatManager] Could not locate <user_custom_instructions> block for injection; returning original system prompt."
    );
    return systemPromptWithoutMemory;
  }

  /**
   * Replace the trailing `getSystemPrompt()` portion inside a `getSystemPromptWithMemory()` result.
   * This preserves the memory prompt prefix exactly and ensures memory content is not template-processed.
   */
  private replaceSystemPromptWithoutMemoryInBasePrompt(params: {
    basePromptWithMemory: string;
    systemPromptWithoutMemory: string;
    processedSystemPromptWithoutMemory: string;
  }): string {
    const { basePromptWithMemory, systemPromptWithoutMemory, processedSystemPromptWithoutMemory } =
      params;

    if (!basePromptWithMemory.endsWith(systemPromptWithoutMemory)) {
      logInfo(
        "[ChatManager] basePromptWithMemory does not end with systemPromptWithoutMemory; returning original base prompt."
      );
      return basePromptWithMemory;
    }

    const prefix = basePromptWithMemory.slice(
      0,
      basePromptWithMemory.length - systemPromptWithoutMemory.length
    );
    return `${prefix}${processedSystemPromptWithoutMemory}`;
  }

  /**
   * Normalize a numeric value into a positive integer when possible.
   * @param value - Unknown input value.
   * @returns Positive integer, or null when the value is missing/invalid.
   */
  private normalizePositiveInteger(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : null;
  }

  /**
   * Estimate token usage from raw text using a char/token heuristic.
   * @param text - Prompt text to estimate.
   * @returns Estimated token count.
   */
  private estimateTokenCount(text: string): number {
    if (!text) {
      return 0;
    }
    return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
  }

  /**
   * Resolve model-aware context budgeting for project prompts.
   * @param project - Active project configuration.
   * @returns Budget tuple for max context and reserved headroom.
   */
  private resolveProjectPromptBudget(project: ProjectConfig): {
    maxContextTokens: number;
    reservedCompletionTokens: number;
    reservedHeadroomTokens: number;
  } {
    const settings = getSettings();
    const activeModels = Array.isArray(settings.activeModels) ? settings.activeModels : [];
    const configuredModel = activeModels.find(
      (model) => `${model.name}|${model.provider}` === project.projectModelKey
    );

    const maxContextTokens =
      this.normalizePositiveInteger(configuredModel?.maxContextTokens) ??
      this.normalizePositiveInteger(settings.defaultMaxContextTokens) ??
      128000;

    const requestedCompletionTokens =
      this.normalizePositiveInteger(project.modelConfigs?.maxTokens) ??
      this.normalizePositiveInteger(configuredModel?.maxTokens) ??
      this.normalizePositiveInteger(settings.maxTokens) ??
      1000;

    const completionCapByWindow = Math.max(
      MIN_RESERVED_COMPLETION_TOKENS,
      Math.floor(maxContextTokens * 0.35)
    );
    const reservedCompletionTokens = Math.min(requestedCompletionTokens, completionCapByWindow);
    const reservedHeadroomTokens = Math.max(
      MIN_RESERVED_HEADROOM_TOKENS,
      Math.floor(maxContextTokens * 0.2)
    );

    return {
      maxContextTokens,
      reservedCompletionTokens,
      reservedHeadroomTokens,
    };
  }

  /**
   * Truncate project context content to a target character budget.
   * Keeps both head and tail segments for better information retention.
   * @param context - Raw project context text.
   * @param maxChars - Maximum allowed characters.
   * @returns Truncated context.
   */
  private truncateProjectContextToBudget(context: string, maxChars: number): string {
    if (maxChars <= 0) {
      return "";
    }
    if (context.length <= maxChars) {
      return context;
    }

    const marker = "\n\n[...project context truncated...]\n\n";
    const remaining = maxChars - marker.length;
    if (remaining <= 0) {
      return context.slice(0, maxChars);
    }

    const headLength = Math.ceil(remaining * 0.75);
    const tailLength = Math.max(0, remaining - headLength);
    const head = context.slice(0, headLength);
    const tail = tailLength > 0 ? context.slice(context.length - tailLength) : "";
    return `${head}${marker}${tail}`;
  }

  /**
   * Fit project context into the model context window by applying a budget-aware trim.
   * @param project - Active project configuration.
   * @param projectContext - Raw project context returned from ProjectManager.
   * @param staticPromptWithoutProjectContext - Prompt content excluding the project context block.
   * @returns Budgeted project context text, or empty string when no budget remains.
   */
  private fitProjectContextToModelBudget(
    project: ProjectConfig,
    projectContext: string,
    staticPromptWithoutProjectContext: string
  ): string {
    const normalizedContext = projectContext.trim();
    if (!normalizedContext) {
      return "";
    }

    const { maxContextTokens, reservedCompletionTokens, reservedHeadroomTokens } =
      this.resolveProjectPromptBudget(project);

    const projectWrapperTokens = this.estimateTokenCount(
      "\n\n<project_context>\n\n</project_context>"
    );
    const staticPromptTokens = this.estimateTokenCount(staticPromptWithoutProjectContext);
    const availableContextTokens =
      maxContextTokens -
      staticPromptTokens -
      projectWrapperTokens -
      reservedCompletionTokens -
      reservedHeadroomTokens;

    if (availableContextTokens <= 0) {
      logWarn(
        `[ChatManager] Omitted project context for "${project.name}" due to context budget exhaustion.`
      );
      return "";
    }

    const contextTokens = this.estimateTokenCount(normalizedContext);
    if (contextTokens <= availableContextTokens) {
      return normalizedContext;
    }

    const maxChars = availableContextTokens * APPROX_CHARS_PER_TOKEN;
    const truncated = this.truncateProjectContextToBudget(normalizedContext, maxChars);
    logWarn(
      `[ChatManager] Truncated project context for "${project.name}" from ~${contextTokens} to ~${availableContextTokens} tokens.`
    );

    if (!truncated.trim()) {
      return "";
    }

    return `${truncated}\n\n[project_context truncated to fit the model context window.]`;
  }

  /**
   * Build system prompt for the current message, including project context if in project mode.
   * Also expands template variables (e.g., {activeNote}, {[[Note Title]]}, {#tag}) using the
   * same behavior as custom commands.
   *
   * IMPORTANT: Only the user-defined custom prompt portion (from `getEffectiveSystemPromptContent()`)
   * is processed for template variables. DEFAULT_SYSTEM_PROMPT and memory prompts are never processed.
   *
   * This method preserves the behavior of `getSystemPromptWithMemory()` by:
   * 1) Calling it to obtain the canonical base prompt (memory + system prompt)
   * 2) Replacing only the user custom prompt content within the trailing `getSystemPrompt()` portion
   *
   * @param chainType - The chain type being used
   * @param vault - Vault used to resolve note/tag templates
   * @param activeNote - Active note used for {activeNote} resolution
   * @returns Processed system prompt and included files (for deduplication)
   */
  private async getSystemPromptForMessage(
    chainType: ChainType,
    vault: Vault,
    activeNote: TFile | null
  ): Promise<ProcessedPromptResult> {
    // Use getEffectiveUserPrompt to ensure consistency with getSystemPrompt (includes legacy fallback)
    const userCustomPrompt = getEffectiveUserPrompt();
    const allIncludedFiles: TFile[] = [];

    // Preserve original behavior (memory + system prompt) via settings/model helpers
    const basePromptWithMemory = await getSystemPromptWithMemory(
      this.chainManager.userMemoryManager
    );
    const systemPromptWithoutMemory = getSystemPrompt();

    let processedBasePromptWithMemory = basePromptWithMemory;

    // Process templates only on user-defined custom prompt content
    if (userCustomPrompt) {
      const userPromptResult = await this.processSystemPromptTemplates(
        userCustomPrompt,
        vault,
        activeNote
      );

      const processedSystemPromptWithoutMemory =
        this.injectProcessedUserCustomPromptIntoSystemPrompt({
          systemPromptWithoutMemory,
          userCustomPrompt,
          processedUserCustomPrompt: userPromptResult.processedPrompt,
        });

      const nextProcessedBasePromptWithMemory = this.replaceSystemPromptWithoutMemoryInBasePrompt({
        basePromptWithMemory,
        systemPromptWithoutMemory,
        processedSystemPromptWithoutMemory,
      });

      // Only add includedFiles if the processed prompt was actually injected
      // This prevents context deduplication from skipping files that weren't actually included
      if (nextProcessedBasePromptWithMemory !== basePromptWithMemory) {
        allIncludedFiles.push(...userPromptResult.includedFiles);
      }

      processedBasePromptWithMemory = nextProcessedBasePromptWithMemory;
    }

    // Special case: Add project context for project chain
    if (chainType === ChainType.PROJECT_CHAIN) {
      const project = getCurrentProject();
      if (project) {
        const context = await ProjectManager.instance.getProjectContext(project.id);

        // Process project system prompt templates too
        const projectPromptResult = await this.processSystemPromptTemplates(
          project.systemPrompt,
          vault,
          activeNote
        );
        allIncludedFiles.push(...projectPromptResult.includedFiles);

        const promptWithoutProjectContext = `${processedBasePromptWithMemory}\n\n<project_system_prompt>\n${projectPromptResult.processedPrompt}\n</project_system_prompt>`;
        let result = promptWithoutProjectContext;

        // Only add project_context block if context exists
        if (context) {
          const boundedContext = this.fitProjectContextToModelBudget(
            project,
            context,
            promptWithoutProjectContext
          );
          if (boundedContext) {
            result += `\n\n<project_context>\n${boundedContext}\n</project_context>`;
          }
        }

        return {
          processedPrompt: result,
          includedFiles: allIncludedFiles,
        };
      }
    }

    return {
      processedPrompt: processedBasePromptWithMemory,
      includedFiles: allIncludedFiles,
    };
  }

  /**
   * Build webTabs array with Active Web Tab snapshot injected.
   *
   * This implements snapshot semantics:
   * - Active Web Tab URL is resolved at message creation time
   * - The URL is stored in message.context.webTabs with isActive: true
   * - Edit/reprocess will use the stored URL, not the current active tab
   *
   * @param existingWebTabs - Existing webTabs from context
   * @param shouldIncludeActiveWebTab - Pre-computed flag for whether to include active web tab
   * @returns Updated webTabs array with active tab snapshot
   */
  private buildWebTabsWithActiveSnapshot(
    existingWebTabs: WebTabContext[],
    shouldIncludeActiveWebTab: boolean
  ): WebTabContext[] {
    // Always sanitize existing webTabs (normalize URLs, dedupe, ensure single isActive)
    const sanitizedTabs = sanitizeWebTabContexts(existingWebTabs);

    if (!shouldIncludeActiveWebTab) {
      return sanitizedTabs;
    }

    try {
      // Get active web tab from WebViewerService
      // Use activeWebTabForMentions to match UI behavior:
      // - Preserved only when switching directly to chat panel
      // - Cleared when switching to other views (e.g., note tab)
      const service = getWebViewerService(this.plugin.app);
      const state = service.getActiveWebTabState();
      const activeTab = state.activeWebTabForMentions;

      const activeUrl = normalizeUrlForMatching(activeTab?.url);
      if (!activeUrl) {
        // No active web tab available, return sanitized tabs unchanged
        return sanitizedTabs;
      }

      // Clear any existing isActive flags to ensure only one active tab
      const clearedTabs: WebTabContext[] = sanitizedTabs.map((tab) => {
        if (tab.isActive) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { isActive: _unused, ...rest } = tab;
          return rest;
        }
        return tab;
      });

      // Check if active URL already exists in the list (using normalized matching)
      const existingIndex = clearedTabs.findIndex(
        (tab) => normalizeUrlForMatching(tab.url) === activeUrl
      );

      if (existingIndex >= 0) {
        // Merge metadata and mark as active
        // Prefer activeTab.url to preserve hash fragments for SPA routing
        // Use normalizeUrlString to trim whitespace while keeping hash/query intact
        const existing = clearedTabs[existingIndex];
        clearedTabs[existingIndex] = {
          ...existing,
          url: normalizeUrlString(activeTab?.url) ?? existing.url,
          title: activeTab?.title ?? existing.title,
          faviconUrl: activeTab?.faviconUrl ?? existing.faviconUrl,
          isActive: true,
        };
        return clearedTabs;
      }

      // Add new active tab entry
      // Store the raw URL to preserve hash fragments and query params for SPA routing
      // Use normalizeUrlString to trim whitespace while keeping hash/query intact
      // (activeUrl is only used for comparison/deduplication above)
      return [
        ...clearedTabs,
        {
          url: normalizeUrlString(activeTab?.url) ?? activeUrl,
          title: activeTab?.title,
          faviconUrl: activeTab?.faviconUrl,
          isActive: true,
        },
      ];
    } catch (error) {
      // Web Viewer not available (e.g., mobile platform) - don't fail the message
      logWarn("[ChatManager] Failed to resolve active web tab:", error);
      return sanitizedTabs;
    }
  }

  /**
   * Send a new message with context processing
   */
  async sendMessage(
    displayText: string,
    context: MessageContext,
    chainType: ChainType,
    includeActiveNote: boolean = false,
    includeActiveWebTab: boolean = false,
    content?: any[],
    updateLoadingMessage?: (message: string) => void
  ): Promise<string> {
    try {
      logInfo(`[ChatManager] Sending message: "${displayText}"`);

      // Get active note
      const activeNote = this.plugin.app.workspace.getActiveFile();

      // If includeActiveNote is true and there's an active note, add it to context
      const updatedContext = { ...context };
      if (includeActiveNote && activeNote) {
        const existingNotes = context.notes || [];
        // Only add activeNote if it's not already in the context
        const hasActiveNote = existingNotes.some((note) => note.path === activeNote.path);
        updatedContext.notes = hasActiveNote ? existingNotes : [...existingNotes, activeNote];
      }

      // Inject Active Web Tab snapshot if requested (快照语义)
      // This resolves the active web tab URL at message creation time
      // Compute shouldIncludeActiveWebTab: either explicitly requested or via marker in text
      // BUT: any selection takes priority and suppresses active tab to avoid redundant context
      const hasAnySelection = (updatedContext.selectedTextContexts || []).length > 0;
      const shouldIncludeActiveWebTab =
        !hasAnySelection && (includeActiveWebTab || displayText.includes(ACTIVE_WEB_TAB_MARKER));
      updatedContext.webTabs = this.buildWebTabsWithActiveSnapshot(
        updatedContext.webTabs || [],
        shouldIncludeActiveWebTab
      );

      // Create the message with initial content
      const currentRepo = this.getCurrentMessageRepo();
      const messageId = currentRepo.addMessage(
        displayText,
        displayText, // Will be updated with processed content
        USER_SENDER,
        updatedContext,
        content
      );

      // Notify that message was created (for immediate UI update)
      if (this.onMessageCreatedCallback) {
        this.onMessageCreatedCallback(messageId);
      }

      // Get the message for context processing
      const message = currentRepo.getMessage(messageId);
      if (!message) {
        throw new Error(`Failed to retrieve message ${messageId}`);
      }

      // Get system prompt for L1 layer (includes project context if in project mode)
      const { processedPrompt: systemPrompt, includedFiles: systemPromptIncludedFiles } =
        await this.getSystemPromptForMessage(chainType, this.plugin.app.vault, activeNote);

      // Process context to generate LLM content
      const { processedContent, contextEnvelope } = await this.contextManager.processMessageContext(
        message,
        this.fileParserManager,
        this.plugin.app.vault,
        chainType,
        includeActiveNote,
        activeNote,
        currentRepo, // Pass MessageRepository for L2 building
        systemPrompt,
        systemPromptIncludedFiles,
        updateLoadingMessage
      );

      // Update the processed content
      currentRepo.updateProcessedText(messageId, processedContent, contextEnvelope);

      logInfo(`[ChatManager] Successfully sent message ${messageId}`);
      return messageId;
    } catch (error) {
      logInfo(`[ChatManager] Error sending message:`, error);
      throw error;
    }
  }

  /**
   * Edit an existing message
   *
   * Design note: This method only updates the message text, not the context (notes/urls/webTabs/etc).
   * The original context is preserved because:
   * 1. Context represents the state at message creation time (which files/URLs were referenced)
   * 2. Allowing context modification would require complex UI for editing pills/references
   * 3. The reprocessMessageContext() call below re-fetches content using the ORIGINAL context,
   *    ensuring the LLM sees fresh content from the same sources
   */
  async editMessage(
    messageId: string,
    newText: string,
    chainType: ChainType,
    includeActiveNote: boolean = false
  ): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Editing message ${messageId}: "${newText}"`);

      // Edit the message text only - context remains unchanged (see design note above)
      const currentRepo = this.getCurrentMessageRepo();
      const editSuccess = currentRepo.editMessage(messageId, newText);
      if (!editSuccess) {
        return false;
      }

      // Reprocess context for the edited message
      const activeNote = this.plugin.app.workspace.getActiveFile();
      const { processedPrompt: systemPrompt, includedFiles: systemPromptIncludedFiles } =
        await this.getSystemPromptForMessage(chainType, this.plugin.app.vault, activeNote);
      await this.contextManager.reprocessMessageContext(
        messageId,
        currentRepo,
        this.fileParserManager,
        this.plugin.app.vault,
        chainType,
        includeActiveNote,
        activeNote,
        systemPrompt,
        systemPromptIncludedFiles
      );

      // Update chain memory with fresh LLM messages
      await this.updateChainMemory();

      logInfo(`[ChatManager] Successfully edited message ${messageId}`);
      return true;
    } catch (error) {
      logInfo(`[ChatManager] Error editing message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Regenerate an AI response
   */
  async regenerateMessage(
    messageId: string,
    onUpdateCurrentMessage: (message: string) => void,
    onAddMessage: (message: ChatMessage) => void,
    onTruncate?: () => void
  ): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Regenerating message ${messageId}`);

      // Find the message to regenerate
      const currentRepo = this.getCurrentMessageRepo();
      const message = currentRepo.getMessage(messageId);
      if (!message) {
        logInfo(`[ChatManager] Message not found: ${messageId}`);
        return false;
      }

      // Find the corresponding user message (should be the previous message)
      const displayMessages = currentRepo.getDisplayMessages();
      const messageIndex = displayMessages.findIndex((msg) => msg.id === messageId);

      if (messageIndex <= 0) {
        logInfo(`[ChatManager] Cannot regenerate first message or no user message found`);
        return false;
      }

      const userMessage = displayMessages[messageIndex - 1];
      if (userMessage.sender !== USER_SENDER) {
        logInfo(`[ChatManager] Previous message is not from user`);
        return false;
      }

      // Truncate messages after the user message
      currentRepo.truncateAfter(messageIndex - 1);

      // Notify that truncation happened
      if (onTruncate) {
        onTruncate();
      }

      // Update chain memory
      await this.updateChainMemory();

      // Get the LLM version of the user message for regeneration
      if (!userMessage.id) {
        logInfo(`[ChatManager] User message has no ID for regeneration`);
        return false;
      }

      const llmMessage = currentRepo.getLLMMessage(userMessage.id);
      if (!llmMessage) {
        logInfo(`[ChatManager] LLM message not found for regeneration`);
        return false;
      }

      // Run the chain to regenerate the response
      const abortController = new AbortController();
      await this.chainManager.runChain(
        llmMessage,
        abortController,
        onUpdateCurrentMessage,
        onAddMessage,
        { debug: getSettings().debug }
      );

      logInfo(`[ChatManager] Successfully regenerated message ${messageId}`);
      return true;
    } catch (error) {
      logInfo(`[ChatManager] Error regenerating message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Deleting message ${messageId}`);

      const currentRepo = this.getCurrentMessageRepo();
      const deleteSuccess = currentRepo.deleteMessage(messageId);
      if (!deleteSuccess) {
        return false;
      }

      // Update chain memory
      await this.updateChainMemory();

      logInfo(`[ChatManager] Successfully deleted message ${messageId}`);
      return true;
    } catch (error) {
      logInfo(`[ChatManager] Error deleting message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Add a message
   */
  addMessage(message: ChatMessage): string {
    const currentRepo = this.getCurrentMessageRepo();
    const messageId = currentRepo.addMessage(message);
    return messageId;
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    const currentRepo = this.getCurrentMessageRepo();
    currentRepo.clear();
    // Clear chain memory directly
    this.chainManager.memoryManager.clearChatMemory();
    logInfo(`[ChatManager] Cleared all messages`);
  }

  /**
   * Truncate messages after a specific message ID
   */
  async truncateAfterMessageId(messageId: string): Promise<void> {
    const currentRepo = this.getCurrentMessageRepo();
    currentRepo.truncateAfterMessageId(messageId);

    // Update chain memory with the truncated messages
    await this.updateChainMemory();

    logInfo(`[ChatManager] Truncated messages after ${messageId}`);
  }

  /**
   * Get display messages for UI
   */
  getDisplayMessages(): ChatMessage[] {
    const currentRepo = this.getCurrentMessageRepo();
    return currentRepo.getDisplayMessages();
  }

  /**
   * Get LLM messages for AI communication
   */
  getLLMMessages(): ChatMessage[] {
    const currentRepo = this.getCurrentMessageRepo();
    return currentRepo.getLLMMessages();
  }

  /**
   * Get a specific message by ID (display version)
   */
  getMessage(id: string): ChatMessage | undefined {
    const currentRepo = this.getCurrentMessageRepo();
    return currentRepo.getMessage(id);
  }

  /**
   * Get a specific message for LLM processing
   */
  getLLMMessage(id: string): ChatMessage | undefined {
    const currentRepo = this.getCurrentMessageRepo();
    return currentRepo.getLLMMessage(id);
  }

  /**
   * Update chain memory with current LLM messages
   */
  private async updateChainMemory(): Promise<void> {
    try {
      const currentRepo = this.getCurrentMessageRepo();
      const llmMessages = currentRepo.getLLMMessages();
      await updateChatMemory(llmMessages, this.chainManager.memoryManager);
      logInfo(`[ChatManager] Updated chain memory with ${llmMessages.length} messages`);
    } catch (error) {
      logInfo(`[ChatManager] Error updating chain memory:`, error);
    }
  }

  /**
   * Load messages from saved chat
   */
  async loadMessages(messages: ChatMessage[]): Promise<void> {
    const currentRepo = this.getCurrentMessageRepo();
    currentRepo.clear();
    messages.forEach((msg) => {
      currentRepo.addMessage(msg);
    });

    // Update chain memory with loaded messages
    await this.updateChainMemory();

    logInfo(`[ChatManager] Loaded ${messages.length} messages`);
  }

  /**
   * Save current chat history
   */
  async saveChat(modelKey: string): Promise<void> {
    await this.persistenceManager.saveChat(modelKey);
  }

  /**
   * Get debug information
   */
  getDebugInfo() {
    const currentRepo = this.getCurrentMessageRepo();
    return {
      ...currentRepo.getDebugInfo(),
      currentProject: this.plugin.projectManager.getCurrentProjectId(),
      totalProjects: this.projectMessageRepos.size,
    };
  }

  /**
   * Force a project switch refresh
   * This ensures the UI gets the correct messages when switching projects
   */
  async handleProjectSwitch(): Promise<void> {
    const currentProjectId = this.plugin.projectManager.getCurrentProjectId();
    logInfo(`[ChatManager] Handling project switch to: ${currentProjectId}`);

    // Force detection of project change
    this.lastKnownProjectId = null; // Reset to force change detection
    const currentRepo = this.getCurrentMessageRepo();

    // Sync chain memory with the current project's messages
    await this.updateChainMemory();

    logInfo(
      `[ChatManager] Project switch complete. Messages: ${currentRepo.getDisplayMessages().length}`
    );
  }

  /**
   * Load chat history from a file
   *
   * Design note: This method does NOT reprocess context (URLs/webTabs content fetching) for loaded messages.
   * This is intentional because:
   * 1. Historical messages represent a past conversation state - refetching would alter the original context
   * 2. URL content may have changed since the original conversation
   * 3. WebTabs are ephemeral - the tabs referenced in history are likely closed
   * 4. Performance - loading history should be fast, not trigger network requests
   *
   * The persisted chat only stores references (file paths, URLs) not the fetched content.
   * If the user wants fresh content, they should start a new conversation or regenerate specific messages.
   */
  async loadChatHistory(file: TFile): Promise<void> {
    // Clear current messages first
    this.clearMessages();

    // Load messages from file - only restores message text and context references (not fetched content)
    const messages = await this.persistenceManager.loadChat(file);

    // Add messages to the current repository
    const currentRepo = this.getCurrentMessageRepo();
    for (const message of messages) {
      currentRepo.addMessage(message);
    }

    // Update chain memory with loaded messages
    await this.updateChainMemory();

    logInfo(`[ChatManager] Loaded ${messages.length} messages from chat history`);
  }
}

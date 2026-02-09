/**
 * Approximate character-to-token ratio used across the app for heuristic budgeting.
 */
export const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Parameters for deriving an effective compaction threshold.
 */
export interface CompactionThresholdParams {
  /** Whether auto-compaction is enabled in settings. */
  enableAutoCompaction: boolean;
  /** User-configured compaction threshold in tokens. */
  configuredThresholdTokens: number;
  /** Active model context window in tokens. */
  contextWindowTokens: number;
  /** Portion of model context to allow before forcing compaction. */
  modelAwareRatio?: number;
  /** Lower bound for returned thresholds to avoid pathological tiny budgets. */
  minimumThresholdTokens?: number;
}

/**
 * Resolve a model-aware compaction threshold.
 *
 * When auto-compaction is enabled, this keeps the effective threshold below a
 * fraction of the active model context window so compaction can fire before
 * requests approach hard context limits.
 *
 * @param params - Threshold configuration and model context input.
 * @returns Effective threshold in tokens, or Infinity when compaction is disabled.
 */
export function resolveCompactionThresholdTokens(params: CompactionThresholdParams): number {
  const {
    enableAutoCompaction,
    configuredThresholdTokens,
    contextWindowTokens,
    modelAwareRatio = 0.65,
    minimumThresholdTokens = 2000,
  } = params;

  if (!enableAutoCompaction) {
    return Number.POSITIVE_INFINITY;
  }

  const configured = Number.isFinite(configuredThresholdTokens)
    ? Math.floor(configuredThresholdTokens)
    : 0;
  const contextWindow = Number.isFinite(contextWindowTokens) ? Math.floor(contextWindowTokens) : 0;

  if (configured <= 0 || contextWindow <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const modelAwareCap = Math.max(
    minimumThresholdTokens,
    Math.floor(contextWindow * modelAwareRatio)
  );
  return Math.max(minimumThresholdTokens, Math.min(configured, modelAwareCap));
}

/**
 * Parameters for deriving a local-search payload budget.
 */
export interface LocalSearchBudgetParams {
  /** Active model context window in tokens. */
  contextWindowTokens: number;
  /** Effective compaction threshold in tokens (or Infinity when disabled). */
  compactionThresholdTokens: number;
  /** Fraction of context window allocated to local-search payload. */
  contextWindowRatio: number;
  /** Hard upper bound in characters. */
  hardMaxChars: number;
  /** Minimum token budget reserved for local-search payload. */
  minimumBudgetTokens?: number;
  /** Character-per-token heuristic to convert token budget to chars. */
  charsPerToken?: number;
}

/**
 * Resolve character budget for local-search payloads.
 *
 * The budget is constrained by:
 * 1. A fraction of the model context window.
 * 2. A fraction of the effective compaction threshold.
 * 3. A hard maximum character cap.
 *
 * @param params - Budget parameters.
 * @returns Allowed local-search payload size in characters.
 */
export function resolveLocalSearchContextCharBudget(params: LocalSearchBudgetParams): number {
  const {
    contextWindowTokens,
    compactionThresholdTokens,
    contextWindowRatio,
    hardMaxChars,
    minimumBudgetTokens = 2000,
    charsPerToken = APPROX_CHARS_PER_TOKEN,
  } = params;

  const contextWindow = Number.isFinite(contextWindowTokens) ? Math.floor(contextWindowTokens) : 0;
  const ratioBudgetTokens = Math.max(
    minimumBudgetTokens,
    Math.floor(contextWindow * Math.max(contextWindowRatio, 0))
  );

  const compactionBudgetTokens = Number.isFinite(compactionThresholdTokens)
    ? Math.max(minimumBudgetTokens, Math.floor(compactionThresholdTokens * 0.45))
    : ratioBudgetTokens;

  const finalBudgetTokens = Math.max(
    minimumBudgetTokens,
    Math.min(ratioBudgetTokens, compactionBudgetTokens)
  );
  const computedChars = finalBudgetTokens * charsPerToken;

  return Math.max(minimumBudgetTokens * charsPerToken, Math.min(hardMaxChars, computedChars));
}

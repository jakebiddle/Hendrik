import { TokenUsage } from "@/types/message";

/**
 * Normalize a raw token count into a non-negative integer.
 *
 * @param value - Candidate token count value.
 * @returns Normalized token count, or null when unavailable.
 */
function normalizeTokenCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : null;
}

/**
 * Resolve prompt token count for UI context-pressure displays.
 * Prefers input/prompt tokens and falls back to total tokens if needed.
 *
 * @param tokenUsage - Token usage metadata from provider response.
 * @returns Prompt token count to display, or null when unavailable.
 */
export function resolvePromptTokenCount(tokenUsage: TokenUsage | null | undefined): number | null {
  const inputTokens = normalizeTokenCount(tokenUsage?.inputTokens);
  if (inputTokens !== null) {
    return inputTokens;
  }

  return normalizeTokenCount(tokenUsage?.totalTokens);
}

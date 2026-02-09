import { AI_SENDER, USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import MemoryManager from "./LLMProviders/memoryManager";

interface MemoryPair {
  input: string;
  output: string;
}

interface WindowedMemory {
  k?: unknown;
  saveContext: (input: { input: string }, output: { output: string }) => Promise<void>;
}

/**
 * Resolve maximum replayable user/assistant pairs from memory window settings.
 */
function resolveMaxPairsFromMemory(memory: WindowedMemory): number | null {
  const rawWindowSize = memory.k;
  if (typeof rawWindowSize !== "number" || !Number.isFinite(rawWindowSize)) {
    return null;
  }

  return Math.max(0, Math.floor(rawWindowSize / 2));
}

/**
 * Extract adjacent user/assistant turns from a flat message list.
 *
 * When `maxPairs` is provided, this scans from the tail to avoid O(n) work
 * over large historical transcripts during project/mode switches.
 */
function extractMemoryPairs(messages: ChatMessage[], maxPairs: number | null): MemoryPair[] {
  if (maxPairs !== null) {
    if (maxPairs <= 0) {
      return [];
    }

    const tailPairs: MemoryPair[] = [];
    for (let i = messages.length - 1; i > 0 && tailPairs.length < maxPairs; i--) {
      const maybeAiMessage = messages[i];
      const maybeUserMessage = messages[i - 1];
      if (maybeAiMessage.sender !== AI_SENDER || maybeUserMessage.sender !== USER_SENDER) {
        continue;
      }

      tailPairs.unshift({
        input: maybeUserMessage.message,
        output: maybeAiMessage.message,
      });
      i--;
    }

    return tailPairs;
  }

  const allPairs: MemoryPair[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const currentMessage = messages[i];
    if (currentMessage.sender !== USER_SENDER) {
      continue;
    }

    const nextMessage = messages[i + 1];
    if (nextMessage?.sender !== AI_SENDER) {
      continue;
    }

    allPairs.push({
      input: currentMessage.message,
      output: nextMessage.message,
    });
  }

  return allPairs;
}

/**
 * Rebuild chain memory from message history.
 *
 * The underlying memory keeps only a bounded window (`k` messages), so we only
 * replay the tail that can fit instead of all historical pairs.
 */
export async function updateChatMemory(
  messages: ChatMessage[],
  memoryManager: MemoryManager
): Promise<void> {
  // Clear existing memory
  await memoryManager.clearChatMemory();

  const memory = memoryManager.getMemory() as unknown as WindowedMemory;
  const maxPairs = resolveMaxPairsFromMemory(memory);
  const pairsToReplay = extractMemoryPairs(messages, maxPairs);

  // Replay only the effective conversation window.
  for (const pair of pairsToReplay) {
    await memory.saveContext({ input: pair.input }, { output: pair.output });
  }
}

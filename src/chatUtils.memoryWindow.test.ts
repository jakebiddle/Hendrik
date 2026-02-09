import { AI_SENDER, USER_SENDER } from "@/constants";
import type { ChatMessage } from "@/types/message";
import type MemoryManager from "./LLMProviders/memoryManager";
import { updateChatMemory } from "./chatUtils";

class MockMemory {
  public saved: Array<{ input: string; output: string }> = [];
  public k?: number;

  constructor(k?: number) {
    this.k = k;
  }

  async saveContext(input: { input: string }, output: { output: string }) {
    this.saved.push({ input: input.input, output: output.output });
  }
}

class MockMemoryManager {
  public cleared = false;
  private memory: MockMemory;

  constructor(memory: MockMemory) {
    this.memory = memory;
  }

  async clearChatMemory() {
    this.cleared = true;
  }

  getMemory() {
    return this.memory;
  }
}

/**
 * Build a synthetic chat transcript with alternating user/assistant turns.
 */
function buildTranscript(pairCount: number): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (let i = 1; i <= pairCount; i++) {
    messages.push({
      id: `user-${i}`,
      sender: USER_SENDER,
      message: `user-${i}`,
      isVisible: true,
      timestamp: null,
    });
    messages.push({
      id: `ai-${i}`,
      sender: AI_SENDER,
      message: `ai-${i}`,
      isVisible: true,
      timestamp: null,
    });
  }

  return messages;
}

describe("updateChatMemory windowing", () => {
  it("replays only the memory window tail when k is available", async () => {
    const memory = new MockMemory(4); // 4 messages -> 2 user/assistant pairs
    const memoryManager = new MockMemoryManager(memory);
    const messages = buildTranscript(5);

    await updateChatMemory(messages, memoryManager as unknown as MemoryManager);

    expect(memoryManager.cleared).toBe(true);
    expect(memory.saved).toEqual([
      { input: "user-4", output: "ai-4" },
      { input: "user-5", output: "ai-5" },
    ]);
  });

  it("replays all pairs when memory window metadata is unavailable", async () => {
    const memory = new MockMemory(undefined);
    const memoryManager = new MockMemoryManager(memory);
    const messages = buildTranscript(3);

    await updateChatMemory(messages, memoryManager as unknown as MemoryManager);

    expect(memory.saved).toEqual([
      { input: "user-1", output: "ai-1" },
      { input: "user-2", output: "ai-2" },
      { input: "user-3", output: "ai-3" },
    ]);
  });

  it("does not replay any pairs when memory window size is zero", async () => {
    const memory = new MockMemory(0);
    const memoryManager = new MockMemoryManager(memory);
    const messages = buildTranscript(2);

    await updateChatMemory(messages, memoryManager as unknown as MemoryManager);

    expect(memory.saved).toEqual([]);
  });
});

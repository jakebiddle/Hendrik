import { AIMessage } from "@langchain/core/messages";
import { AutonomousAgentChainRunner } from "./AutonomousAgentChainRunner";

jest.mock("@/logger");

const getSettingsMock = jest.fn();
const executeSequentialToolCallMock = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => getSettingsMock(),
}));

jest.mock("./utils/toolExecution", () => {
  const actual = jest.requireActual("./utils/toolExecution");
  return {
    ...actual,
    executeSequentialToolCall: (...args: unknown[]) => executeSequentialToolCallMock(...args),
  };
});

jest.mock("@/search/v3/QueryExpander", () => ({
  QueryExpander: jest.fn().mockImplementation(() => ({
    expand: jest.fn(async (query: string) => ({
      originalQuery: query,
      salientTerms: [],
      expandedQueries: [],
      expandedTerms: [],
    })),
  })),
}));

function createChainManagerMock() {
  return {
    app: {},
    memoryManager: {
      getMemory: () => ({
        loadMemoryVariables: jest.fn(async () => ({})),
        saveContext: jest.fn(async () => undefined),
        chatHistory: { messages: [] as unknown[] },
      }),
    },
    chatModelManager: {
      getChatModel: jest.fn(() => ({ modelName: "mock-model" })),
    },
  } as any;
}

describe("AutonomousAgentChainRunner retrieval-first routing", () => {
  beforeEach(() => {
    executeSequentialToolCallMock.mockReset();
    getSettingsMock.mockReturnValue({
      autonomousAgentMaxIterations: 4,
      defaultMaxContextTokens: 128000,
    });
  });

  it("injects localSearch first when model emits no initial tool calls", async () => {
    const runner = new AutonomousAgentChainRunner(createChainManagerMock());

    const streamSpy = jest
      .spyOn(runner as any, "streamModelResponse")
      .mockResolvedValueOnce({
        content: "",
        aiMessage: new AIMessage({ content: "" }),
        streamingResult: { content: "", wasTruncated: false },
      })
      .mockResolvedValueOnce({
        content: "Final answer",
        aiMessage: new AIMessage({ content: "Final answer" }),
        streamingResult: { content: "Final answer", wasTruncated: false },
      });

    executeSequentialToolCallMock.mockResolvedValue({
      toolName: "localSearch",
      success: true,
      result: JSON.stringify({
        type: "local_search",
        documents: [
          {
            title: "Driftmar",
            path: "Canon Lore/4C-04-06. Driftmar.md",
            score: 0.9,
            rerank_score: 0.9,
            includeInContext: true,
            content: "Lady Maren",
          },
        ],
      }),
    });

    const loopResult = await (runner as any).runReActLoop({
      boundModel: {} as any,
      tools: [{ name: "localSearch" }],
      messages: [],
      originalPrompt: "who is the lord of driftmar",
      abortController: new AbortController(),
      updateCurrentAiMessage: jest.fn(),
      processLocalSearchResult: jest.fn(() => ({
        formattedForLLM: "<localSearch>ok</localSearch>",
        formattedForDisplay: "ok",
        sources: [{ title: "Driftmar", path: "Canon Lore/4C-04-06. Driftmar.md", score: 0.9 }],
      })),
      applyCiCOrderingToLocalSearchResult: (payload: string) => payload,
      adapter: {} as any,
      continuationCheckpoint: undefined,
      isReasoningModel: false,
    });

    expect(streamSpy).toHaveBeenCalledTimes(2);
    expect(executeSequentialToolCallMock).toHaveBeenCalledTimes(1);
    expect(executeSequentialToolCallMock.mock.calls[0][0].name).toBe("localSearch");
    expect(executeSequentialToolCallMock.mock.calls[0][0].args.query).toBe(
      "who is the lord of driftmar"
    );
    expect(loopResult.finalResponse).toContain("Final answer");
  });

  it("runs deterministic fallback when first localSearch is weak", async () => {
    const runner = new AutonomousAgentChainRunner(createChainManagerMock());

    jest
      .spyOn(runner as any, "streamModelResponse")
      .mockResolvedValueOnce({
        content: "",
        aiMessage: new AIMessage({ content: "" }),
        streamingResult: { content: "", wasTruncated: false },
      })
      .mockResolvedValueOnce({
        content: "Final answer",
        aiMessage: new AIMessage({ content: "Final answer" }),
        streamingResult: { content: "Final answer", wasTruncated: false },
      });

    executeSequentialToolCallMock.mockResolvedValue({
      toolName: "localSearch",
      success: true,
      result: JSON.stringify({
        type: "local_search",
        documents: [
          {
            title: "Driftmar",
            path: "Canon Lore/4C-04-06. Driftmar.md",
            score: 0.1,
            rerank_score: 0.1,
            includeInContext: true,
            content: "Weak hit",
          },
        ],
      }),
    });

    const fallbackSpy = jest
      .spyOn(runner as any, "runDeterministicTitleReadFallback")
      .mockResolvedValue({
        toolOutputs: [
          {
            tool: "findNotesByTitle",
            output: JSON.stringify({
              type: "title_search",
              results: [{ path: "Canon Lore/4C-04-06. Driftmar.md", score: 1 }],
            }),
          },
          {
            tool: "readNote",
            output: JSON.stringify({
              notePath: "Canon Lore/4C-04-06. Driftmar.md",
              chunkId: "Canon Lore/4C-04-06. Driftmar.md#L1-80",
            }),
          },
        ],
        sources: [
          {
            title: "4C-04-06. Driftmar",
            path: "Canon Lore/4C-04-06. Driftmar.md",
            score: 1,
            explanation: {
              toolEvidence: {
                tool: "readNote",
              },
            },
          },
        ],
      });

    const loopResult = await (runner as any).runReActLoop({
      boundModel: {} as any,
      tools: [{ name: "localSearch" }],
      messages: [],
      originalPrompt: "who is the lord of driftmar",
      abortController: new AbortController(),
      updateCurrentAiMessage: jest.fn(),
      processLocalSearchResult: jest.fn(() => ({
        formattedForLLM: "<localSearch>weak</localSearch>",
        formattedForDisplay: "weak",
        sources: [{ title: "Driftmar", path: "Canon Lore/4C-04-06. Driftmar.md", score: 0.1 }],
      })),
      applyCiCOrderingToLocalSearchResult: (payload: string) => payload,
      adapter: {} as any,
      continuationCheckpoint: undefined,
      isReasoningModel: false,
    });

    expect(fallbackSpy).toHaveBeenCalledTimes(1);
    expect(
      loopResult.sources.some((source: any) => source.path.includes("4C-04-06. Driftmar"))
    ).toBe(true);
  });

  it("repairs malformed model-provided localSearch args before execution", async () => {
    const runner = new AutonomousAgentChainRunner(createChainManagerMock());

    jest
      .spyOn(runner as any, "streamModelResponse")
      .mockResolvedValueOnce({
        content: "",
        aiMessage: new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call-local-1",
              name: "localSearch",
              args: {} as any,
              type: "tool_call",
            },
          ],
        }),
        streamingResult: { content: "", wasTruncated: false },
      })
      .mockResolvedValueOnce({
        content: "Final answer",
        aiMessage: new AIMessage({ content: "Final answer" }),
        streamingResult: { content: "Final answer", wasTruncated: false },
      });

    executeSequentialToolCallMock.mockResolvedValue({
      toolName: "localSearch",
      success: true,
      result: JSON.stringify({
        type: "local_search",
        documents: [
          {
            title: "Driftmar",
            path: "Canon Lore/4C-04-06. Driftmar.md",
            score: 0.7,
            rerank_score: 0.7,
            includeInContext: true,
            content: "Lady Maren",
          },
        ],
      }),
    });

    await (runner as any).runReActLoop({
      boundModel: {} as any,
      tools: [{ name: "localSearch" }],
      messages: [],
      originalPrompt: "who is the lord of driftmar",
      abortController: new AbortController(),
      updateCurrentAiMessage: jest.fn(),
      processLocalSearchResult: jest.fn(() => ({
        formattedForLLM: "<localSearch>ok</localSearch>",
        formattedForDisplay: "ok",
        sources: [{ title: "Driftmar", path: "Canon Lore/4C-04-06. Driftmar.md", score: 0.7 }],
      })),
      applyCiCOrderingToLocalSearchResult: (payload: string) => payload,
      adapter: {} as any,
      continuationCheckpoint: undefined,
      isReasoningModel: false,
    });

    const executedCall = executeSequentialToolCallMock.mock.calls[0][0];
    expect(executedCall.name).toBe("localSearch");
    expect(executedCall.args.query).toBe("who is the lord of driftmar");
    expect(Array.isArray(executedCall.args.salientTerms)).toBe(true);
  });
});

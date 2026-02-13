import { ModelCapability } from "@/constants";
import { localSearchTool } from "@/tools/SearchTools";
import { ToolCallingChainRunner } from "./ToolCallingChainRunner";

jest.mock("@/logger");
jest.mock("./utils/promptPayloadRecorder", () => ({
  recordPromptPayload: jest.fn(),
}));

const getSettingsMock = jest.fn();
const withSuppressedTokenWarningsMock = jest.fn((fn: () => unknown) => fn());
const callToolMock = jest.fn();

let closeResult: { content: string; wasTruncated: boolean; tokenUsage?: unknown } = {
  content: "",
  wasTruncated: false,
};

jest.mock("./utils/ThinkBlockStreamer", () => ({
  ThinkBlockStreamer: jest.fn().mockImplementation(() => ({
    processChunk: jest.fn(),
    processErrorChunk: jest.fn(),
    close: jest.fn(() => closeResult),
  })),
}));

jest.mock("@/settings/model", () => ({
  getSettings: () => getSettingsMock(),
}));

jest.mock("@/tools/toolManager", () => ({
  ToolManager: {
    callTool: (...args: unknown[]) => callToolMock(...args),
  },
}));

jest.mock("@/utils", () => ({
  extractChatHistory: jest.fn(() => []),
  getApiErrorMessage: jest.fn((error: unknown) => String(error)),
  getMessageRole: jest.fn(() => "system"),
  withSuppressedTokenWarnings: (fn: () => unknown) => withSuppressedTokenWarningsMock(fn),
}));

jest.mock("@/aiParams", () => ({
  isProjectMode: jest.fn(() => false),
}));

jest.mock("@/LLMProviders/projectManager", () => ({
  __esModule: true,
  default: {
    instance: {
      getCurrentChainManager: () => ({
        memoryManager: {
          getMemory: () => ({
            loadMemoryVariables: jest.fn(async () => ({})),
          }),
        },
      }),
    },
  },
}));

jest.mock("./utils/citationUtils", () => {
  const actual = jest.requireActual("./utils/citationUtils");
  return {
    ...actual,
    addFallbackSources: jest.fn((response: string) => response),
  };
});

function createChainManagerMock() {
  const memory = {
    loadMemoryVariables: jest.fn(async () => ({})),
    saveContext: jest.fn(async () => undefined),
    chatHistory: { messages: [] as unknown[] },
  };

  return {
    app: {},
    memoryManager: {
      getMemory: () => memory,
    },
    chatModelManager: {
      getChatModel: jest.fn(() => ({
        modelName: "mock-model",
      })),
      findModelByName: jest.fn(() => ({
        capabilities: [ModelCapability.REASONING],
      })),
    },
  } as any;
}

function createUserMessage(message: string): any {
  return {
    message,
    originalMessage: message,
    contextEnvelope: {
      layers: [{ id: "L5_USER", text: message }],
    },
  };
}

describe("ToolCallingChainRunner retrieval-first routing", () => {
  beforeEach(() => {
    closeResult = {
      content: "Answer.",
      wasTruncated: false,
    };

    callToolMock.mockReset();
    getSettingsMock.mockReturnValue({
      entityGraphStrictEvidenceGate: true,
      enableInlineCitations: false,
      defaultMaxContextTokens: 128000,
      enableAutoCompaction: true,
      autoCompactThreshold: 80000,
      qaExclusions: "hendrik,Obsidian%20Files",
    });
  });

  it("forces localSearch first for lore q&a without explicit read intent", async () => {
    const runner = new ToolCallingChainRunner(createChainManagerMock());
    jest.spyOn(runner as any, "planToolCalls").mockResolvedValue({
      toolCalls: [],
      salientTerms: ["lord", "driftmar"],
    });
    jest.spyOn(runner as any, "processAtCommands").mockResolvedValue([]);
    const executeSpy = jest.spyOn(runner as any, "executeToolCalls").mockResolvedValue({
      toolOutputs: [],
      sources: [],
      entityQueryMode: false,
      entityEvidenceFound: false,
    });
    jest.spyOn(runner as any, "streamMultimodalResponse").mockResolvedValue(undefined);
    jest.spyOn(runner as any, "handleResponse").mockResolvedValue("ok");

    await runner.run(
      createUserMessage("who is the lord of driftmar"),
      new AbortController(),
      jest.fn(),
      jest.fn(),
      {}
    );

    const plannedCalls = executeSpy.mock.calls[0][0] as any[];
    expect(plannedCalls[0].tool.name).toBe("localSearch");
    expect(plannedCalls[0].args.query).toBe("who is the lord of driftmar");
  });

  it("bypasses retrieval-first forcing for explicit read intent", async () => {
    const runner = new ToolCallingChainRunner(createChainManagerMock());
    jest.spyOn(runner as any, "planToolCalls").mockResolvedValue({
      toolCalls: [],
      salientTerms: [],
    });
    jest.spyOn(runner as any, "processAtCommands").mockResolvedValue([]);
    const executeSpy = jest.spyOn(runner as any, "executeToolCalls").mockResolvedValue({
      toolOutputs: [],
      sources: [],
      entityQueryMode: false,
      entityEvidenceFound: false,
    });
    jest.spyOn(runner as any, "streamMultimodalResponse").mockResolvedValue(undefined);
    jest.spyOn(runner as any, "handleResponse").mockResolvedValue("ok");

    await runner.run(
      createUserMessage("read [[Canon Lore/4C-04-06. Driftmar]]"),
      new AbortController(),
      jest.fn(),
      jest.fn(),
      {}
    );

    const plannedCalls = executeSpy.mock.calls[0][0] as any[];
    expect(plannedCalls.some((call: any) => call.tool.name === "localSearch")).toBe(false);
  });

  it("runs deterministic title+read fallback when first localSearch is weak", async () => {
    const runner = new ToolCallingChainRunner(createChainManagerMock());
    callToolMock
      .mockResolvedValueOnce(
        JSON.stringify({
          type: "local_search",
          documents: [
            {
              title: "Driftmar",
              path: "Canon Lore/4C-04-06. Driftmar.md",
              includeInContext: true,
              score: 0.1,
              rerank_score: 0.1,
              content: "Weak hit",
            },
          ],
          entityQueryMode: false,
          entityEvidence: false,
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          type: "title_search",
          query: "who is the lord of driftmar",
          results: [
            {
              path: "Canon Lore/4C-04-06. Driftmar.md",
              title: "4C-04-06. Driftmar",
              extension: "md",
              score: 0.8,
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          notePath: "Canon Lore/4C-04-06. Driftmar.md",
          noteTitle: "4C-04-06. Driftmar",
          chunkId: "Canon Lore/4C-04-06. Driftmar.md#L1-120",
          content: "Ruler: Lady Maren Driftmar",
        })
      );

    const result = await (runner as any).executeToolCalls(
      [
        {
          tool: localSearchTool,
          args: {
            query: "who is the lord of driftmar",
            salientTerms: ["lord", "driftmar"],
          },
        },
      ],
      undefined,
      "who is the lord of driftmar"
    );

    expect(result.toolOutputs.map((entry: any) => entry.tool)).toEqual([
      "localSearch",
      "findNotesByTitle",
      "readNote",
    ]);
    expect(
      result.sources.some((source: any) => source.explanation?.toolEvidence?.tool === "readNote")
    ).toBe(true);
  });

  it("does not run fallback when first localSearch is strong", async () => {
    const runner = new ToolCallingChainRunner(createChainManagerMock());
    callToolMock.mockResolvedValueOnce(
      JSON.stringify({
        type: "local_search",
        documents: [
          {
            title: "Driftmar",
            path: "Canon Lore/4C-04-06. Driftmar.md",
            includeInContext: true,
            score: 0.86,
            rerank_score: 0.86,
            content: "Strong hit",
          },
        ],
        entityQueryMode: false,
        entityEvidence: false,
      })
    );

    const result = await (runner as any).executeToolCalls(
      [
        {
          tool: localSearchTool,
          args: {
            query: "who is the lord of driftmar",
            salientTerms: ["lord", "driftmar"],
          },
        },
      ],
      undefined,
      "who is the lord of driftmar"
    );

    expect(result.toolOutputs.map((entry: any) => entry.tool)).toEqual(["localSearch"]);
    expect(callToolMock).toHaveBeenCalledTimes(1);
  });

  it("repairs malformed localSearch args before tool execution", async () => {
    const runner = new ToolCallingChainRunner(createChainManagerMock());
    callToolMock.mockResolvedValueOnce(
      JSON.stringify({
        type: "local_search",
        documents: [
          {
            title: "Driftmar",
            path: "Canon Lore/4C-04-06. Driftmar.md",
            includeInContext: true,
            score: 0.7,
            rerank_score: 0.7,
            content: "Lady Maren",
          },
        ],
      })
    );

    await (runner as any).executeToolCalls(
      [
        {
          tool: localSearchTool,
          args: {
            salientTerms: "broken",
          },
        },
      ],
      undefined,
      "who is the lord of driftmar"
    );

    const effectiveArgs = callToolMock.mock.calls[0][1];
    expect(effectiveArgs.query).toBe("who is the lord of driftmar");
    expect(Array.isArray(effectiveArgs.salientTerms)).toBe(true);
    expect(effectiveArgs.salientTerms.length).toBeGreaterThan(0);
  });
});

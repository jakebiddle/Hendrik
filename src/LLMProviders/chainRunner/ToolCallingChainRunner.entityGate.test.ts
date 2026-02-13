import { ModelCapability } from "@/constants";
import { ToolCallingChainRunner } from "./ToolCallingChainRunner";

jest.mock("@/logger");
jest.mock("./utils/promptPayloadRecorder", () => ({
  recordPromptPayload: jest.fn(),
}));

const getSettingsMock = jest.fn();
const withSuppressedTokenWarningsMock = jest.fn((fn: () => unknown) => fn());

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

/**
 * Creates a minimal chain manager mock for ToolCallingChainRunner.
 */
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

/**
 * Creates a baseline user message with required context envelope.
 */
function createUserMessage(message = "Tell me about Arin"): any {
  return {
    message,
    originalMessage: message,
    contextEnvelope: {
      layers: [
        {
          id: "L5_USER",
          text: message,
        },
      ],
    },
  };
}

describe("ToolCallingChainRunner entity evidence gate", () => {
  beforeEach(() => {
    closeResult = {
      content: "",
      wasTruncated: false,
    };

    getSettingsMock.mockReturnValue({
      entityGraphStrictEvidenceGate: true,
      enableInlineCitations: true,
      defaultMaxContextTokens: 128000,
      enableAutoCompaction: true,
      autoCompactThreshold: 80000,
    });
  });

  it("short-circuits pre-answer when local search reports entity mode without evidence", async () => {
    const chainManager = createChainManagerMock();
    const runner = new ToolCallingChainRunner(chainManager);

    const planSpy = jest
      .spyOn(runner as any, "planToolCalls")
      .mockResolvedValue({ toolCalls: [], salientTerms: [] });
    const atCommandSpy = jest.spyOn(runner as any, "processAtCommands").mockResolvedValue([]);
    const executeSpy = jest.spyOn(runner as any, "executeToolCalls").mockResolvedValue({
      toolOutputs: [],
      sources: [],
      entityQueryMode: true,
      entityEvidenceFound: false,
    });
    const streamSpy = jest
      .spyOn(runner as any, "streamMultimodalResponse")
      .mockResolvedValue(undefined);
    const handleResponseSpy = jest
      .spyOn(runner as any, "handleResponse")
      .mockImplementation(async (responseText: string) => responseText);

    const response = await runner.run(
      createUserMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn(),
      {}
    );

    expect(planSpy).toHaveBeenCalled();
    expect(atCommandSpy).toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalled();
    expect(streamSpy).not.toHaveBeenCalled();
    expect(response).toContain("Insufficient entity-backed lore evidence");
    expect(handleResponseSpy).toHaveBeenCalledWith(
      expect.stringContaining("Insufficient entity-backed lore evidence"),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("replaces uncited entity responses during post-answer gate even after fallback source processing", async () => {
    const chainManager = createChainManagerMock();
    const runner = new ToolCallingChainRunner(chainManager);

    closeResult = {
      content: "Arin once negotiated terms with the western dukes.",
      wasTruncated: false,
    };

    jest
      .spyOn(runner as any, "planToolCalls")
      .mockResolvedValue({ toolCalls: [], salientTerms: [] });
    jest.spyOn(runner as any, "processAtCommands").mockResolvedValue([]);
    jest.spyOn(runner as any, "executeToolCalls").mockResolvedValue({
      toolOutputs: [],
      sources: [{ title: "Chronicle/Arin.md", path: "Chronicle/Arin.md", score: 0.8 }],
      entityQueryMode: true,
      entityEvidenceFound: true,
    });
    const streamSpy = jest
      .spyOn(runner as any, "streamMultimodalResponse")
      .mockResolvedValue(undefined);
    const handleResponseSpy = jest
      .spyOn(runner as any, "handleResponse")
      .mockResolvedValue("ignored");

    const response = await runner.run(
      createUserMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn(),
      {}
    );

    expect(streamSpy).toHaveBeenCalled();
    expect(response).toContain(
      "I cannot provide a lore assertion without verifiable entity evidence"
    );
    expect(handleResponseSpy.mock.calls[0][5]).toEqual([]);
  });

  it("allows entity responses with inline citations to pass through the post-answer gate", async () => {
    const chainManager = createChainManagerMock();
    const runner = new ToolCallingChainRunner(chainManager);

    closeResult = {
      content:
        "Arin negotiated the western treaty in 1203 [^1].\n\n#### Sources:\n[^1]: [[Chronicle/Arin.md]]",
      wasTruncated: false,
    };

    jest
      .spyOn(runner as any, "planToolCalls")
      .mockResolvedValue({ toolCalls: [], salientTerms: [] });
    jest.spyOn(runner as any, "processAtCommands").mockResolvedValue([]);
    jest.spyOn(runner as any, "executeToolCalls").mockResolvedValue({
      toolOutputs: [],
      sources: [{ title: "Chronicle/Arin.md", path: "Chronicle/Arin.md", score: 0.8 }],
      entityQueryMode: true,
      entityEvidenceFound: true,
    });
    jest.spyOn(runner as any, "streamMultimodalResponse").mockResolvedValue(undefined);
    jest.spyOn(runner as any, "handleResponse").mockResolvedValue("ignored");

    const response = await runner.run(
      createUserMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn(),
      {}
    );

    expect(response).toContain("[^1]");
    expect(response).not.toContain("I cannot provide a lore assertion");
  });
});

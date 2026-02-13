import { Document } from "@langchain/core/documents";
import { ModelCapability } from "@/constants";
import { VaultQAChainRunner } from "./VaultQAChainRunner";

jest.mock("@/logger");
jest.mock("./utils/promptPayloadRecorder", () => ({
  recordPromptPayload: jest.fn(),
}));

const getSettingsMock = jest.fn();
const createRetrieverMock = jest.fn();
const loadAndAddChatHistoryMock = jest.fn();
const convertLayersMock = jest.fn();
const withSuppressedTokenWarningsMock = jest.fn((fn: () => unknown) => fn());
const findCustomModelMock = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => getSettingsMock(),
}));

jest.mock("@/aiParams", () => ({
  getModelKey: jest.fn(() => "mock-model-key"),
}));

jest.mock("@/search/RetrieverFactory", () => ({
  RetrieverFactory: {
    createRetriever: (...args: unknown[]) => createRetrieverMock(...args),
  },
}));

jest.mock("./utils/chatHistoryUtils", () => ({
  loadAndAddChatHistory: (...args: unknown[]) => loadAndAddChatHistoryMock(...args),
}));

jest.mock("@/context/LayerToMessagesConverter", () => ({
  LayerToMessagesConverter: {
    convert: (...args: unknown[]) => convertLayersMock(...args),
  },
}));

jest.mock("@/utils", () => ({
  extractChatHistory: jest.fn(() => []),
  extractUniqueTitlesFromDocs: jest.fn(() => [{ title: "Chronicle/Arin.md" }]),
  findCustomModel: (...args: unknown[]) => findCustomModelMock(...args),
  getMessageRole: jest.fn(() => "system"),
  withSuppressedTokenWarnings: (fn: () => unknown) => withSuppressedTokenWarningsMock(fn),
}));

/**
 * Creates a single-pass async stream for mocked model responses.
 *
 * @param content - Streamed content payload.
 * @returns Async iterable chunk stream.
 */
async function* createChunkStream(
  content: string
): AsyncGenerator<{ content: string }, void, unknown> {
  yield { content };
}

/**
 * Builds a minimal chain manager mock required by VaultQAChainRunner.
 */
function createChainManagerMock() {
  let retrievedDocs: Document[] = [];
  const memory = {
    loadMemoryVariables: jest.fn(async () => ({})),
    saveContext: jest.fn(async () => undefined),
    chatHistory: { messages: [] as unknown[] },
  };

  const chatModel = {
    modelName: "mock-model",
    stream: jest.fn(async () => createChunkStream("")),
  };

  return {
    memoryManager: {
      getMemory: () => memory,
    },
    chatModelManager: {
      getChatModel: () => chatModel,
    },
    storeRetrieverDocuments: jest.fn((docs: Document[]) => {
      retrievedDocs = docs;
    }),
    getRetrievedDocuments: jest.fn(() => retrievedDocs),
  } as any;
}

/**
 * Creates a baseline user chat message with an L5 layer.
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
    content: undefined,
  };
}

describe("VaultQAChainRunner entity evidence gate", () => {
  beforeEach(() => {
    (global as any).app = {};
    getSettingsMock.mockReturnValue({
      entityGraphStrictEvidenceGate: true,
      maxSourceChunks: 8,
      enableInlineCitations: true,
      activeModels: [],
    });
    findCustomModelMock.mockReturnValue({
      capabilities: [ModelCapability.REASONING],
    });
    loadAndAddChatHistoryMock.mockResolvedValue(undefined);
    convertLayersMock.mockReturnValue([
      { role: "system", content: "System layer" },
      { role: "user", content: "User layer" },
    ]);
  });

  it("short-circuits before model invocation when entity mode is active and no evidence is found", async () => {
    const retrievedDocs = [
      new Document({
        pageContent: "Lore fragment",
        metadata: {
          path: "Chronicle/Arin.md",
          title: "Arin",
          entityQueryMode: true,
        },
      }),
    ];

    createRetrieverMock.mockResolvedValue({
      retriever: {
        getRelevantDocuments: jest.fn(async () => retrievedDocs),
      },
      type: "lexical",
      reason: "unit-test",
    });

    const chainManager = createChainManagerMock();
    const runner = new VaultQAChainRunner(chainManager);
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

    expect(response).toContain("Insufficient entity-backed lore evidence");
    expect(handleResponseSpy).toHaveBeenCalledWith(
      expect.stringContaining("Insufficient entity-backed lore evidence"),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(chainManager.chatModelManager.getChatModel().stream).not.toHaveBeenCalled();
  });

  it("replaces uncited entity answers with strict abstain during post-answer gate", async () => {
    const retrievedDocs = [
      new Document({
        pageContent: "Arin was born in Sunhold.",
        metadata: {
          path: "Chronicle/Arin.md",
          title: "Arin",
          entityQueryMode: true,
          entityEvidence: true,
          explanation: {
            entityGraph: {
              matchedEntities: ["Arin"],
              relationTypes: ["wiki_link"],
              hopDepth: 1,
              evidenceCount: 1,
              relationPaths: ["Arin --wiki_link--> Sunhold"],
              evidenceRefs: [],
              scoreContribution: 0.8,
            },
          },
        },
      }),
    ];

    createRetrieverMock.mockResolvedValue({
      retriever: {
        getRelevantDocuments: jest.fn(async () => retrievedDocs),
      },
      type: "lexical",
      reason: "unit-test",
    });

    const chainManager = createChainManagerMock();
    chainManager.chatModelManager
      .getChatModel()
      .stream.mockResolvedValue(
        createChunkStream("Arin was born somewhere in the western marches.")
      );

    const runner = new VaultQAChainRunner(chainManager);
    jest.spyOn(runner as any, "handleResponse").mockResolvedValue("ignored");

    const response = await runner.run(
      createUserMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn(),
      {}
    );

    expect(response).toContain(
      "I cannot provide a lore assertion without verifiable entity evidence"
    );
  });

  it("keeps cited entity answers when strict gate requirements are satisfied", async () => {
    const retrievedDocs = [
      new Document({
        pageContent: "Arin was born in Sunhold.",
        metadata: {
          path: "Chronicle/Arin.md",
          title: "Arin",
          entityQueryMode: true,
          entityEvidence: true,
          explanation: {
            entityGraph: {
              matchedEntities: ["Arin"],
              relationTypes: ["wiki_link"],
              hopDepth: 1,
              evidenceCount: 1,
              relationPaths: ["Arin --wiki_link--> Sunhold"],
              evidenceRefs: [],
              scoreContribution: 0.8,
            },
          },
        },
      }),
    ];

    createRetrieverMock.mockResolvedValue({
      retriever: {
        getRelevantDocuments: jest.fn(async () => retrievedDocs),
      },
      type: "lexical",
      reason: "unit-test",
    });

    const chainManager = createChainManagerMock();
    chainManager.chatModelManager
      .getChatModel()
      .stream.mockResolvedValue(
        createChunkStream(
          "Arin was born in Sunhold [^1].\n\n#### Sources:\n[^1]: [[Chronicle/Arin.md]]"
        )
      );

    const runner = new VaultQAChainRunner(chainManager);
    jest.spyOn(runner as any, "handleResponse").mockResolvedValue("ignored");

    const response = await runner.run(
      createUserMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn(),
      {}
    );

    expect(response).toContain("Arin was born in Sunhold [^1]");
    expect(response).not.toContain("I cannot provide a lore assertion");
  });
});

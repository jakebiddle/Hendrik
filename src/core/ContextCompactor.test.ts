const getChatModelWithTemperatureMock = jest.fn();
const invokeMock = jest.fn();

jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(() => ({
      getChatModelWithTemperature: getChatModelWithTemperatureMock,
    })),
  },
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

import { ContextCompactor } from "@/core/ContextCompactor";

/**
 * Build a minimal note context block for compaction tests.
 *
 * @param path - Note path to encode in XML.
 * @param content - Note content payload.
 * @returns XML block string.
 */
function buildNoteContextBlock(path: string, content: string): string {
  return [
    "<note_context>",
    `<title>${path}</title>`,
    `<path>${path}</path>`,
    `<content>${content}</content>`,
    "</note_context>",
  ].join("\n");
}

describe("ContextCompactor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ContextCompactor as any).instance = undefined;
    getChatModelWithTemperatureMock.mockResolvedValue({ invoke: invokeMock });
  });

  it("compacts medium-sized blocks under a tight target budget", async () => {
    invokeMock.mockResolvedValue({ content: "Concise summary." });

    const content = [
      buildNoteContextBlock("note-a.md", "A".repeat(12000)),
      buildNoteContextBlock("note-b.md", "B".repeat(10000)),
    ].join("\n\n");

    const result = await ContextCompactor.getInstance().compact(content, { targetCharCount: 6000 });

    expect(result.wasCompacted).toBe(true);
    expect(result.itemsSummarized).toBeGreaterThan(0);
    expect(result.targetCharCount).toBe(6000);
    expect(result.targetMet).toBe(true);
    expect(result.compactedCharCount).toBeLessThan(result.originalCharCount);
    expect(result.content).toContain("[SUMMARIZED]");
    expect(invokeMock).toHaveBeenCalled();
  });

  it("parses nested content blocks without truncating outer content", async () => {
    invokeMock.mockResolvedValue({ content: "Nested-safe summary." });

    const nestedContent = [
      "<embedded_note>",
      "<title>Inner</title>",
      "<path>inner.md</path>",
      `<content>${"N".repeat(256)}</content>`,
      "</embedded_note>",
      `TAIL_SENTINEL_${"X".repeat(9000)}`,
    ].join("\n");

    const content = buildNoteContextBlock("nested.md", nestedContent);

    const result = await ContextCompactor.getInstance().compact(content, { targetCharCount: 2000 });

    expect(result.wasCompacted).toBe(true);
    const firstInvokeArgs = invokeMock.mock.calls[0][0];
    expect(firstInvokeArgs[0].content).toContain("TAIL_SENTINEL_");
  });

  it("returns a structured no-op reason when no items are large enough to summarize", async () => {
    invokeMock.mockResolvedValue({ content: "Summary" });

    const content = buildNoteContextBlock("tiny.md", "small payload");
    const result = await ContextCompactor.getInstance().compact(content, { targetCharCount: 1 });

    expect(result.wasCompacted).toBe(false);
    expect(result.noOpReason).toBe("no_candidates");
  });

  it("returns high_failure_rate when summarization failures exceed 50%", async () => {
    invokeMock.mockRejectedValue(new Error("model failure"));

    const content = buildNoteContextBlock("failing.md", "Z".repeat(8000));
    const result = await ContextCompactor.getInstance().compact(content, { targetCharCount: 2000 });

    expect(result.wasCompacted).toBe(false);
    expect(result.noOpReason).toBe("high_failure_rate");
    expect(result.itemsSummarized).toBe(0);
  });
});

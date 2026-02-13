import { executeSequentialToolCall } from "./toolExecution";
import { createLangChainTool } from "@/tools/createLangChainTool";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { SemanticRelationProposalStore } from "@/search/entityGraph";
import { z } from "zod";

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/tools/toolManager", () => ({
  ToolManager: {
    callTool: jest.fn(),
  },
}));

import { ToolManager } from "@/tools/toolManager";

describe("toolExecution", () => {
  const mockCallTool = ToolManager.callTool as jest.MockedFunction<typeof ToolManager.callTool>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the registry before each test
    ToolRegistry.getInstance().clear();
  });

  describe("executeSequentialToolCall", () => {
    it("should execute tools without isPlusOnly flag", async () => {
      const testTool = createLangChainTool({
        name: "testTool",
        description: "Test tool",
        schema: z.object({ input: z.string() }),
        func: async ({ input }) => `Result: ${input}`,
      });

      // Register tool without isPlusOnly
      ToolRegistry.getInstance().register({
        tool: testTool,
        metadata: {
          id: "testTool",
          displayName: "Test Tool",
          description: "Test tool",
          category: "custom",
        },
      });

      mockCallTool.mockResolvedValueOnce("Tool executed successfully");

      const result = await executeSequentialToolCall(
        { name: "testTool", args: { input: "test" } },
        [testTool]
      );

      expect(result).toEqual({
        toolName: "testTool",
        result: "Tool executed successfully",
        success: true,
      });
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("should execute tools with isPlusOnly flag", async () => {
      const plusTool = createLangChainTool({
        name: "plusTool",
        description: "Plus-only tool",
        schema: z.object({}),
        func: async () => "Should not execute",
      });

      // Register tool with isPlusOnly metadata
      ToolRegistry.getInstance().register({
        tool: plusTool,
        metadata: {
          id: "plusTool",
          displayName: "Plus Tool",
          description: "Plus-only tool",
          category: "custom",
          isPlusOnly: true,
        },
      });

      mockCallTool.mockResolvedValueOnce("Plus tool executed");

      const result = await executeSequentialToolCall({ name: "plusTool", args: {} }, [plusTool]);

      expect(result).toEqual({
        toolName: "plusTool",
        result: "Plus tool executed",
        success: true,
      });
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("should allow plus-only tools for plus users", async () => {
      const plusTool = createLangChainTool({
        name: "plusTool",
        description: "Plus-only tool",
        schema: z.object({}),
        func: async () => "Plus tool executed",
      });

      // Register tool with isPlusOnly metadata
      ToolRegistry.getInstance().register({
        tool: plusTool,
        metadata: {
          id: "plusTool",
          displayName: "Plus Tool",
          description: "Plus-only tool",
          category: "custom",
          isPlusOnly: true,
        },
      });

      mockCallTool.mockResolvedValueOnce("Plus tool executed");

      const result = await executeSequentialToolCall({ name: "plusTool", args: {} }, [plusTool]);

      expect(result).toEqual({
        toolName: "plusTool",
        result: "Plus tool executed",
        success: true,
      });
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("should handle tool not found", async () => {
      const result = await executeSequentialToolCall({ name: "unknownTool", args: {} }, []);

      expect(result).toEqual({
        toolName: "unknownTool",
        result:
          "Error: Tool 'unknownTool' not found. Available tools: . Make sure you have the tool enabled in the Agent settings.",
        success: false,
      });
    });

    it("should handle invalid tool call", async () => {
      const result = await executeSequentialToolCall(null as any, []);

      expect(result).toEqual({
        toolName: "unknown",
        result: "Error: Invalid tool call - missing tool name",
        success: false,
      });
    });

    it("should ingest semantic relation proposals from tool payloads", async () => {
      const relationTool = createLangChainTool({
        name: "extractEntityRelations",
        description: "Extract semantic relations",
        schema: z.object({ input: z.string() }),
        func: async () => "unused",
      });

      ToolRegistry.getInstance().register({
        tool: relationTool,
        metadata: {
          id: "extractEntityRelations",
          displayName: "Extract Entity Relations",
          description: "Extract semantic relations",
          category: "custom",
        },
      });

      SemanticRelationProposalStore.getInstance().clear();
      mockCallTool.mockResolvedValueOnce({
        semanticRelationProposals: [
          {
            notePath: "Characters/Arin.md",
            predicate: "ally",
            targetPath: "Characters/Lira.md",
            confidence: 0.9,
          },
        ],
      });

      const result = await executeSequentialToolCall(
        { name: "extractEntityRelations", args: { input: "Arin allied with Lira" } },
        [relationTool]
      );

      expect(result.success).toBe(true);
      const proposals = SemanticRelationProposalStore.getInstance().getAllProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].predicate).toBe("allied_with");
      expect(proposals[0].sourceField).toBe("tool:extractEntityRelations");
    });
  });
});

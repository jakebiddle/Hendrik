import { resolvePromptTokenCount } from "@/utils/tokenUsageUtils";

describe("resolvePromptTokenCount", () => {
  it("prefers inputTokens when available", () => {
    expect(resolvePromptTokenCount({ inputTokens: 1200, totalTokens: 4500 })).toBe(1200);
  });

  it("falls back to totalTokens when inputTokens is unavailable", () => {
    expect(resolvePromptTokenCount({ totalTokens: 9876 })).toBe(9876);
  });

  it("returns null when token usage is missing or invalid", () => {
    expect(resolvePromptTokenCount(null)).toBeNull();
    expect(resolvePromptTokenCount(undefined)).toBeNull();
    expect(resolvePromptTokenCount({ inputTokens: -10, totalTokens: Number.NaN })).toBeNull();
  });
});

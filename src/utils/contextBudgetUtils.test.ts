import {
  resolveCompactionThresholdTokens,
  resolveLocalSearchContextCharBudget,
} from "./contextBudgetUtils";

describe("contextBudgetUtils", () => {
  describe("resolveCompactionThresholdTokens", () => {
    it("returns Infinity when auto-compaction is disabled", () => {
      const threshold = resolveCompactionThresholdTokens({
        enableAutoCompaction: false,
        configuredThresholdTokens: 128000,
        contextWindowTokens: 128000,
      });

      expect(threshold).toBe(Number.POSITIVE_INFINITY);
    });

    it("caps threshold by model context ratio", () => {
      const threshold = resolveCompactionThresholdTokens({
        enableAutoCompaction: true,
        configuredThresholdTokens: 128000,
        contextWindowTokens: 32000,
      });

      // floor(32000 * 0.65) = 20800
      expect(threshold).toBe(20800);
    });

    it("keeps configured threshold when below model-aware cap", () => {
      const threshold = resolveCompactionThresholdTokens({
        enableAutoCompaction: true,
        configuredThresholdTokens: 12000,
        contextWindowTokens: 128000,
      });

      expect(threshold).toBe(12000);
    });
  });

  describe("resolveLocalSearchContextCharBudget", () => {
    it("respects context window ratio for normal budgets", () => {
      const budgetChars = resolveLocalSearchContextCharBudget({
        contextWindowTokens: 32000,
        compactionThresholdTokens: 20800,
        contextWindowRatio: 0.12,
        hardMaxChars: 448000,
      });

      // 32000 * 0.12 = 3840 tokens -> 15360 chars
      expect(budgetChars).toBe(15360);
    });

    it("respects hard character cap", () => {
      const budgetChars = resolveLocalSearchContextCharBudget({
        contextWindowTokens: 500000,
        compactionThresholdTokens: 500000,
        contextWindowRatio: 0.3,
        hardMaxChars: 60000,
      });

      expect(budgetChars).toBe(60000);
    });

    it("keeps a minimum safe budget when thresholds are tiny", () => {
      const budgetChars = resolveLocalSearchContextCharBudget({
        contextWindowTokens: 1000,
        compactionThresholdTokens: 1000,
        contextWindowRatio: 0.01,
        hardMaxChars: 448000,
      });

      // minimumBudgetTokens (2000) * 4
      expect(budgetChars).toBe(8000);
    });
  });
});

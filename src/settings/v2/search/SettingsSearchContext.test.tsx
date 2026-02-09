import {
  matchesSettingsSearchQuery,
  normalizeSettingsSearchQuery,
} from "@/settings/v2/search/SettingsSearchContext";

describe("SettingsSearchContext utilities", () => {
  test("normalizes query", () => {
    expect(normalizeSettingsSearchQuery("  AI   Models ")).toBe("ai   models");
  });

  test("matches when query is empty", () => {
    expect(matchesSettingsSearchQuery("", ["anything"])).toBe(true);
  });

  test("requires every token to match", () => {
    expect(matchesSettingsSearchQuery("chat model", ["Default Chat Model"])).toBe(true);
    expect(matchesSettingsSearchQuery("chat model", ["Default Provider"])).toBe(false);
  });

  test("handles missing terms safely", () => {
    expect(matchesSettingsSearchQuery("chat", undefined)).toBe(false);
  });
});

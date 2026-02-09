import { CustomModel } from "@/aiParams";
import { filterModelsByQuery, isModelReorderEnabled } from "@/settings/v2/components/ModelTable";
import {
  filterCommandsByQuery,
  isCommandReorderEnabled,
} from "@/settings/v2/components/CommandSettings";
import { CustomCommand } from "@/commands/type";
import { ModelCapability } from "@/constants";

const MODELS: CustomModel[] = [
  {
    name: "gpt-4o",
    provider: "openai",
    enabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: "claude-sonnet",
    provider: "anthropic",
    enabled: true,
    capabilities: [ModelCapability.REASONING],
  },
];

const COMMANDS: CustomCommand[] = [
  {
    title: "Summarize Selection",
    content: "Summarize selected text",
    showInContextMenu: true,
    showInSlashMenu: false,
    order: 1,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Translate",
    content: "Translate to Japanese",
    showInContextMenu: false,
    showInSlashMenu: true,
    order: 2,
    modelKey: "",
    lastUsedMs: 0,
  },
];

describe("settings filtering helpers", () => {
  test("filters models by query text", () => {
    expect(filterModelsByQuery(MODELS, "claude")).toHaveLength(1);
    expect(filterModelsByQuery(MODELS, "vision")).toHaveLength(1);
    expect(filterModelsByQuery(MODELS, "nonexistent")).toHaveLength(0);
  });

  test("disables model reorder while filtering", () => {
    const onReorder = jest.fn();
    expect(isModelReorderEnabled("", onReorder)).toBe(true);
    expect(isModelReorderEnabled("claude", onReorder)).toBe(false);
    expect(isModelReorderEnabled("", undefined)).toBe(false);
  });

  test("filters commands by query text", () => {
    expect(filterCommandsByQuery(COMMANDS, "summarize")).toHaveLength(1);
    expect(filterCommandsByQuery(COMMANDS, "slash")).toHaveLength(1);
    expect(filterCommandsByQuery(COMMANDS, "selection slash")).toHaveLength(0);
  });

  test("disables command reorder while filtering", () => {
    expect(isCommandReorderEnabled(false)).toBe(true);
    expect(isCommandReorderEnabled(true)).toBe(false);
  });
});

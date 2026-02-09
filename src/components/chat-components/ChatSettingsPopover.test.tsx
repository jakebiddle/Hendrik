import { ChatSettingsPopover } from "@/components/chat-components/ChatSettingsPopover";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ChainType } from "@/chainFactory";

const mockUpdateSetting = jest.fn();
const mockOpenHendrikSettings = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    showRelevantNotes: true,
    autoAcceptEdits: false,
  })),
  updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}));

jest.mock("@/aiParams", () => ({
  useChainType: jest.fn(() => [ChainType.TOOL_CALLING_CHAIN]),
}));

jest.mock("@/system-prompts", () => ({
  getDefaultSystemPromptTitle: jest.fn(() => "Default"),
  getDisableBuiltinSystemPrompt: jest.fn(() => false),
  setDisableBuiltinSystemPrompt: jest.fn(),
  getPromptFilePath: jest.fn(() => "path/to/prompt.md"),
  useSystemPrompts: jest.fn(() => [{ title: "Default" }, { title: "Custom" }]),
  useSelectedPrompt: jest.fn(() => ["", jest.fn()]),
}));

jest.mock("@/system-prompts/state", () => ({
  useSessionChronicleMode: jest.fn(() => ["", jest.fn()]),
  getEffectiveChronicleMode: jest.fn(() => "none"),
}));

jest.mock("@/system-prompts/chronicleModes", () => ({
  CHRONICLE_MODE_NONE: "none",
  getChronicleModeMeta: jest.fn(() => null),
  getChronicleModesMeta: jest.fn(() => []),
}));

jest.mock("@/components/chat-components/chatActions", () => ({
  refreshVaultIndex: jest.fn(),
  forceReindexVault: jest.fn(),
  reloadCurrentProject: jest.fn(),
  forceRebuildCurrentProjectContext: jest.fn(),
}));

jest.mock("@/settings/v2/settingsNavigation", () => ({
  openHendrikSettings: (...args: unknown[]) => mockOpenHendrikSettings(...args),
}));

describe("ChatSettingsPopover", () => {
  beforeAll(() => {
    (globalThis as { activeDocument?: Document }).activeDocument = document;
  });

  beforeEach(() => {
    mockUpdateSetting.mockClear();
    mockOpenHendrikSettings.mockClear();
  });

  test("opens deep-link settings actions", () => {
    render(<ChatSettingsPopover />);

    fireEvent.click(screen.getByTitle("Settings"));
    fireEvent.click(screen.getByText("Open AI Settings"));

    expect(mockOpenHendrikSettings).toHaveBeenCalledWith("ai");
  });

  test("updates quick toggle settings", () => {
    render(<ChatSettingsPopover />);

    fireEvent.click(screen.getByTitle("Settings"));
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]);

    expect(mockUpdateSetting).toHaveBeenCalled();
  });
});

import { ChatModelProviders } from "@/constants";
import { isLegacyCopilotPlusModelIdentifier, parseModelsResponse } from "@/settings/providerModels";

describe("isLegacyCopilotPlusModelIdentifier", () => {
  it("matches removed Copilot Plus variants across common id/name formats", () => {
    expect(isLegacyCopilotPlusModelIdentifier("Copilot Plus Flash")).toBe(true);
    expect(isLegacyCopilotPlusModelIdentifier("copilot-plus-small")).toBe(true);
    expect(isLegacyCopilotPlusModelIdentifier("copilot_plus_large")).toBe(true);
    expect(isLegacyCopilotPlusModelIdentifier("Copilot Plus Mulitlingual")).toBe(true);
    expect(isLegacyCopilotPlusModelIdentifier("Copilot Plus Multilingual")).toBe(true);
    expect(isLegacyCopilotPlusModelIdentifier("gpt-4o")).toBe(false);
  });
});

describe("parseModelsResponse - GitHub Copilot", () => {
  it("filters removed legacy Copilot Plus variants from parsed model list", () => {
    const parsed = parseModelsResponse(ChatModelProviders.GITHUB_COPILOT, {
      object: "list",
      data: [
        {
          id: "copilot-plus-flash",
          name: "Copilot Plus Flash",
          version: "copilot-plus-flash",
          object: "model",
        },
        {
          id: "copilot-plus-small",
          name: "Copilot Plus Small",
          version: "copilot-plus-small",
          object: "model",
        },
        {
          id: "copilot-plus-large",
          name: "Copilot Plus Large",
          version: "copilot-plus-large",
          object: "model",
        },
        {
          id: "copilot-plus-mulitlingual",
          name: "Copilot Plus Mulitlingual",
          version: "copilot-plus-mulitlingual",
          object: "model",
        },
        {
          id: "copilot-plus-multilingual",
          name: "Copilot Plus Multilingual",
          version: "copilot-plus-multilingual",
          object: "model",
        },
        {
          id: "legacy-hidden-id",
          name: "Copilot Plus Flash",
          version: "legacy-hidden-id",
          object: "model",
        },
        {
          id: "gpt-4o",
          name: "GPT-4o",
          version: "gpt-4o-2024-11-20",
          object: "model",
        },
      ],
    });

    expect(parsed).toEqual([
      {
        id: "gpt-4o",
        name: "gpt-4o",
        provider: ChatModelProviders.GITHUB_COPILOT,
      },
    ]);
  });
});

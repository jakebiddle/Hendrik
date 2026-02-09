import { ChainType } from "@/chainFactory";
import { ModeRibbon } from "@/components/chat-components/ModeRibbon";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("ModeRibbon", () => {
  test("marks Agent active outside project mode", () => {
    render(
      <ModeRibbon
        selectedChain={ChainType.TOOL_CALLING_CHAIN}
        onSelectAgent={jest.fn()}
        onSelectProjects={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Agent" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Projects" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
  });

  test("marks Projects active in project mode", () => {
    render(
      <ModeRibbon
        selectedChain={ChainType.PROJECT_CHAIN}
        onSelectAgent={jest.fn()}
        onSelectProjects={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Agent" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(screen.getByRole("button", { name: "Projects" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  test("fires callbacks on selection", () => {
    const onSelectAgent = jest.fn();
    const onSelectProjects = jest.fn();

    render(
      <ModeRibbon
        selectedChain={ChainType.TOOL_CALLING_CHAIN}
        onSelectAgent={onSelectAgent}
        onSelectProjects={onSelectProjects}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(onSelectProjects).toHaveBeenCalledTimes(1);
    expect(onSelectAgent).toHaveBeenCalledTimes(1);
  });
});

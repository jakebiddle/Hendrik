import React from "react";
import { render, screen } from "@testing-library/react";
import { TabProvider, useTab } from "@/contexts/TabContext";

const Probe: React.FC = () => {
  const { selectedTab } = useTab();
  return <div data-testid="tab-value">{selectedTab}</div>;
};

describe("TabContext", () => {
  test("uses provided initial tab", () => {
    render(
      <TabProvider initialTab="search">
        <Probe />
      </TabProvider>
    );

    expect(screen.getByTestId("tab-value").textContent).toBe("search");
  });
});

import { RelevantNoteRow } from "@/components/chat-components/RelevantNotes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("RelevantNoteRow entity evidence badges", () => {
  beforeEach(() => {
    (global as any).activeDocument = document;
  });

  const baseNote = {
    document: {
      path: "Chronicle/Arin.md",
      title: "Arin",
    },
    metadata: {
      score: 0.92,
      similarityScore: 0.91,
      hasOutgoingLinks: true,
      hasBacklinks: true,
      entityEvidence: {
        relationTypes: ["wiki_link", "backlink"],
        relationCount: 2,
      },
    },
  };

  it("renders compact entity badges and signal counts when enabled", () => {
    render(
      <TooltipProvider>
        <RelevantNoteRow
          note={baseNote}
          showEntityEvidence={true}
          onAddToChat={jest.fn()}
          onNavigateToNote={jest.fn()}
        />
      </TooltipProvider>
    );

    expect(screen.getByText("wiki_link")).not.toBeNull();
    expect(screen.getByText("backlink")).not.toBeNull();
    expect(screen.getByText("2 graph signals")).not.toBeNull();
  });

  it("hides entity evidence badges when panel setting is disabled", () => {
    render(
      <TooltipProvider>
        <RelevantNoteRow
          note={baseNote}
          showEntityEvidence={false}
          onAddToChat={jest.fn()}
          onNavigateToNote={jest.fn()}
        />
      </TooltipProvider>
    );

    expect(screen.queryByText("wiki_link")).toBeNull();
    expect(screen.queryByText("backlink")).toBeNull();
    expect(screen.queryByText("2 graph signals")).toBeNull();
  });
});

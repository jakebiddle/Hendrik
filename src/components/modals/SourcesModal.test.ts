import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import {
  buildExplanationDetails,
  buildRankedRows,
  normalizeSourceDisplay,
  SourcesModalContent,
} from "@/components/modals/SourcesModal";

const getSettingsMock = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => getSettingsMock(),
}));

describe("SourcesModal entity evidence details", () => {
  beforeEach(() => {
    getSettingsMock.mockReturnValue({
      enableEntityEvidencePanel: true,
    });
  });

  it("includes entity graph detail lines when evidence panel is enabled", () => {
    const details = buildExplanationDetails({
      entityGraph: {
        matchedEntities: ["Arin", "Valoria"],
        relationTypes: ["wiki_link", "frontmatter_reference"],
        hopDepth: 2,
        evidenceCount: 3,
        relationPaths: [
          "Arin --wiki_link--> Valoria",
          "Valoria --frontmatter_reference--> Sunhold",
        ],
        evidenceRefs: [
          {
            path: "Chronicle/Arin.md",
            chunkId: "Chronicle/Arin.md#2",
            extractor: "wiki_link",
          },
        ],
        scoreContribution: 0.88,
      },
      baseScore: 0.3,
      finalScore: 0.5,
    });

    expect(details.some((detail) => detail.startsWith("Entity graph: hop 2"))).toBe(true);
    expect(
      details.some((detail) => detail.includes("relations: wiki_link, frontmatter_reference"))
    ).toBe(true);
    expect(details.some((detail) => detail.startsWith("Path: Arin --wiki_link--> Valoria"))).toBe(
      true
    );
    expect(
      details.some((detail) => detail.startsWith("Evidence: Chronicle/Arin.md#2 (wiki_link)"))
    ).toBe(true);
  });

  it("hides entity graph details when evidence panel is disabled", () => {
    getSettingsMock.mockReturnValue({
      enableEntityEvidencePanel: false,
    });

    const details = buildExplanationDetails({
      entityGraph: {
        matchedEntities: ["Arin"],
        relationTypes: ["wiki_link"],
        hopDepth: 1,
        evidenceCount: 1,
        relationPaths: ["Arin --wiki_link--> Valoria"],
        evidenceRefs: [
          {
            path: "Chronicle/Arin.md",
            chunkId: "Chronicle/Arin.md#1",
            extractor: "wiki_link",
          },
        ],
        scoreContribution: 0.9,
      },
      baseScore: 0.4,
      finalScore: 0.6,
    });

    expect(details.some((detail) => detail.startsWith("Entity graph:"))).toBe(false);
    expect(details.some((detail) => detail.startsWith("Path:"))).toBe(false);
    expect(details.some((detail) => detail.startsWith("Evidence:"))).toBe(false);
  });

  it("normalizes composite title/path strings for readable source rows", () => {
    const row = normalizeSourceDisplay({
      title: "Lady Maren Driftmar (Canon Lore/6F. House Veyre Dossiers/6F-12. Dossier.md)",
      path: "",
      score: 0.5,
    });

    expect(row.displayTitle).toBe("Lady Maren Driftmar");
    expect(row.displayPath).toBe("Canon Lore/6F. House Veyre Dossiers/6F-12. Dossier.md");
    expect(row.openPath).toBe("Canon Lore/6F. House Veyre Dossiers/6F-12. Dossier.md");
  });

  it("uses basename as title when source title equals full path", () => {
    const row = normalizeSourceDisplay({
      title: "Canon Lore/4C-04-06. Driftmar.md",
      path: "Canon Lore/4C-04-06. Driftmar.md",
      score: 0.4,
    });

    expect(row.displayTitle).toBe("4C-04-06. Driftmar.md");
    expect(row.displayPath).toBe("Canon Lore/4C-04-06. Driftmar.md");
  });

  it("ranks sources by numeric score and assigns rank labels", () => {
    const rows = buildRankedRows([
      { title: "A", path: "A.md", score: 0.4 },
      { title: "B", path: "B.md", score: 0.8 },
      { title: "C", path: "C.md", score: 0.6 },
    ]);

    expect(rows.map((row) => row.displayTitle)).toEqual(["B", "C", "A"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(rows[0].scoreLabel).toBe("0.8000");
    expect(rows[0].relativeScore).toBe(1);
  });

  it("falls back to retrieval order when scores are unavailable", () => {
    const rows = buildRankedRows([
      { title: "A", path: "A.md", score: Number.NaN },
      { title: "B", path: "B.md", score: Number.NaN },
    ]);

    expect(rows.map((row) => row.displayTitle)).toEqual(["A", "B"]);
    expect(rows.every((row) => row.scoreLabel === "n/a")).toBe(true);
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
  });

  it("renders long source paths in the dedicated truncation element", () => {
    const longPath =
      "Canon Lore/0. Index & Meta/0A. Master Index/This/Is/A/Very/Long/Path/That/Needs/Truncation/On/Narrow/Layouts/0A. Master Index.md";
    const app = {
      workspace: {
        openLinkText: jest.fn(),
      },
    } as unknown as App;

    const { container } = render(
      React.createElement(SourcesModalContent, {
        app,
        sources: [
          {
            title: "0A. Master Index",
            path: longPath,
            score: 0.77,
          },
        ],
      })
    );

    const pathElement = container.querySelector(".hendrik-sources-modal__item-path");
    expect(pathElement).not.toBeNull();
    if (!pathElement) {
      throw new Error("Expected source path element to be present");
    }

    expect(pathElement.classList.contains("hendrik-sources-modal__item-path")).toBe(true);
    expect(pathElement.getAttribute("title")).toBe(longPath);
    expect(pathElement.textContent).toContain(longPath);
  });

  it("renders expanded details with wrap-enforced list item class", () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
      },
    } as unknown as App;

    const { container } = render(
      React.createElement(SourcesModalContent, {
        app,
        sources: [
          {
            title: "6A-01. Dossier of His Grace",
            path: "Canon Lore/6A. House Rhaedryn Dossiers/6A-01.md",
            score: 0.92,
            explanation: {
              lexicalMatches: [{ field: "content", query: "Rhaedryn" }],
              baseScore: 0.4,
              finalScore: 0.6,
            },
          },
        ],
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    const detailItems = container.querySelectorAll(".hendrik-sources-modal__item-detail");
    expect(detailItems.length).toBeGreaterThan(0);
    expect(
      Array.from(detailItems).every((item) =>
        item.classList.contains("hendrik-sources-modal__item-detail")
      )
    ).toBe(true);
    expect(detailItems[0].textContent).toContain("Source path:");
  });
});

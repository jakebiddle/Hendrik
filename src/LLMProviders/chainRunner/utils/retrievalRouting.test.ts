import {
  buildForcedLocalSearchCall,
  evaluateLocalSearchStrength,
  extractFindTitleSources,
  extractReadNoteSources,
  isExplicitReadIntent,
  normalizeLocalSearchArgs,
  pickBestFallbackPath,
  shouldForceRetrievalFirstRouting,
} from "./retrievalRouting";

const getSettingsMock = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => getSettingsMock(),
}));

describe("retrievalRouting helpers", () => {
  beforeEach(() => {
    getSettingsMock.mockReturnValue({
      qaExclusions: "hendrik,Obsidian%20Files",
    });
  });

  it("detects explicit read intent", () => {
    expect(isExplicitReadIntent("read [[4C-04-06. Driftmar]]")).toBe(true);
    expect(isExplicitReadIntent("open Canon Lore/Foo/Bar.md")).toBe(true);
    expect(isExplicitReadIntent("who is the lord of driftmar")).toBe(false);
  });

  it("forces retrieval-first for lore q&a and skips explicit reads", () => {
    expect(shouldForceRetrievalFirstRouting("who is the lord of driftmar")).toBe(true);
    expect(shouldForceRetrievalFirstRouting("read [[4C-04-06. Driftmar]]")).toBe(false);
    expect(shouldForceRetrievalFirstRouting("search the web for driftmar")).toBe(false);
  });

  it("builds deterministic forced localSearch call", () => {
    const forced = buildForcedLocalSearchCall("who is aenar", ["aenar"]);

    expect(forced.toolName).toBe("localSearch");
    expect(forced.args.query).toBe("who is aenar");
    expect(forced.args.salientTerms).toEqual(expect.arrayContaining(["aenar"]));
  });

  it("compacts instruction-heavy forced localSearch queries", () => {
    const prompt =
      'Analyze the vault and generate semantic worldbuilding relation proposals. Use available retrieval tools as needed. When done, call submitSemanticRelationProposals using object args with the shape: {"proposals":[...]}.';

    const forced = buildForcedLocalSearchCall(prompt, ["Analyze", "the", "vault", "and"]);
    expect(forced.args.query).toBe(
      "Analyze the vault and generate semantic worldbuilding relation proposals."
    );
    expect(forced.args.query.length).toBeLessThan(prompt.length);
    expect(forced.args.salientTerms.length).toBeGreaterThan(0);
  });

  it("normalizes invalid localSearch args using fallback query", () => {
    const normalized = normalizeLocalSearchArgs(
      {
        query: "",
        salientTerms: "not-an-array",
      } as any,
      "who is the lord of driftmar"
    );

    expect(normalized.query).toBe("who is the lord of driftmar");
    expect(Array.isArray(normalized.salientTerms)).toBe(true);
    expect(normalized.salientTerms.length).toBeGreaterThan(0);
  });

  it("filters object artifacts from localSearch args", () => {
    const normalized = normalizeLocalSearchArgs(
      {
        query: "[object Object] use retrieval",
        salientTerms: ["[object Object]", "valid-term"],
      },
      "fallback retrieval prompt"
    );

    expect(normalized.query).not.toContain("[object Object]");
    expect(normalized.salientTerms).toContain("valid-term");
    expect(normalized.salientTerms).not.toContain("[object Object]");
  });

  it("marks localSearch payload weak when no includable docs or low score", () => {
    const noDocs = evaluateLocalSearchStrength({
      type: "local_search",
      documents: [{ includeInContext: false, score: 0.9 }],
    });
    expect(noDocs.hasContextDocs).toBe(false);
    expect(noDocs.isWeak).toBe(true);

    const lowScore = evaluateLocalSearchStrength({
      type: "local_search",
      documents: [{ includeInContext: true, score: 0.2 }],
    });
    expect(lowScore.hasContextDocs).toBe(true);
    expect(lowScore.topScore).toBe(0.2);
    expect(lowScore.isWeak).toBe(true);

    const strong = evaluateLocalSearchStrength({
      type: "local_search",
      documents: [{ includeInContext: true, score: 0.72 }],
    });
    expect(strong.hasContextDocs).toBe(true);
    expect(strong.topScore).toBe(0.72);
    expect(strong.isWeak).toBe(false);
  });

  it("normalizes findNotesByTitle and readNote sources with tool evidence", () => {
    const titleSources = extractFindTitleSources({
      type: "title_search",
      query: "driftmar",
      results: [
        {
          path: "Canon Lore/4C-04-06. Driftmar.md",
          title: "4C-04-06. Driftmar",
          score: 0.9,
        },
      ],
    });
    expect(titleSources[0].path).toContain("4C-04-06. Driftmar.md");
    expect((titleSources[0].explanation as any)?.toolEvidence?.tool).toBe("findNotesByTitle");

    const readSources = extractReadNoteSources({
      notePath: "Canon Lore/4C-04-06. Driftmar.md",
      noteTitle: "4C-04-06. Driftmar",
      chunkId: "Canon Lore/4C-04-06. Driftmar.md#L1-120",
      content: "Example",
    });
    expect(readSources).toHaveLength(1);
    expect((readSources[0].explanation as any)?.toolEvidence?.tool).toBe("readNote");
    expect((readSources[0].explanation as any)?.toolEvidence?.chunkId).toContain("#L1-120");
  });

  it("picks best markdown fallback path and excludes conversation/system paths", () => {
    const picked = pickBestFallbackPath({
      type: "title_search",
      query: "driftmar",
      results: [
        {
          path: "Obsidian Files/hendrik/hendrik-conversations/who_is_the_lord_of_driftmar.md",
          title: "Conversation",
          extension: "md",
          score: 1,
        },
        {
          path: "Canon Lore/4. Volume IV/4C-04-06. Driftmar.md",
          title: "4C-04-06. Driftmar",
          extension: "md",
          score: 0.8,
        },
      ],
    });

    expect(picked).toBe("Canon Lore/4. Volume IV/4C-04-06. Driftmar.md");
  });
});

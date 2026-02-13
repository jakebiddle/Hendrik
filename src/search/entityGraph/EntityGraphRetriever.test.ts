import { Document } from "@langchain/core/documents";
import { TFile } from "obsidian";
import { EntityGraphIndexManager } from "./EntityGraphIndexManager";
import { EntityGraphRetriever } from "./EntityGraphRetriever";
import { EntityGraphExpansionHit, ResolvedEntity } from "./types";

jest.mock("@/logger");

const getSettingsMock = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => getSettingsMock(),
}));

jest.mock("./EntityGraphIndexManager");

/**
 * Creates a mock markdown file compatible with instanceof checks.
 *
 * @param path - Vault-relative path.
 * @returns Mocked TFile.
 */
function createMockFile(path: string): TFile {
  const file = new (TFile as any)(path);
  Object.setPrototypeOf(file, (TFile as any).prototype);
  (file as any).path = path;
  (file as any).extension = "md";
  (file as any).basename = path.split("/").pop()?.replace(/\.md$/i, "") || path;
  (file as any).stat = { mtime: 1000, ctime: 1000 };
  return file as TFile;
}

describe("EntityGraphRetriever", () => {
  let indexManagerMock: {
    resolveEntities: jest.Mock<Promise<ResolvedEntity[]>, [string]>;
    expandFromResolvedEntities: jest.Mock<
      EntityGraphExpansionHit[],
      [ResolvedEntity[], number, number]
    >;
  };

  let appMock: any;
  let chunkManagerMock: any;

  beforeEach(() => {
    indexManagerMock = {
      resolveEntities: jest.fn(),
      expandFromResolvedEntities: jest.fn(),
    };

    (EntityGraphIndexManager.getInstance as jest.Mock).mockReturnValue(indexManagerMock);

    appMock = {
      vault: {
        getAbstractFileByPath: jest.fn(),
        cachedRead: jest.fn(),
      },
    };

    chunkManagerMock = {
      getChunks: jest.fn(),
    };

    getSettingsMock.mockReturnValue({
      enableEntityGraphRetrieval: true,
      entityGraphMaxHops: 2,
      entityGraphMaxExpandedDocs: 12,
      debug: false,
    });
  });

  it("returns base documents unchanged when entity graph retrieval is disabled", async () => {
    getSettingsMock.mockReturnValue({
      enableEntityGraphRetrieval: false,
      entityGraphMaxHops: 2,
      entityGraphMaxExpandedDocs: 12,
      debug: false,
    });

    const retriever = new EntityGraphRetriever(appMock, chunkManagerMock);
    const baseDocuments = [
      new Document({
        pageContent: "Base content",
        metadata: { path: "Lore/Base.md", score: 0.9 },
      }),
    ];

    const result = await retriever.augmentDocuments("Valoria", baseDocuments, {
      maxHops: 2,
      maxExpandedDocs: 10,
    });

    expect(result.documents).toBe(baseDocuments);
    expect(result.entityQueryMode).toBe(false);
    expect(result.hasEntityEvidence).toBe(false);
    expect(result.resolvedEntities).toEqual([]);
  });

  it("keeps entity mode off when query does not resolve to canonical entities", async () => {
    indexManagerMock.resolveEntities.mockResolvedValue([]);

    const retriever = new EntityGraphRetriever(appMock, chunkManagerMock);
    const baseDocuments = [
      new Document({
        pageContent: "Base content",
        metadata: { path: "Lore/Base.md", score: 0.9 },
      }),
    ];

    const result = await retriever.augmentDocuments("unknown fragment", baseDocuments, {
      maxHops: 2,
      maxExpandedDocs: 10,
    });

    expect(indexManagerMock.resolveEntities).toHaveBeenCalledWith("unknown fragment");
    expect(result.documents).toEqual(baseDocuments);
    expect(result.entityQueryMode).toBe(false);
    expect(result.hasEntityEvidence).toBe(false);
  });

  it("augments lexical docs with graph evidence while deduping and preserving score order", async () => {
    const resolvedEntities: ResolvedEntity[] = [
      {
        entityId: "World/Valoria.md",
        canonicalName: "Valoria",
        matchedAlias: "valoria",
        score: 20,
      },
    ];

    const expansionHits: EntityGraphExpansionHit[] = [
      {
        path: "World/Valoria.md",
        title: "Valoria",
        score: 0.8,
        explanation: {
          matchedEntities: ["Valoria"],
          relationTypes: ["wiki_link"],
          hopDepth: 1,
          evidenceCount: 2,
          relationPaths: ["Valoria --wiki_link--> Valoria"],
          evidenceRefs: [
            {
              path: "World/Valoria.md",
              chunkId: "World/Valoria.md#0",
              mtime: 1000,
              extractor: "wiki_link",
            },
          ],
          scoreContribution: 0.8,
        },
      },
      {
        path: "Places/Sunhold.md",
        title: "Sunhold",
        score: 0.95,
        explanation: {
          matchedEntities: ["Valoria"],
          relationTypes: ["frontmatter_reference"],
          hopDepth: 1,
          evidenceCount: 1,
          relationPaths: ["Valoria --frontmatter_reference--> Sunhold"],
          evidenceRefs: [
            {
              path: "World/Valoria.md",
              chunkId: "World/Valoria.md#0",
              mtime: 1000,
              extractor: "frontmatter_reference",
            },
          ],
          scoreContribution: 0.95,
        },
      },
    ];

    indexManagerMock.resolveEntities.mockResolvedValue(resolvedEntities);
    indexManagerMock.expandFromResolvedEntities.mockReturnValue(expansionHits);

    appMock.vault.getAbstractFileByPath.mockImplementation((path: string) => {
      if (path === "World/Valoria.md" || path === "Places/Sunhold.md") {
        return createMockFile(path);
      }
      return null;
    });

    chunkManagerMock.getChunks.mockImplementation(async (paths: string[]) => {
      const path = paths[0];
      if (path === "World/Valoria.md") {
        return [{ id: "World/Valoria.md#0", content: "Graph valoria chunk" }];
      }
      if (path === "Places/Sunhold.md") {
        return [{ id: "Places/Sunhold.md#0", content: "Graph sunhold chunk" }];
      }
      return [];
    });

    const baseDocuments = [
      new Document({
        pageContent: "Base valoria chunk",
        metadata: {
          path: "World/Valoria.md",
          chunkId: "World/Valoria.md#0",
          score: 1.1,
          rerank_score: 1.1,
          explanation: {
            lexicalMatches: [{ field: "title", query: "Valoria", weight: 2 }],
          },
        },
      }),
      new Document({
        pageContent: "Base governance chunk",
        metadata: {
          path: "Lore/Governance.md",
          chunkId: "Lore/Governance.md#2",
          score: 0.4,
          rerank_score: 0.4,
        },
      }),
    ];

    const retriever = new EntityGraphRetriever(appMock, chunkManagerMock);
    const result = await retriever.augmentDocuments("Tell me about Valoria", baseDocuments, {
      maxHops: 2,
      maxExpandedDocs: 12,
    });

    expect(indexManagerMock.expandFromResolvedEntities).toHaveBeenCalledWith(
      resolvedEntities,
      2,
      12
    );
    expect(result.entityQueryMode).toBe(true);
    expect(result.hasEntityEvidence).toBe(true);
    expect(result.resolvedEntities).toEqual(resolvedEntities);

    const pathsInOrder = result.documents.map((doc) => doc.metadata.path);
    expect(pathsInOrder).toEqual(["World/Valoria.md", "Places/Sunhold.md", "Lore/Governance.md"]);

    const valoriaDoc = result.documents.find(
      (doc) => doc.metadata.path === "World/Valoria.md"
    ) as Document;
    expect(valoriaDoc.metadata.score).toBe(1.1);
    expect(valoriaDoc.metadata.entityQueryMode).toBe(true);
    expect(valoriaDoc.metadata.entityEvidence).toBe(true);
    expect(valoriaDoc.metadata.matchedEntities).toEqual(["Valoria"]);
    expect((valoriaDoc.metadata.explanation as any).entityGraph).toBeDefined();
  });
});

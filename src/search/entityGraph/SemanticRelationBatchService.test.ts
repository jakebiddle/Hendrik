import { TFile } from "obsidian";
import { SemanticRelationBatchService } from "./SemanticRelationBatchService";

jest.mock("@/logger");

const getSettingsMock = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => getSettingsMock(),
}));

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(() => ({ inclusions: null, exclusions: null })),
  shouldIndexFile: jest.fn(() => true),
}));

/**
 * Creates a TFile instance compatible with instanceof checks.
 */
function createMockFile(path: string): TFile {
  const file = new (TFile as any)(path);
  Object.setPrototypeOf(file, (TFile as any).prototype);
  (file as any).path = path;
  (file as any).basename = path.split("/").pop()?.replace(/\.md$/i, "") || path;
  (file as any).extension = "md";
  return file as TFile;
}

describe("SemanticRelationBatchService", () => {
  beforeEach(() => {
    getSettingsMock.mockReturnValue({
      semanticEntityRelationFields: ["relations"],
      semanticEntityMinConfidence: 70,
      semanticEntityBatchSize: 2,
    });
  });

  it("builds editable draft batches from canonical and convenience relation fields", async () => {
    const arin = createMockFile("Characters/Arin.md");
    const lira = createMockFile("Characters/Lira.md");
    const marek = createMockFile("Characters/Marek.md");

    const fileCacheByPath = new Map<string, Record<string, unknown>>([
      [
        arin.path,
        {
          frontmatter: {
            relations: [
              { predicate: "allied_with", target: "[[Characters/Lira]]", confidence: 0.8 },
            ],
            rivalOf: "[[Characters/Marek]]",
          },
        },
      ],
      [lira.path, { frontmatter: {} }],
      [marek.path, { frontmatter: {} }],
    ]);

    const app: any = {
      vault: {
        getMarkdownFiles: jest.fn(() => [arin, lira, marek]),
      },
      metadataCache: {
        getFileCache: jest.fn((file: TFile) => fileCacheByPath.get(file.path) || null),
        getFirstLinkpathDest: jest.fn((link: string) => {
          const normalized = link
            .replace(/\[\[|\]\]/g, "")
            .split("|")[0]
            .trim();
          const candidate = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
          return [arin, lira, marek].find((file) => file.path === candidate) || null;
        }),
      },
      fileManager: {
        processFrontMatter: jest.fn(),
      },
    };

    const service = new SemanticRelationBatchService(app);
    const batches = await service.buildDraftBatches();

    expect(batches.length).toBe(1);
    expect(batches[0].rows.length).toBe(2);
    expect(batches[0].rows.some((row) => row.predicate === "allied_with")).toBe(true);
    expect(batches[0].rows.some((row) => row.predicate === "rival_of")).toBe(true);
    expect(batches[0].rows.every((row) => row.proposalSource === "vault-frontmatter")).toBe(true);
  });

  it("resolves plain note-title targets from frontmatter relation fields", async () => {
    const arin = createMockFile("Characters/Arin.md");
    const lira = createMockFile("Characters/Lira.md");

    const fileCacheByPath = new Map<string, Record<string, unknown>>([
      [
        arin.path,
        {
          frontmatter: {
            relations: [{ predicate: "allied_with", target: "Lira" }],
          },
        },
      ],
      [lira.path, { frontmatter: {} }],
    ]);

    const app: any = {
      vault: {
        getMarkdownFiles: jest.fn(() => [arin, lira]),
      },
      metadataCache: {
        getFileCache: jest.fn((file: TFile) => fileCacheByPath.get(file.path) || null),
        getFirstLinkpathDest: jest.fn((link: string) => {
          const normalized = link
            .replace(/\[\[|\]\]/g, "")
            .split("|")[0]
            .trim();
          const candidate = normalized.endsWith(".md") ? normalized : `${normalized}.md`;

          if (candidate === "Characters/Lira.md" || candidate === "Lira.md") {
            return lira;
          }
          if (candidate === "Characters/Arin.md" || candidate === "Arin.md") {
            return arin;
          }
          return null;
        }),
      },
      fileManager: {
        processFrontMatter: jest.fn(),
      },
    };

    const service = new SemanticRelationBatchService(app);
    const batches = await service.buildDraftBatches();

    expect(batches).toHaveLength(1);
    expect(batches[0].rows).toHaveLength(1);
    expect(batches[0].rows[0].targetPath).toBe("Characters/Lira.md");
  });

  it("applies edited batch rows into canonical relation frontmatter field", async () => {
    const arin = createMockFile("Characters/Arin.md");
    const frontmatterState: Record<string, unknown> = {
      relations: [{ predicate: "allied_with", target: "[[Characters/Lira]]", confidence: 80 }],
    };

    const app: any = {
      vault: {
        getAbstractFileByPath: jest.fn((path: string) => (path === arin.path ? arin : null)),
        getMarkdownFiles: jest.fn(() => [arin]),
      },
      metadataCache: {
        getFileCache: jest.fn(() => ({ frontmatter: frontmatterState })),
        getFirstLinkpathDest: jest.fn((link: string) => {
          const normalized = link
            .replace(/\[\[|\]\]/g, "")
            .split("|")[0]
            .trim();
          const candidate = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
          return candidate === arin.path ? arin : createMockFile(candidate);
        }),
      },
      fileManager: {
        processFrontMatter: jest.fn(
          async (_file: TFile, updater: (frontmatter: Record<string, unknown>) => void) => {
            updater(frontmatterState);
          }
        ),
      },
    };

    const service = new SemanticRelationBatchService(app);
    const result = await service.applyEditedBatch([
      {
        id: "1",
        notePath: "Characters/Arin.md",
        sourceField: "relations",
        predicate: "rival_of",
        targetPath: "Characters/Marek.md",
        confidence: 72,
      },
    ]);

    expect(result.updatedNotes).toBe(1);
    expect(result.writtenRelations).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.rowResults.some((row) => row.status === "applied")).toBe(true);

    const relations = frontmatterState.relations as Array<Record<string, unknown>>;
    expect(relations.some((relation) => relation.predicate === "allied_with")).toBe(true);
    expect(relations.some((relation) => relation.predicate === "rival_of")).toBe(true);
  });

  it("reports skipped rows with reasons during batch apply", async () => {
    const app: any = {
      vault: {
        getAbstractFileByPath: jest.fn(() => null),
        getMarkdownFiles: jest.fn(() => []),
      },
      metadataCache: {
        getFileCache: jest.fn(() => null),
        getFirstLinkpathDest: jest.fn(() => null),
      },
      fileManager: {
        processFrontMatter: jest.fn(),
      },
    };

    const service = new SemanticRelationBatchService(app);
    const result = await service.applyEditedBatch([
      {
        id: "invalid-row",
        notePath: "",
        sourceField: "relations",
        predicate: "allied_with",
        targetPath: "",
        confidence: 150,
      },
    ]);

    expect(result.skippedRows).toBe(1);
    expect(result.rowResults).toHaveLength(1);
    expect(result.rowResults[0].status).toBe("skipped");
    expect(result.rowResults[0].reason).toContain("Missing required fields");
  });

  it("injects AI proposal adapter rows directly into editable batches", async () => {
    const arin = createMockFile("Characters/Arin.md");
    const lira = createMockFile("Characters/Lira.md");
    const marek = createMockFile("Characters/Marek.md");

    const app: any = {
      vault: {
        getMarkdownFiles: jest.fn(() => [arin, lira, marek]),
      },
      metadataCache: {
        getFileCache: jest.fn(() => ({ frontmatter: {} })),
        getFirstLinkpathDest: jest.fn((link: string) => {
          const normalized = link
            .replace(/\[\[|\]\]/g, "")
            .split("|")[0]
            .split("#")[0]
            .trim();
          const candidate = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
          return [arin, lira, marek].find((file) => file.path === candidate) || null;
        }),
      },
      fileManager: {
        processFrontMatter: jest.fn(),
      },
    };

    const service = new SemanticRelationBatchService(app);
    const adapter = {
      id: "ai-pass-1",
      getProposals: jest.fn(async () => [
        {
          notePath: "Characters/Arin.md",
          predicate: "ally",
          targetPath: "[[Characters/Lira]]",
          confidence: 0.83,
        },
        {
          notePath: "Characters/Arin",
          predicate: "rival_of",
          targetPath: "Characters/Marek",
        },
      ]),
    };

    const batches = await service.buildDraftBatches({
      includeVaultDrafts: false,
      proposalAdapters: [adapter],
    });

    expect(adapter.getProposals).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1);
    expect(batches[0].rows).toHaveLength(2);
    expect(batches[0].rows.some((row) => row.predicate === "allied_with")).toBe(true);
    expect(batches[0].rows.some((row) => row.predicate === "rival_of")).toBe(true);
    expect(batches[0].rows.every((row) => row.sourceField === "adapter:ai-pass-1")).toBe(true);
    expect(batches[0].rows.every((row) => row.proposalSource === "ai-pass-1")).toBe(true);
  });
});

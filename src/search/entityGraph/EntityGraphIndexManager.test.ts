import { TFile } from "obsidian";
import { EntityGraphIndexManager } from "./EntityGraphIndexManager";

jest.mock("@/logger");

const getSettingsMock = jest.fn();
const subscribeToSettingsChangeMock = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => getSettingsMock(),
  subscribeToSettingsChange: (...args: unknown[]) => subscribeToSettingsChangeMock(...args),
}));

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(() => ({ inclusions: null, exclusions: null })),
  shouldIndexFile: jest.fn(() => true),
}));

type VaultEventName = "modify" | "create" | "rename" | "delete";

interface FileCacheShape {
  links?: Array<{ link: string; displayText?: string }>;
  tags?: Array<{ tag: string }>;
  headings?: Array<{ heading: string }>;
  frontmatter?: Record<string, unknown>;
}

/**
 * Creates a TFile mock that passes instanceof checks.
 *
 * @param path - Vault-relative markdown path.
 * @param mtime - Modification timestamp.
 * @returns Mock TFile with populated metadata.
 */
function createMockFile(path: string, mtime: number): TFile {
  const file = new (TFile as any)(path);
  Object.setPrototypeOf(file, (TFile as any).prototype);
  (file as any).path = path;
  (file as any).extension = "md";
  (file as any).basename = path.split("/").pop()?.replace(/\.md$/i, "") || path;
  (file as any).stat = { mtime, ctime: mtime };
  return file as TFile;
}

/**
 * Builds a deterministic app harness with in-memory files, caches, and vault listeners.
 */
function createEntityGraphHarness() {
  const filesByPath = new Map<string, TFile>();
  const cachesByPath = new Map<string, FileCacheShape>();
  const listenerMap = new Map<VaultEventName, (...args: unknown[]) => void>();

  /**
   * Resolves Obsidian-style links to mock files.
   *
   * @param rawLink - Raw link candidate from metadata cache.
   * @returns Resolved TFile or null.
   */
  const resolveLink = (rawLink: string): TFile | null => {
    const cleaned = String(rawLink || "")
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .split("|")[0]
      .split("#")[0]
      .trim();

    if (!cleaned) {
      return null;
    }

    const direct = filesByPath.get(cleaned);
    if (direct) {
      return direct;
    }

    const withMarkdown = cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
    const markdownPath = filesByPath.get(withMarkdown);
    if (markdownPath) {
      return markdownPath;
    }

    const byBasename = Array.from(filesByPath.values()).find(
      (file) => file.basename.toLowerCase() === cleaned.toLowerCase()
    );
    return byBasename || null;
  };

  const app: any = {
    vault: {
      on: jest.fn((eventName: VaultEventName, callback: (...args: unknown[]) => void) => {
        listenerMap.set(eventName, callback);
      }),
      getMarkdownFiles: jest.fn(() => Array.from(filesByPath.values())),
      getAbstractFileByPath: jest.fn((path: string) => filesByPath.get(path) || null),
    },
    metadataCache: {
      getFileCache: jest.fn((file: TFile) => cachesByPath.get(file.path) || null),
      getFirstLinkpathDest: jest.fn((link: string) => resolveLink(link)),
    },
  };

  /**
   * Upserts a markdown file and corresponding metadata cache.
   *
   * @param path - Vault-relative file path.
   * @param mtime - Modification timestamp.
   * @param cache - Metadata cache payload.
   * @returns Inserted file.
   */
  const upsertFile = (path: string, mtime: number, cache: FileCacheShape): TFile => {
    const file = createMockFile(path, mtime);
    filesByPath.set(path, file);
    cachesByPath.set(path, cache);
    return file;
  };

  /**
   * Removes a file and metadata cache from the harness.
   *
   * @param path - File path to remove.
   */
  const removeFile = (path: string): void => {
    filesByPath.delete(path);
    cachesByPath.delete(path);
  };

  /**
   * Dispatches one of the captured vault listeners.
   *
   * @param eventName - Vault event name.
   * @param args - Event payload.
   */
  const emit = (eventName: VaultEventName, ...args: unknown[]): void => {
    const callback = listenerMap.get(eventName);
    if (!callback) {
      throw new Error(`Missing listener for ${eventName}`);
    }
    callback(...args);
  };

  return {
    app,
    upsertFile,
    removeFile,
    emit,
  };
}

describe("EntityGraphIndexManager", () => {
  beforeEach(() => {
    getSettingsMock.mockReturnValue({
      entityAliasFields: ["aliases", "nameAliases"],
      enableSemanticEntityRelations: false,
      semanticEntityRelationFields: ["relations"],
      semanticEntityMinConfidence: 70,
      debug: false,
    });
    subscribeToSettingsChangeMock.mockReset();
    (EntityGraphIndexManager as any).instance = null;
  });

  afterEach(() => {
    (EntityGraphIndexManager as any).instance = null;
  });

  it("builds deterministic nodes, aliases, relations, and evidence from metadata signals", async () => {
    const harness = createEntityGraphHarness();

    harness.upsertFile("Kingdom/Valoria.md", 1000, {
      links: [{ link: "Characters/Arin", displayText: "Prince Arin" }, { link: "Places/Sunhold" }],
      tags: [{ tag: "#empire" }],
      headings: [{ heading: "History of the Crown" }],
      frontmatter: {
        aliases: ["Realm of Dawn"],
        ally: "[[Places/Sunhold]]",
      },
    });
    harness.upsertFile("Characters/Arin.md", 1100, {
      links: [],
      tags: [{ tag: "#hero" }],
      headings: [{ heading: "History of the Crown" }],
      frontmatter: {
        aliases: ["The Iron Prince"],
      },
    });
    harness.upsertFile("Places/Sunhold.md", 1200, {
      links: [],
      tags: [{ tag: "#empire" }],
      headings: [{ heading: "History of the Crown" }],
      frontmatter: {},
    });
    harness.upsertFile("Characters/Lira.md", 1300, {
      links: [],
      tags: [{ tag: "#hero" }],
      headings: [{ heading: "History of the Crown" }],
      frontmatter: {
        nameAliases: ["Shield of the West"],
      },
    });

    const manager = EntityGraphIndexManager.getInstance(harness.app);
    await manager.rebuild();

    expect(manager.getNode("Kingdom/Valoria.md")).toBeDefined();
    expect(manager.getNode("Characters/Arin.md")).toBeDefined();

    const aliasFromFrontmatter = await manager.resolveEntities("Realm of Dawn");
    expect(aliasFromFrontmatter.map((item) => item.entityId)).toContain("Kingdom/Valoria.md");

    const aliasFromDisplayText = await manager.resolveEntities("Prince Arin");
    expect(aliasFromDisplayText.map((item) => item.entityId)).toContain("Kingdom/Valoria.md");

    const aliasFromConfiguredField = await manager.resolveEntities("Shield of the West");
    expect(aliasFromConfiguredField.map((item) => item.entityId)).toContain("Characters/Lira.md");

    const valoriaEdges = manager.getOutgoingEdges("Kingdom/Valoria.md");

    const wikiEdge = valoriaEdges.find(
      (edge) => edge.toId === "Characters/Arin.md" && edge.relation === "wiki_link"
    );
    expect(wikiEdge).toBeDefined();
    expect(wikiEdge?.evidence[0]).toMatchObject({
      path: "Kingdom/Valoria.md",
      chunkId: "Kingdom/Valoria.md#0",
      extractor: "wiki_link",
    });

    const frontmatterEdge = valoriaEdges.find(
      (edge) => edge.toId === "Places/Sunhold.md" && edge.relation === "frontmatter_reference"
    );
    expect(frontmatterEdge).toBeDefined();
    expect(frontmatterEdge?.evidence[0]).toMatchObject({
      extractor: "frontmatter_reference",
    });

    expect(
      valoriaEdges.some(
        (edge) => edge.toId === "Places/Sunhold.md" && edge.relation === "shared_tag"
      )
    ).toBe(true);
    expect(
      valoriaEdges.some(
        (edge) => edge.toId === "Characters/Lira.md" && edge.relation === "heading_cooccurrence"
      )
    ).toBe(true);

    const resolvedValoria = await manager.resolveEntities("Valoria");
    const expansionHits = manager.expandFromResolvedEntities(resolvedValoria, 2, 12);
    const hitPaths = expansionHits.map((hit) => hit.path);
    expect(hitPaths).toContain("Characters/Arin.md");
    expect(hitPaths).toContain("Places/Sunhold.md");
    expect(expansionHits[0].explanation.evidenceRefs.length).toBeGreaterThan(0);
  });

  it("maintains graph consistency across modify, rename, delete, and lazy rebuild flows", async () => {
    const harness = createEntityGraphHarness();

    const valoria = harness.upsertFile("Kingdom/Valoria.md", 1000, {
      links: [{ link: "Characters/Arin" }],
      tags: [{ tag: "#empire" }],
      headings: [{ heading: "History" }],
      frontmatter: {
        aliases: ["Realm of Dawn"],
      },
    });
    const arin = harness.upsertFile("Characters/Arin.md", 1000, {
      links: [],
      tags: [{ tag: "#hero" }],
      headings: [{ heading: "History" }],
      frontmatter: {
        aliases: ["The Iron Prince"],
      },
    });

    const manager = EntityGraphIndexManager.getInstance(harness.app);
    await manager.rebuild();

    expect(
      manager
        .getOutgoingEdges("Kingdom/Valoria.md")
        .some((edge) => edge.toId === "Characters/Arin.md" && edge.relation === "wiki_link")
    ).toBe(true);

    const modifiedValoria = harness.upsertFile("Kingdom/Valoria.md", 2000, {
      links: [],
      tags: [{ tag: "#empire" }],
      headings: [{ heading: "History" }],
      frontmatter: {
        aliases: ["Realm of Dawn"],
      },
    });
    harness.emit("modify", modifiedValoria);

    expect(
      manager
        .getOutgoingEdges("Kingdom/Valoria.md")
        .some((edge) => edge.toId === "Characters/Arin.md" && edge.relation === "wiki_link")
    ).toBe(false);

    harness.removeFile("Characters/Arin.md");
    const renamedArin = harness.upsertFile("Characters/Arin-Prime.md", 2100, {
      links: [],
      tags: [{ tag: "#hero" }],
      headings: [{ heading: "History" }],
      frontmatter: {
        aliases: ["The Iron Prince"],
      },
    });
    harness.emit("rename", renamedArin, arin.path);

    expect(manager.getNode("Characters/Arin.md")).toBeUndefined();
    expect(manager.getNode("Characters/Arin-Prime.md")).toBeDefined();

    const resolvedAfterRename = await manager.resolveEntities("The Iron Prince");
    expect(resolvedAfterRename.map((item) => item.entityId)).toContain("Characters/Arin-Prime.md");

    harness.removeFile("Characters/Arin-Prime.md");
    harness.emit("delete", renamedArin);
    expect(manager.getNode("Characters/Arin-Prime.md")).toBeUndefined();

    harness.upsertFile("Characters/Mara.md", 2200, {
      links: [],
      tags: [{ tag: "#hero" }],
      headings: [{ heading: "Orders" }],
      frontmatter: {
        aliases: ["Warden Mara"],
      },
    });

    manager.invalidate();
    const resolvedAfterInvalidate = await manager.resolveEntities("Warden Mara");
    expect(resolvedAfterInvalidate.map((item) => item.entityId)).toContain("Characters/Mara.md");

    expect(valoria).toBeDefined();
  });

  it("extracts semantic frontmatter relations with predicates when enabled", async () => {
    getSettingsMock.mockReturnValue({
      entityAliasFields: ["aliases", "nameAliases"],
      enableSemanticEntityRelations: true,
      semanticEntityRelationFields: ["relations"],
      semanticEntityMinConfidence: 75,
      debug: false,
    });

    const harness = createEntityGraphHarness();
    harness.upsertFile("Characters/Arin.md", 1000, {
      links: [],
      tags: [],
      headings: [],
      frontmatter: {
        relations: [{ predicate: "allied_with", target: "[[Characters/Lira]]", confidence: 0.84 }],
        rivalOf: "[[Characters/Marek]]",
      },
    });
    harness.upsertFile("Characters/Lira.md", 1000, {
      links: [],
      tags: [],
      headings: [],
      frontmatter: {},
    });
    harness.upsertFile("Characters/Marek.md", 1000, {
      links: [],
      tags: [],
      headings: [],
      frontmatter: {},
    });

    const manager = EntityGraphIndexManager.getInstance(harness.app);
    await manager.rebuild();

    const edges = manager.getOutgoingEdges("Characters/Arin.md");
    const alliedEdge = edges.find(
      (edge) => edge.relation === "semantic_frontmatter" && edge.semanticPredicate === "allied_with"
    );
    expect(alliedEdge?.toId).toBe("Characters/Lira.md");
    expect(alliedEdge?.confidence).toBeCloseTo(0.84, 2);

    const rivalEdge = edges.find(
      (edge) => edge.relation === "semantic_frontmatter" && edge.semanticPredicate === "rival_of"
    );
    expect(rivalEdge?.toId).toBe("Characters/Marek.md");
    expect(rivalEdge?.confidence).toBeCloseTo(0.75, 2);

    const resolvedArin = await manager.resolveEntities("Arin");
    const expansionHits = manager.expandFromResolvedEntities(resolvedArin, 1, 8);
    const liraHit = expansionHits.find((hit) => hit.path === "Characters/Lira.md");
    expect(
      liraHit?.explanation.relationPaths.some((path) =>
        path.includes("semantic_frontmatter:allied_with")
      )
    ).toBe(true);
  });

  it("resolves plain-title semantic targets from configured relation fields", async () => {
    getSettingsMock.mockReturnValue({
      entityAliasFields: ["aliases", "nameAliases"],
      enableSemanticEntityRelations: true,
      semanticEntityRelationFields: ["relations"],
      semanticEntityMinConfidence: 70,
      debug: false,
    });

    const harness = createEntityGraphHarness();
    harness.upsertFile("Characters/Arin.md", 1000, {
      links: [],
      tags: [],
      headings: [],
      frontmatter: {
        relations: [{ predicate: "allied_with", target: "Lira", confidence: 80 }],
      },
    });
    harness.upsertFile("Characters/Lira.md", 1000, {
      links: [],
      tags: [],
      headings: [],
      frontmatter: {},
    });

    const manager = EntityGraphIndexManager.getInstance(harness.app);
    await manager.rebuild();

    const edges = manager.getOutgoingEdges("Characters/Arin.md");
    const alliedEdge = edges.find(
      (edge) => edge.relation === "semantic_frontmatter" && edge.semanticPredicate === "allied_with"
    );

    expect(alliedEdge?.toId).toBe("Characters/Lira.md");
    expect(alliedEdge?.confidence).toBeCloseTo(0.8, 2);
  });
});

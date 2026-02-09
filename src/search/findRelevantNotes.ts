import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import { DBOperations } from "@/search/dbOperations";
import { selectEmbeddingsForSimilaritySearch } from "@/search/relevantNotesSearchUtils";
import { getSettings } from "@/settings/model";
import { logInfo } from "@/logger";
import { InternalTypedDocument, Orama, Result } from "@orama/orama";
import { App, TFile } from "obsidian";

const MAX_K = 20;
const EMBEDDING_SEARCH_BATCH_SIZE = 4;
const ORIGINAL_WEIGHT = 0.7;
const LINKS_WEIGHT = 0.3;

/**
 * Yields to the event loop so long similarity jobs do not monopolize the UI thread.
 * @returns Promise that resolves on the next task tick.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

/**
 * Runs vector similarity searches in small batches to keep UI responsive.
 * @param db - The Orama database.
 * @param embeddings - Selected embeddings to query against.
 * @returns Flattened vector hits from all embedding searches.
 */
async function searchByEmbeddings({
  db,
  embeddings,
}: {
  db: Orama<any>;
  embeddings: number[][];
}): Promise<Result<InternalTypedDocument<any>>[]> {
  const allHits: Result<InternalTypedDocument<any>>[] = [];

  for (
    let startIndex = 0;
    startIndex < embeddings.length;
    startIndex += EMBEDDING_SEARCH_BATCH_SIZE
  ) {
    const batchEmbeddings = embeddings.slice(startIndex, startIndex + EMBEDDING_SEARCH_BATCH_SIZE);
    const batchHits = await Promise.all(
      batchEmbeddings.map((embedding) =>
        DBOperations.getDocsByEmbedding(db, embedding, {
          limit: MAX_K,
          similarity: 0, // No hard threshold - use top-K ranking
        })
      )
    );

    allHits.push(...batchHits.flat());

    if (startIndex + EMBEDDING_SEARCH_BATCH_SIZE < embeddings.length) {
      await yieldToEventLoop();
    }
  }

  return allHits;
}

/**
 * Gets the embeddings for the given note path.
 * @param notePath - The note path to get embeddings for.
 * @param db - The Orama database.
 * @returns The embeddings for the given note path.
 */
async function getNoteEmbeddings(notePath: string, db: Orama<any>): Promise<number[][]> {
  const debug = getSettings().debug;
  const hits = await DBOperations.getDocsByPath(db, notePath);
  if (!hits) {
    if (debug) {
      logInfo("No hits found for note:", notePath);
    }
    return [];
  }

  const embeddings: number[][] = [];
  for (const hit of hits) {
    if (!hit?.document?.embedding) {
      if (debug) {
        logInfo("No embedding found for note:", notePath);
      }
      continue;
    }
    embeddings.push(hit.document.embedding);
  }
  return embeddings;
}

/**
 * Gets the highest score hits for each note and removes the current file path
 * from the results.
 * @param hits - The hits to get the highest score for.
 * @param currentFilePath - The current file path.
 * @returns A map of the highest score hits for each note.
 */
function getHighestScoreHits(hits: Result<InternalTypedDocument<any>>[], currentFilePath: string) {
  const hitMap = new Map<string, number>();
  for (const hit of hits) {
    const matchingScore = hitMap.get(hit.document.path);
    if (matchingScore) {
      if (hit.score > matchingScore) {
        hitMap.set(hit.document.path, hit.score);
      }
    } else {
      hitMap.set(hit.document.path, hit.score);
    }
  }
  hitMap.delete(currentFilePath);
  return hitMap;
}

/**
 * Calculates the similarity score for the given file path by searching with each
 * chunk embedding individually (no averaging) and aggregating results by max score.
 * @param db - The Orama database.
 * @param filePath - The file path to calculate similarity scores for.
 * @returns A map of note paths to their highest similarity scores.
 */
async function calculateSimilarityScore({
  db,
  filePath,
}: {
  db: Orama<any>;
  filePath: string;
}): Promise<Map<string, number>> {
  const debug = getSettings().debug;

  const currentNoteEmbeddings = await getNoteEmbeddings(filePath, db);
  if (currentNoteEmbeddings.length === 0) {
    if (debug) {
      logInfo("No embeddings found for note:", filePath);
    }
    return new Map();
  }

  const selectedEmbeddings = selectEmbeddingsForSimilaritySearch(currentNoteEmbeddings);
  if (debug && selectedEmbeddings.length < currentNoteEmbeddings.length) {
    logInfo(
      `Relevant notes: sampling ${selectedEmbeddings.length}/${currentNoteEmbeddings.length} embeddings for ${filePath}`
    );
  }

  const allHits = await searchByEmbeddings({ db, embeddings: selectedEmbeddings });

  // Aggregate by taking max score per note path
  const aggregatedHits = getHighestScoreHits(allHits, filePath);

  // Cap to top MAX_K results to prevent unbounded growth from multi-chunk notes
  if (aggregatedHits.size <= MAX_K) {
    return aggregatedHits;
  }

  const topK = Array.from(aggregatedHits.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_K);

  return new Map(topK);
}

function getNoteLinks(file: TFile) {
  const resultMap = new Map<string, { links: boolean; backlinks: boolean }>();
  const linkedNotes = getLinkedNotes(file);
  const linkedNotePaths = linkedNotes.map((note) => note.path);
  for (const notePath of linkedNotePaths) {
    resultMap.set(notePath, { links: true, backlinks: false });
  }

  const backlinkedNotes = getBacklinkedNotes(file);
  const backlinkedNotePaths = backlinkedNotes.map((note) => note.path);
  for (const notePath of backlinkedNotePaths) {
    if (resultMap.has(notePath)) {
      resultMap.set(notePath, { links: true, backlinks: true });
    } else {
      resultMap.set(notePath, { links: false, backlinks: true });
    }
  }

  return resultMap;
}

function mergeScoreMaps(
  similarityScoreMap: Map<string, number>,
  noteLinks: Map<string, { links: boolean; backlinks: boolean }>
) {
  const mergedMap = new Map<string, number>();
  const totalWeight = ORIGINAL_WEIGHT + LINKS_WEIGHT;
  for (const [key, value] of similarityScoreMap) {
    mergedMap.set(key, (value * ORIGINAL_WEIGHT) / totalWeight);
  }
  for (const [key, value] of noteLinks) {
    let score = 0;
    if (value.links && value.backlinks) {
      score = LINKS_WEIGHT;
    } else if (value.links) {
      // If the note only has outgoing or incoming links, give it a 80% links
      // weight.
      score = LINKS_WEIGHT * 0.8;
    } else if (value.backlinks) {
      score = LINKS_WEIGHT * 0.8;
    }
    mergedMap.set(key, (mergedMap.get(key) ?? 0) + score);
  }
  return mergedMap;
}

export type RelevantNoteEntry = {
  document: {
    path: string;
    title: string;
  };
  metadata: {
    score: number;
    similarityScore: number | undefined;
    hasOutgoingLinks: boolean;
    hasBacklinks: boolean;
  };
};
/**
 * Finds the relevant notes for the given file path.
 * @param db - The Orama database.
 * @param filePath - The file path to find relevant notes for.
 * @returns The relevant notes hits for the given file path. Empty array if no
 *   relevant notes are found or the index does not exist.
 */
export async function findRelevantNotes({
  db,
  filePath,
}: {
  db: Orama<any>;
  filePath: string;
}): Promise<RelevantNoteEntry[]> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    return [];
  }

  const similarityScoreMap = await calculateSimilarityScore({ db, filePath });
  const noteLinks = getNoteLinks(file);
  const mergedScoreMap = mergeScoreMaps(similarityScoreMap, noteLinks);
  const sortedHits = Array.from(mergedScoreMap.entries()).sort((a, b) => {
    const aPath = a[0];
    const bPath = b[0];
    const aCategory = getSimilarityCategory(similarityScoreMap.get(aPath) ?? 0);
    const bCategory = getSimilarityCategory(similarityScoreMap.get(bPath) ?? 0);

    if (aCategory !== bCategory) {
      return bCategory - aCategory;
    }

    return b[1] - a[1];
  });
  return sortedHits
    .map(([path, score]) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        return null;
      }
      return {
        document: {
          path,
          title: file.basename,
        },
        metadata: {
          score,
          similarityScore: similarityScoreMap.get(path),
          hasOutgoingLinks: noteLinks.get(path)?.links ?? false,
          hasBacklinks: noteLinks.get(path)?.backlinks ?? false,
        },
      };
    })
    .filter((entry) => entry !== null);
}

/**
 * Finds the relevant notes for the given file path using Smart Connections.
 * Uses SC v4's nearest() which leverages the entity's
 * embedding vector to find similar notes via cosine similarity.
 *
 * Throws on actual errors so callers can fall through to alternative search.
 * Returns empty array only for legitimate "no data" conditions.
 *
 * @param appInstance - The Obsidian App instance
 * @param filePath - The file path to find relevant notes for
 * @returns The relevant notes, or empty array if note has no embedding yet
 * @throws If the SC API call fails or the plugin env is misconfigured
 */
export async function findRelevantNotesViaSC({
  app: appInstance,
  filePath,
}: {
  app: App;
  filePath: string;
}): Promise<RelevantNoteEntry[]> {
  const file = appInstance.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    return [];
  }

  const scPlugin = (appInstance as any).plugins?.plugins?.["smart-connections"];
  const env = scPlugin?.env;
  if (!env?.smart_sources) {
    throw new Error("Smart Connections environment not available");
  }

  const source = env.smart_sources.get(filePath);
  if (!source) return []; // Note not in SC index yet – legitimate empty

  // Use the source's embedding vector to find nearest neighbors directly
  // via the collection's vector adapter (cosine similarity).
  const vec = source.vec;
  if (!vec) return []; // Note not embedded yet – legitimate empty

  if (typeof env.smart_sources.nearest !== "function") {
    throw new Error("Smart Connections nearest() API not available – upgrade SC or disable it");
  }

  const connections = await env.smart_sources.nearest(vec, { limit: MAX_K + 1 });
  if (!Array.isArray(connections) || connections.length === 0) return [];

  // Build similarity map from SC results
  const similarityScoreMap = new Map<string, number>();
  for (const conn of connections) {
    const connPath = conn.item?.path || conn.item?.key;
    if (!connPath || connPath === filePath) continue;
    // SC keys can include block refs (e.g. "file.md#heading"), take base path
    const basePath = connPath.split("#")[0];
    const existing = similarityScoreMap.get(basePath);
    if (!existing || conn.score > existing) {
      similarityScoreMap.set(basePath, conn.score);
    }
  }

  // Merge with link graph data (same logic as Orama path)
  const noteLinks = getNoteLinks(file);
  const mergedScoreMap = mergeScoreMaps(similarityScoreMap, noteLinks);

  const sortedHits = Array.from(mergedScoreMap.entries()).sort((a, b) => {
    const aCategory = getSimilarityCategory(similarityScoreMap.get(a[0]) ?? 0);
    const bCategory = getSimilarityCategory(similarityScoreMap.get(b[0]) ?? 0);
    if (aCategory !== bCategory) return bCategory - aCategory;
    return b[1] - a[1];
  });

  return sortedHits
    .map(([path, score]) => {
      const noteFile = appInstance.vault.getAbstractFileByPath(path);
      if (!(noteFile instanceof TFile) || noteFile.extension !== "md") return null;
      return {
        document: { path, title: noteFile.basename },
        metadata: {
          score,
          similarityScore: similarityScoreMap.get(path),
          hasOutgoingLinks: noteLinks.get(path)?.links ?? false,
          hasBacklinks: noteLinks.get(path)?.backlinks ?? false,
        },
      };
    })
    .filter((entry) => entry !== null);
}

/**
 * Gets the similarity category for the given score.
 * @param score - The score to get the similarity category for.
 * @returns The similarity category. 1 is low, 2 is medium, 3 is high.
 */
export function getSimilarityCategory(score: number): number {
  if (score > 0.7) return 3;
  if (score > 0.55) return 2;
  return 1;
}
